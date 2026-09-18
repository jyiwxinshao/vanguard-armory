import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';
import { createConnection } from '../src/config/database.js';
import { applySchema } from '../../database/helpers.js';
import { createCartService } from '../src/modules/cart/cart.service.js';
import { createOrderService } from '../src/modules/orders/orders.service.js';

test('orders: transactional checkout, inventory, receipts and ownership in isolated MySQL', async (t) => {
  const name = `game_store_orders_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false; let pool;
  try {
    await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
    await connection.changeUser({ database: name }); await applySchema(connection);
    await connection.execute("INSERT INTO users (username, email, password_hash) VALUES ('order_one', 'one@test.test', ?), ('order_two', 'two@test.test', ?)", ['x'.repeat(60), 'y'.repeat(60)]);
    await connection.query("INSERT INTO game_characters (user_id, server, character_name) VALUES (1, 'star_1', '星海先锋'), (2, 'star_1', '星海守望'), (1, 'dusk_2', '暮光游侠')");
    await connection.query('INSERT INTO carts (user_id) VALUES (1), (2)');
    await connection.query("INSERT INTO equipments (name, price, rarity, category, image, stock, status) VALUES ('原始长剑', 100, 'R', 'weapon', '/original.svg', 10, 'on_sale'), ('药剂', 200, 'N', 'consumable', '/potion.svg', 10, 'on_sale')");
    pool = mysql.createPool({ ...env.db, database: name, connectionLimit: 6, timezone: 'Z', charset: 'utf8mb4' });
    const runWithConnection = async (run) => { const client = await pool.getConnection(); try { await client.query("SET time_zone = '+00:00'"); return await run(client); } finally { client.release(); } };
    const runWithTransaction = (run) => runWithConnection(async (client) => { await client.beginTransaction(); try { const result = await run(client); await client.commit(); return result; } catch (error) { await client.rollback(); throw error; } });
    const cart = createCartService({ runWithConnection, runWithTransaction });
    const orders = createOrderService({ runWithConnection, runWithTransaction });
    const draft = async (userId, overrides = {}) => ({ request_id: randomUUID(), character_id: userId, server: 'star_1', items: (await cart.getCart(userId)).items.map((item) => ({ cart_item_id: item.id, equipment_id: item.equipment_id, quantity: item.quantity, expected_price: item.price })), ...overrides });
    const stock = async (id = 1) => (await connection.execute('SELECT stock FROM equipments WHERE id = ?', [id]))[0][0].stock;
    async function reset(stockValue = 10) { await cart.clearCart(1); await cart.clearCart(2); await connection.execute("UPDATE equipments SET stock = ?, status = 'on_sale', price = IF(id = 1, 100, 200) WHERE id IN (1, 2)", [stockValue]); }
    async function pending(quantity = 2) { await reset(); await cart.addItem(1, { equipment_id: 1, quantity }); return orders.createOrder(1, await draft(1)); }

    await t.test('character lookup is scoped to owner and server; absent roles and injected queries are rejected safely', async () => {
      assert.deepEqual(await orders.getCharacter(1, { server: 'star_1' }), { character: { id: 1, server: 'star_1', character_name: '星海先锋' } });
      assert.equal((await orders.getCharacter(2, { server: 'star_1' })).character.id, 2);
      assert.equal((await orders.getCharacter(1, { server: 'dusk_2' })).character.id, 3);
      assert.deepEqual(await orders.getCharacter(1, { server: 'expedition_3' }), { character: null });
      for (const query of [{ server: 'bad' }, { server: ['star_1'] }, { server: 'star_1', user_id: 2 }]) await assert.rejects(orders.getCharacter(1, query), (e) => e.status === 422);
      await assert.rejects(connection.execute("INSERT INTO game_characters (user_id, server, character_name) VALUES (1, 'star_1', '第二角色')"), { code: 'ER_DUP_ENTRY' });
    });
    await t.test('forged or missing characters never create receipts, consume stock or remove cart lines', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 1 });
      for (const values of [{ character_id: 2 }, { character_id: 3 }, { server: 'expedition_3' }]) {
        const body = await draft(1, values);
        await assert.rejects(orders.createOrder(1, body), (e) => e.status === 409 && e.code === 10007);
        await assert.rejects(orders.getByRequest(1, body.request_id), (e) => e.status === 404);
      }
      for (const values of [{ character_name: '伪造角色' }, { remark: '不要备注' }]) await assert.rejects(orders.createOrder(1, await draft(1, values)), (e) => e.status === 422);
      assert.equal(await stock(), 10); assert.equal((await cart.getCart(1)).items.length, 1);
      await reset();
    });
    await t.test('server character snapshot survives rename and same-ID retry still returns the original order', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 1 }); const body = await draft(1);
      const first = await orders.createOrder(1, body);
      assert.equal(first.order.character_id, 1); assert.equal(first.order.character_name, '星海先锋'); assert.equal(first.order.remark, undefined);
      const [[row]] = await connection.execute('SELECT remark FROM orders WHERE id = ?', [first.order.id]); assert.equal(row.remark, null);
      await connection.execute("UPDATE game_characters SET character_name = '改名先锋' WHERE id = 1");
      const replay = await orders.createOrder(1, body);
      assert.equal(replay.order.id, first.order.id); assert.equal(replay.order.character_name, '星海先锋'); assert.equal(await stock(), 9);
      assert.equal((await orders.getCharacter(1, { server: 'star_1' })).character.character_name, '改名先锋');
      await connection.execute("UPDATE game_characters SET character_name = '星海先锋' WHERE id = 1"); await reset();
    });
    await t.test('legacy submissions only replay existing orders; uncreated legacy input is rejected without loss', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 1 });
      const legacy = { ...await draft(1), character_name: '历史角色', remark: '历史记录' }; delete legacy.character_id;
      const [old] = await connection.execute("INSERT INTO orders (order_no, user_id, total, actual_total, character_name, server, remark) VALUES ('LEGACY-CHARACTER', 1, 100, 100, '历史角色', 'star_1', '历史记录')");
      await connection.execute("INSERT INTO order_items (order_id, equipment_id, equipment_name, equipment_image, rarity, price, quantity) VALUES (?, 1, '旧快照', '/old.svg', 'R', 100, 1)", [old.insertId]);
      const hash = createHash('sha256').update(JSON.stringify({ characterName: legacy.character_name, server: legacy.server, remark: legacy.remark, items: legacy.items })).digest('hex');
      await connection.execute('INSERT INTO order_requests (request_id, user_id, payload_hash, order_id) VALUES (?, 1, ?, ?)', [legacy.request_id, hash, old.insertId]);
      const replay = await orders.createOrder(1, legacy); assert.equal(replay.order.id, old.insertId); assert.equal(replay.replayed, true); assert.equal(replay.order.character_id, null);
      assert.equal((await orders.getByRequest(1, legacy.request_id)).order.character_name, '历史角色');
      const uncreated = { ...legacy, request_id: randomUUID() };
      await assert.rejects(orders.createOrder(1, uncreated), (e) => e.code === 10007);
      await assert.rejects(orders.getByRequest(1, uncreated.request_id), (e) => e.status === 404);
      assert.equal(await stock(), 10); assert.equal((await cart.getCart(1)).items.length, 1);
      await reset();
    });

    await t.test('checkout calculates money, snapshots all fields, deducts once and deletes purchased cart IDs', async () => {
      await cart.addItem(1, { equipment_id: 1, quantity: 2 }); await cart.addItem(1, { equipment_id: 2, quantity: 3 });
      const result = await orders.createOrder(1, await draft(1));
      assert.equal(result.order.total, 800); assert.equal(result.order.actual_total, 800); assert.equal(result.order.discount, 0); assert.equal(result.order.status, 'pending');
      assert.equal(result.order.items[0].equipment_name, '原始长剑'); assert.equal(result.order.items[0].equipment_image, '/original.svg'); assert.equal(result.order.items[0].rarity, 'R');
      assert.equal(result.cart.items.length, 0); assert.equal(await stock(), 8); assert.equal(await stock(2), 7);
      await connection.execute("UPDATE equipments SET name = '新名称', image = '/changed.svg', price = 999, rarity = 'SSR', status = 'deleted' WHERE id = 1");
      const historical = await orders.getOrder(1, result.order.id);
      assert.equal(historical.items[0].equipment_name, '原始长剑'); assert.equal(historical.items[0].price, 100); assert.equal(historical.actual_total, 800);
      assert.equal((await orders.changeStatus(1, result.order.id, 'pay')).actual_total, 800);
    });
    await t.test('concurrent same-ID submissions and lost responses return one order without touching newly added cart rows', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 2 }); const body = await draft(1);
      const responses = await Promise.all(Array.from({ length: 4 }, () => orders.createOrder(1, body)));
      assert.equal(new Set(responses.map((value) => value.order.id)).size, 1); assert.equal(responses.filter((value) => !value.replayed).length, 1); assert.equal(await stock(), 8);
      await cart.addItem(1, { equipment_id: 1, quantity: 1 });
      const replay = await orders.createOrder(1, body); assert.equal(replay.cart.items[0].quantity, 1); assert.equal(await stock(), 8);
      assert.equal((await orders.getByRequest(1, body.request_id)).order.id, replay.order.id);
      await assert.rejects(orders.createOrder(2, body), (error) => error.code === 10012);
      await assert.rejects(orders.createOrder(1, { ...body, character_id: 3 }), (error) => error.code === 10012);
      await assert.rejects(orders.getByRequest(2, body.request_id), (error) => error.status === 404);
      await assert.rejects(orders.createOrder(1, { ...body, request_id: randomUUID() }), (error) => error.code === 10007);
      assert.equal((await cart.getCart(1)).items[0].quantity, 1);
    });
    await t.test('different submit IDs for the same cart still produce only one order', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 1 }); const body = await draft(1);
      const results = await Promise.allSettled([orders.createOrder(1, body), orders.createOrder(1, { ...body, request_id: randomUUID() })]);
      assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1); assert.equal(await stock(), 9);
    });
    await t.test('two users competing for the last unit cannot oversell', async () => {
      await reset(1); await cart.addItem(1, { equipment_id: 1, quantity: 1 }); await cart.addItem(2, { equipment_id: 1, quantity: 1 });
      const requests = await Promise.all([draft(1), draft(2)]);
      const results = await Promise.allSettled(requests.map((body, index) => orders.createOrder(index + 1, body)));
      assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1); assert.equal(results.find((item) => item.status === 'rejected').reason.code, 10005); assert.equal(await stock(), 0);
      const leftover = (await cart.getCart(1)).items.length + (await cart.getCart(2)).items.length; assert.equal(leftover, 1);
    });
    await t.test('changed quantity, changed price, new cart row or unavailable equipment rejects without consuming the cart', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 2 }); const body = await draft(1);
      await assert.rejects(orders.createOrder(1, { ...body, items: [{ ...body.items[0], expected_price: 1 }] }), (error) => error.code === 10007);
      await assert.rejects(orders.createOrder(1, { ...body, items: [{ ...body.items[0], quantity: 1 }] }), (error) => error.code === 10007);
      await cart.addItem(1, { equipment_id: 2, quantity: 1 }); await assert.rejects(orders.createOrder(1, body), (error) => error.code === 10007);
      const full = await draft(1); await connection.execute("UPDATE equipments SET status = 'off_sale' WHERE id = 2");
      await assert.rejects(orders.createOrder(1, full), (error) => error.code === 10009);
      assert.equal(await stock(), 10); assert.equal((await cart.getCart(1)).items.length, 2);
    });
    await t.test('failure inserting snapshots rolls back stock, order, receipt and cart deletion', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 2 }); await cart.addItem(1, { equipment_id: 2, quantity: 1 }); const body = await draft(1);
      const [[before]] = await connection.query('SELECT COUNT(*) AS count FROM orders');
      await connection.query("CREATE TRIGGER fail_order_item BEFORE INSERT ON order_items FOR EACH ROW BEGIN IF NEW.equipment_id = 2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'snapshot failure'; END IF; END");
      try {
        await assert.rejects(orders.createOrder(1, body)); assert.equal(await stock(), 10); assert.equal(await stock(2), 10); assert.equal((await cart.getCart(1)).items.length, 2);
        const [[after]] = await connection.query('SELECT COUNT(*) AS count FROM orders'); assert.equal(after.count, before.count);
        await assert.rejects(orders.getByRequest(1, body.request_id), (error) => error.status === 404);
      } finally { await connection.query('DROP TRIGGER fail_order_item'); }
      assert.equal((await orders.createOrder(1, body)).order.total, 400);
    });
    await t.test('a failed cart deletion rolls back even previously written snapshots and deducted stock', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 1 }); const body = await draft(1);
      await connection.query("CREATE TRIGGER fail_checkout_delete BEFORE DELETE ON cart_items FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cart failure'");
      try { await assert.rejects(orders.createOrder(1, body)); assert.equal(await stock(), 10); assert.equal((await cart.getCart(1)).items.length, 1); await assert.rejects(orders.getByRequest(1, body.request_id), (error) => error.status === 404); }
      finally { await connection.query('DROP TRIGGER fail_checkout_delete'); }
    });
    await t.test('pay and cancel are owner-scoped, idempotent, and terminal states cannot transition again', async () => {
      const result = await pending(); const id = result.order.id;
      for (const action of ['pay', 'cancel']) await assert.rejects(orders.changeStatus(2, id, action), (error) => error.status === 404);
      await assert.rejects(orders.getOrder(2, id), (error) => error.status === 404);
      const paid = await orders.changeStatus(1, id, 'pay'); const repeated = await orders.changeStatus(1, id, 'pay');
      assert.deepEqual(repeated.payment_time, paid.payment_time); assert.equal(await stock(), 8);
      await assert.rejects(orders.changeStatus(1, id, 'cancel'), (error) => error.code === 10008);
      await connection.execute("UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
      for (const action of ['pay', 'cancel']) await assert.rejects(orders.changeStatus(1, id, action), (error) => error.code === 10008);
      assert.equal((await orders.getOrder(1, id)).status, 'completed');
    });
    await t.test('concurrent cancellation returns inventory once, including off-sale stock beyond the form limit', async () => {
      const { order } = await pending(3);
      await connection.execute("UPDATE equipments SET stock = 9999, status = 'off_sale' WHERE id = 1");
      const results = await Promise.all(Array.from({ length: 4 }, () => orders.changeStatus(1, order.id, 'cancel')));
      assert.ok(results.every((item) => item.status === 'cancelled')); assert.equal(await stock(), 10002);
      assert.ok(results.every((item) => Number(item.cancelled_at) === Number(results[0].cancelled_at)));
      await assert.rejects(orders.changeStatus(1, order.id, 'pay'), (error) => error.code === 10008);
    });
    await t.test('payment racing cancellation commits exactly one legal transition', async () => {
      const { order } = await pending();
      const results = await Promise.allSettled([orders.changeStatus(1, order.id, 'pay'), orders.changeStatus(1, order.id, 'cancel')]);
      assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
      const actual = await orders.getOrder(1, order.id); assert.equal(await stock(), actual.status === 'paid' ? 8 : 10);
    });
    await t.test('inventory return failure rolls back all earlier increments and leaves order pending', async () => {
      await reset(); await cart.addItem(1, { equipment_id: 1, quantity: 2 }); await cart.addItem(1, { equipment_id: 2, quantity: 2 }); const { order } = await orders.createOrder(1, await draft(1));
      await connection.query("CREATE TRIGGER fail_return_stock BEFORE UPDATE ON equipments FOR EACH ROW BEGIN IF OLD.id = 2 AND NEW.stock > OLD.stock THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'return failure'; END IF; END");
      try { await assert.rejects(orders.changeStatus(1, order.id, 'cancel')); assert.equal(await stock(), 8); assert.equal(await stock(2), 8); assert.equal((await orders.getOrder(1, order.id)).status, 'pending'); }
      finally { await connection.query('DROP TRIGGER fail_return_stock'); }
      await orders.changeStatus(1, order.id, 'cancel'); assert.equal(await stock(), 10); assert.equal(await stock(2), 10);
    });
    await t.test('order amount cap rejects before committing any stock or receipt', async () => {
      await reset(9999); await connection.execute('UPDATE equipments SET price = 1000000 WHERE id = 1'); await cart.addItem(1, { equipment_id: 1, quantity: 101 });
      const body = await draft(1); await assert.rejects(orders.createOrder(1, body), (error) => error.status === 422);
      assert.equal(await stock(), 9999); assert.equal((await cart.getCart(1)).items[0].quantity, 101);
      await assert.rejects(orders.getByRequest(1, body.request_id), (error) => error.status === 404);
    });
    await t.test('list status/time filtering and stable pagination never expose another owner', async () => {
      const all = await orders.listOrders(1, { page_size: '50' }); assert.ok(all.total > 0); assert.ok(all.items.every((order) => order.user_id === 1));
      const completed = await orders.listOrders(1, { status: 'completed' }); assert.ok(completed.total >= 1); assert.ok(completed.items.every((order) => order.status === 'completed'));
      const outside = await orders.listOrders(1, { created_to: '2000-01-01T00:00:00Z' }); assert.equal(outside.total, 0);
      const boundaryId = all.items[0].id;
      await connection.execute('UPDATE orders SET created_at = ? WHERE id = ?', ['2001-01-02 00:00:00', boundaryId]);
      const beforeBoundary = await orders.listOrders(1, { created_from: '2001-01-01T00:00:00Z', created_to: '2001-01-02T00:00:00Z' });
      assert.equal(beforeBoundary.total, 0);
      const atBoundary = await orders.listOrders(1, { created_from: '2001-01-02T00:00:00Z', created_to: '2001-01-03T00:00:00Z' });
      assert.deepEqual(atBoundary.items.map((order) => order.id), [boundaryId]);
      const page = await orders.listOrders(1, { page: '100' }); assert.equal(page.items.length, 0); assert.equal(page.total, all.total);
      const other = await orders.listOrders(2, {}); assert.ok(other.items.every((order) => order.user_id === 2));
    });
    await t.test('order number search is owner-scoped and composes with status', async () => {
      const own = await orders.listOrders(1, { page_size: '50' });
      const target = own.items[0];
      const found = await orders.listOrders(1, { order_no: target.order_no });
      assert.equal(found.total, 1);
      assert.equal(found.items[0].id, target.id);
      const partial = await orders.listOrders(1, { order_no: target.order_no.slice(0, 6) });
      assert.ok(partial.total >= 1);
      assert.equal((await orders.listOrders(2, { order_no: target.order_no })).total, 0);
      assert.equal((await orders.listOrders(1, { order_no: 'NO-SUCH-ORDER' })).total, 0);
      const combined = await orders.listOrders(1, { order_no: target.order_no, status: target.status });
      assert.equal(combined.total, 1);
      const otherStatus = ['pending', 'paid', 'cancelled', 'completed'].find((status) => status !== target.status);
      assert.equal((await orders.listOrders(1, { order_no: target.order_no, status: otherStatus })).total, 0);
    });
    await t.test('schema upgrade and rerun preserve existing order snapshots and receipts', async () => {
      const [[before]] = await connection.query('SELECT COUNT(*) AS count FROM orders'); await applySchema(connection);
      const [[after]] = await connection.query('SELECT COUNT(*) AS count FROM orders'); assert.equal(after.count, before.count);
      const [[receipt]] = await connection.query('SELECT COUNT(*) AS count FROM order_requests WHERE order_id IS NOT NULL'); assert.ok(receipt.count > 0);
    });
  } finally {
    await pool?.end();
    try { if (created) await connection.query(`DROP DATABASE \`${name}\``); } finally { await connection.end(); }
  }
});
