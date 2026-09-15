import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';
import { createConnection } from '../src/config/database.js';
import { applySchema } from '../../database/helpers.js';
import { createCartService } from '../src/modules/cart/cart.service.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokenService } from '../src/utils/token.js';
import { createApp } from '../src/app.js';

test('logged-in server cart CRUD against an isolated real MySQL database', async (t) => {
  const databaseName = `game_store_cart_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false;
  let pool;
  let server;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await applySchema(connection);

    await connection.query(
      "INSERT INTO users (username, email, password_hash, role, status) VALUES "
      + "('cart_user_one', 'one@example.test', ?, 'user', 'active'), "
      + "('cart_user_two', 'two@example.test', ?, 'user', 'active'), "
      + "('cart_admin', 'admin@example.test', ?, 'admin', 'active')",
      ['x'.repeat(60), 'y'.repeat(60), 'z'.repeat(60)],
    );
    const [userRows] = await connection.execute('SELECT id, username FROM users ORDER BY id');
    const userOne = userRows.find((row) => row.username === 'cart_user_one');
    const userTwo = userRows.find((row) => row.username === 'cart_user_two');
    const admin = userRows.find((row) => row.username === 'cart_admin');
    await connection.execute('INSERT INTO carts (user_id) VALUES (?), (?)', [userOne.id, userTwo.id]);

    const [weaponResult] = await connection.execute(
      "INSERT INTO equipments (name, price, rarity, category, image, attack, defense, description, stock, status) VALUES "
      + "('晨星长剑', 12900, 'R', 'weapon', '/images/equipments/placeholder.svg', 68, 0, '测试武器', 5, 'on_sale')",
    );
    const weaponId = weaponResult.insertId;
    const [soldOutResult] = await connection.execute(
      "INSERT INTO equipments (name, price, rarity, category, image, attack, defense, description, stock, status) VALUES "
      + "('生命药剂', 800, 'N', 'consumable', '/images/equipments/placeholder.svg', 0, 0, '测试道具', 0, 'on_sale')",
    );
    const soldOutId = soldOutResult.insertId;
    const [offSaleResult] = await connection.execute(
      "INSERT INTO equipments (name, price, rarity, category, image, attack, defense, description, stock, status) VALUES "
      + "('风语指环', 5900, 'R', 'accessory', '/images/equipments/placeholder.svg', 16, 8, '测试下架', 10, 'off_sale')",
    );
    const offSaleId = offSaleResult.insertId;
    const [deletedResult] = await connection.execute(
      "INSERT INTO equipments (name, price, rarity, category, image, attack, defense, description, stock, status) VALUES "
      + "('旧革护衣', 1900, 'N', 'armor', '/images/equipments/placeholder.svg', 0, 22, '测试删除', 10, 'deleted')",
    );
    const deletedId = deletedResult.insertId;

    pool = mysql.createPool({ ...env.db, database: databaseName, connectionLimit: 4, timezone: 'Z', charset: 'utf8mb4' });
    const runWithConnection = async (run) => {
      const client = await pool.getConnection();
      try { await client.query("SET time_zone = '+00:00'"); return await run(client); }
      finally { client.release(); }
    };
    const runWithTransaction = (run) => runWithConnection(async (client) => {
      await client.beginTransaction();
      try { const result = await run(client); await client.commit(); return result; }
      catch (error) { await client.rollback(); throw error; }
    });

    const tokens = createTokenService({ secret: randomBytes(32).toString('hex'), expiresIn: '2h' });
    const authService = createAuthService({ runWithConnection, runWithTransaction, tokens });
    const cartService = createCartService({ runWithConnection, runWithTransaction });
    server = createApp({
      authService,
      cartService,
      equipmentList: async () => { throw new Error('unexpected equipment list call'); },
      equipmentDetail: async () => { throw new Error('unexpected equipment detail call'); },
      logger: () => {},
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/cart`;
    const request = async (path, { method = 'GET', token, body } = {}) => {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    const userOneToken = tokens.sign(userOne.id);
    const userTwoToken = tokens.sign(userTwo.id);
    const adminToken = tokens.sign(admin.id);

    await t.test('all cart routes require an active normal user', async () => {
      const unauthenticated = await request('');
      assert.equal(unauthenticated.status, 401);
      assert.equal(unauthenticated.body.code, 10002);
      const forbidden = await request('', { token: adminToken });
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.code, 10003);
      assert.equal((await request('', { token: userOneToken })).status, 200);
    });

    await t.test('add accumulates the same equipment without creating duplicates or deducting stock', async () => {
      const first = await request('/items', { method: 'POST', token: userOneToken, body: { equipment_id: weaponId, quantity: 2 } });
      assert.equal(first.status, 201);
      assert.equal(first.body.data.items.length, 1);
      assert.equal(first.body.data.items[0].equipment_id, weaponId);
      assert.equal(first.body.data.items[0].quantity, 2);
      assert.equal(first.body.data.items[0].name, '晨星长剑');
      assert.equal(first.body.data.items[0].stock, 5);
      assert.equal(first.body.data.items[0].status, 'on_sale');
      assert.equal(first.body.data.items[0].available, true);
      assert.equal(first.body.data.items[0].subtotal, 25800);
      assert.equal(first.body.data.total_price, 25800);

      const second = await request('/items', { method: 'POST', token: userOneToken, body: { equipment_id: weaponId, quantity: 2 } });
      assert.equal(second.status, 201);
      assert.equal(second.body.data.items.length, 1);
      assert.equal(second.body.data.items[0].quantity, 4);
      assert.equal(second.body.data.total_price, 51600);

      const [[stockRow]] = await connection.execute('SELECT stock FROM equipments WHERE id = ?', [weaponId]);
      assert.equal(stockRow.stock, 5);
      const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = ?', [userOne.id]);
      assert.equal(total, 1);
    });

    await t.test('quantity is validated and never exceeds current stock', async () => {
      for (const body of [{ equipment_id: weaponId, quantity: 0 }, { equipment_id: weaponId, quantity: -1 }, { equipment_id: weaponId, quantity: 1.5 }, { quantity: 1 }]) {
        const result = await request('/items', { method: 'POST', token: userOneToken, body });
        assert.equal(result.status, 422, JSON.stringify(body));
        assert.equal(result.body.code, 10001);
      }
      const overStock = await request('/items', { method: 'POST', token: userOneToken, body: { equipment_id: weaponId, quantity: 2 } });
      assert.equal(overStock.status, 409);
      assert.equal(overStock.body.code, 10005);
      assert.deepEqual(overStock.body.data, { equipment_id: weaponId, stock: 5 });
      const soldOut = await request('/items', { method: 'POST', token: userOneToken, body: { equipment_id: soldOutId, quantity: 1 } });
      assert.equal(soldOut.status, 409);
      assert.equal(soldOut.body.code, 10005);
      assert.equal(soldOut.body.data.stock, 0);
    });

    await t.test('off-sale and deleted equipment cannot be added', async () => {
      for (const equipmentId of [offSaleId, deletedId, 4294967295]) {
        const result = await request('/items', { method: 'POST', token: userOneToken, body: { equipment_id: equipmentId, quantity: 1 } });
        assert.equal(result.status, 404, String(equipmentId));
        assert.equal(result.body.code, 10004);
      }
    });

    await t.test('GET returns live prices and current equipment fields for the cart', async () => {
      await connection.execute('UPDATE equipments SET price = 10000 WHERE id = ?', [weaponId]);
      const result = await request('', { token: userOneToken });
      assert.equal(result.status, 200);
      assert.equal(result.body.data.items[0].price, 10000);
      assert.equal(result.body.data.items[0].subtotal, 40000);
      assert.equal(result.body.data.total_price, 40000);
      await connection.execute('UPDATE equipments SET price = 12900 WHERE id = ?', [weaponId]);
    });

    await t.test('update sets an absolute quantity and enforces ownership and stock', async () => {
      const updated = await request('/items/1', { method: 'PUT', token: userOneToken, body: { quantity: 3 } });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.items[0].quantity, 3);
      assert.equal(updated.body.data.total_price, 38700);
      const invalid = await request('/items/1', { method: 'PUT', token: userOneToken, body: { quantity: 0 } });
      assert.equal(invalid.status, 422);
      assert.equal(invalid.body.code, 10001);
      const overStock = await request('/items/1', { method: 'PUT', token: userOneToken, body: { quantity: 6 } });
      assert.equal(overStock.status, 409);
      assert.deepEqual(overStock.body.data, { equipment_id: weaponId, stock: 5 });
      const otherUser = await request('/items/1', { method: 'PUT', token: userTwoToken, body: { quantity: 1 } });
      assert.equal(otherUser.status, 404);
      assert.equal(otherUser.body.code, 10004);
    });

    await t.test('GET marks sold-out, insufficient-stock, off-sale and deleted items as unavailable', async () => {
      await connection.execute(
        'INSERT INTO cart_items (cart_id, equipment_id, quantity) SELECT id, ?, 1 FROM carts WHERE user_id = ?',
        [soldOutId, userOne.id],
      );
      await connection.execute(
        'INSERT INTO cart_items (cart_id, equipment_id, quantity) SELECT id, ?, 1 FROM carts WHERE user_id = ?',
        [offSaleId, userOne.id],
      );
      await connection.execute(
        'INSERT INTO cart_items (cart_id, equipment_id, quantity) SELECT id, ?, 1 FROM carts WHERE user_id = ?',
        [deletedId, userOne.id],
      );
      await connection.execute('UPDATE equipments SET stock = 2 WHERE id = ?', [weaponId]);

      const result = await request('', { token: userOneToken });
      assert.equal(result.status, 200);
      const byEquipment = new Map(result.body.data.items.map((item) => [item.equipment_id, item]));
      assert.equal(byEquipment.get(weaponId).status, 'on_sale');
      assert.equal(byEquipment.get(weaponId).available, false);
      assert.equal(byEquipment.get(soldOutId).status, 'on_sale');
      assert.equal(byEquipment.get(soldOutId).available, false);
      assert.equal(byEquipment.get(offSaleId).status, 'off_sale');
      assert.equal(byEquipment.get(offSaleId).available, false);
      assert.equal(byEquipment.get(deletedId).status, 'deleted');
      assert.equal(byEquipment.get(deletedId).available, false);

      await connection.execute('UPDATE equipments SET stock = 5 WHERE id = ?', [weaponId]);
      await connection.execute(
        'DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = ? AND ci.equipment_id IN (?, ?, ?)',
        [userOne.id, soldOutId, offSaleId, deletedId],
      );
    });

    await t.test('delete one item and clear the whole cart, isolated per user', async () => {
      const otherDelete = await request('/items/1', { method: 'DELETE', token: userTwoToken });
      assert.equal(otherDelete.status, 404);
      assert.equal((await request('', { token: userTwoToken })).body.data.items.length, 0);

      const deleted = await request('/items/1', { method: 'DELETE', token: userOneToken });
      assert.equal(deleted.status, 200);
      assert.deepEqual(deleted.body.data, { items: [], total_price: 0, available_total_price: 0, invalid_count: 0, checkout_allowed: false });

      await request('/items', { method: 'POST', token: userOneToken, body: { equipment_id: weaponId, quantity: 1 } });
      const cleared = await request('', { method: 'DELETE', token: userOneToken });
      assert.equal(cleared.status, 200);
      assert.deepEqual(cleared.body.data, { items: [], total_price: 0, available_total_price: 0, invalid_count: 0, checkout_allowed: false });
    });

    await t.test('merge sums duplicate IDs, caps live stock, and replay returns the latest cart without adding again', async () => {
      await cartService.clearCart(userOne.id);
      await connection.execute('UPDATE equipments SET stock = 10 WHERE id = ?', [weaponId]);
      await cartService.addItem(userOne.id, { equipment_id: weaponId, quantity: 3 });
      const body = { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 1 }, { equipment_id: weaponId, quantity: 1 }] };
      const first = await request('/merge', { method: 'POST', token: userOneToken, body });
      assert.equal(first.status, 200);
      assert.equal(first.body.data.items[0].quantity, 5);
      assert.equal(first.body.data.merge.replayed, false);
      // Treat the first response as lost. A replay after an independent edit must
      // acknowledge the receipt but return current quantities, not its old snapshot.
      await cartService.updateItem(userOne.id, first.body.data.items[0].id, { quantity: 4 });
      const replay = await cartService.mergeCart(userOne.id, body);
      assert.equal(replay.merge.replayed, true);
      assert.equal(replay.items[0].quantity, 4);
      const capped = await cartService.mergeCart(userOne.id, { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 9 }] });
      assert.equal(capped.items[0].quantity, 10);
      assert.deepEqual(capped.adjustments[0], { equipment_id: weaponId, previous_quantity: 4, incoming_quantity: 9, requested_quantity: 13, accepted_quantity: 10, reason: 'stock_limit' });
      const [[equipment]] = await connection.execute('SELECT stock FROM equipments WHERE id = ?', [weaponId]);
      assert.equal(equipment.stock, 10);
    });

    await t.test('concurrent identical merge requests commit one addition and one durable receipt', async () => {
      await cartService.clearCart(userOne.id);
      const body = { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 2 }] };
      const results = await Promise.all(Array.from({ length: 4 }, () => cartService.mergeCart(userOne.id, body)));
      assert.equal(results.filter((result) => !result.merge.replayed).length, 1);
      assert.ok(results.every((result) => result.items[0].quantity === 2));
      const [[row]] = await connection.execute('SELECT COUNT(*) AS count FROM cart_merge_receipts WHERE merge_id = ?', [body.merge_id]);
      assert.equal(row.count, 1);
      await assert.rejects(cartService.mergeCart(userTwo.id, body), (error) => error.code === 10011);
      await assert.rejects(cartService.mergeCart(userOne.id, { ...body, items: [{ equipment_id: weaponId, quantity: 3 }] }), (error) => error.code === 10011);
      assert.equal((await cartService.getCart(userTwo.id)).items.length, 0);
    });

    await t.test('a batch concurrently claimed by different users can only belong to one account', async () => {
      await cartService.clearCart(userOne.id); await cartService.clearCart(userTwo.id);
      const body = { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 2 }] };
      const results = await Promise.allSettled([cartService.mergeCart(userOne.id, body), cartService.mergeCart(userTwo.id, body)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.find((result) => result.status === 'rejected').reason.code, 10011);
      const counts = await Promise.all([userOne.id, userTwo.id].map(async (id) => (await cartService.getCart(id)).items.reduce((sum, item) => sum + item.quantity, 0)));
      assert.equal(counts.reduce((a, b) => a + b, 0), 2);
      await cartService.clearCart(userTwo.id);
    });

    await t.test('unavailable inputs are reported and pre-existing invalid server rows remain editable by deletion', async () => {
      await cartService.clearCart(userOne.id);
      const [[cart]] = await connection.execute('SELECT id FROM carts WHERE user_id = ?', [userOne.id]);
      await connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, 2)', [cart.id, offSaleId]);
      const result = await cartService.mergeCart(userOne.id, { merge_id: randomUUID(), items: [offSaleId, deletedId, soldOutId, 4294967295].map((equipment_id) => ({ equipment_id, quantity: 1 })) });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].quantity, 2);
      assert.equal(result.items[0].reason, 'off_sale');
      assert.equal(result.available_total_price, 0);
      assert.equal(result.checkout_allowed, false);
      assert.deepEqual(new Set(result.adjustments.map((item) => item.reason)), new Set(['off_sale', 'deleted', 'sold_out', 'not_found']));
      assert.equal(result.adjustments.find((item) => item.equipment_id === offSaleId).accepted_quantity, 2);
    });

    await t.test('quantity cap and stock reduction below existing quantity give explicit final totals', async () => {
      await cartService.clearCart(userOne.id);
      await connection.execute('UPDATE equipments SET stock = 20000 WHERE id = ?', [weaponId]);
      await cartService.addItem(userOne.id, { equipment_id: weaponId, quantity: 9998 });
      const capped = await cartService.mergeCart(userOne.id, { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 2 }] });
      assert.equal(capped.items[0].quantity, 9999);
      assert.equal(capped.adjustments[0].reason, 'quantity_limit');
      await connection.execute('UPDATE equipments SET stock = 3 WHERE id = ?', [weaponId]);
      const reduced = await cartService.mergeCart(userOne.id, { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 2 }] });
      assert.equal(reduced.items[0].quantity, 3);
      assert.equal(reduced.adjustments[0].previous_quantity, 9999);
      assert.equal(reduced.adjustments[0].reason, 'stock_limit');
    });

    await t.test('merge rejects malformed inputs and unauthenticated, frozen or administrator requests', async () => {
      const good = { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 1 }] };
      for (const body of [{ ...good, merge_id: 'bad' }, { ...good, items: [] }, { ...good, items: [{ equipment_id: weaponId, quantity: 0 }] }, { ...good, user_id: userTwo.id }, { ...good, items: Array.from({ length: 101 }, () => ({ equipment_id: weaponId, quantity: 1 })) }]) {
        assert.equal((await request('/merge', { method: 'POST', token: userOneToken, body })).status, 422);
      }
      assert.equal((await request('/merge', { method: 'POST', body: good })).status, 401);
      assert.equal((await request('/merge', { method: 'POST', token: adminToken, body: good })).status, 403);
      await connection.execute("UPDATE users SET status = 'frozen' WHERE id = ?", [userOne.id]);
      assert.equal((await request('/merge', { method: 'POST', token: userOneToken, body: good })).status, 403);
      await connection.execute("UPDATE users SET status = 'active' WHERE id = ?", [userOne.id]);
    });

    await t.test('a database failure rolls back both quantities and receipt, allowing the same ID to retry', async () => {
      await cartService.clearCart(userOne.id);
      await connection.query("CREATE TRIGGER reject_merge_receipt BEFORE UPDATE ON cart_merge_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test failure'");
      const body = { merge_id: randomUUID(), items: [{ equipment_id: weaponId, quantity: 2 }] };
      try {
        await assert.rejects(cartService.mergeCart(userOne.id, body));
        assert.equal((await cartService.getCart(userOne.id)).items.length, 0);
        const [[row]] = await connection.execute('SELECT COUNT(*) AS count FROM cart_merge_receipts WHERE merge_id = ?', [body.merge_id]);
        assert.equal(row.count, 0);
      } finally { await connection.query('DROP TRIGGER reject_merge_receipt'); }
      assert.equal((await cartService.mergeCart(userOne.id, body)).items[0].quantity, 2);
    });

    await t.test('batch deletion validates every owner and is all-or-nothing', async () => {
      await cartService.clearCart(userOne.id); await cartService.clearCart(userTwo.id);
      const own = (await cartService.addItem(userOne.id, { equipment_id: weaponId, quantity: 1 })).items[0];
      const other = (await cartService.addItem(userTwo.id, { equipment_id: weaponId, quantity: 1 })).items[0];
      const rejected = await request('/items/batch-delete', { method: 'POST', token: userOneToken, body: { ids: [own.id, other.id] } });
      assert.equal(rejected.status, 404);
      assert.equal((await cartService.getCart(userOne.id)).items.length, 1);
      const deleted = await request('/items/batch-delete', { method: 'POST', token: userOneToken, body: { ids: [own.id, own.id] } });
      assert.equal(deleted.status, 200); assert.equal(deleted.body.data.items.length, 0);
      assert.equal((await cartService.getCart(userTwo.id)).items.length, 1);
    });

    await t.test('100-kind limit rolls back the entire merge including earlier updates and its receipt', async () => {
      await cartService.clearCart(userOne.id);
      const [[cart]] = await connection.execute('SELECT id FROM carts WHERE user_id = ?', [userOne.id]);
      const extraIds = [];
      for (let i = 0; i < 101; i++) {
        const [row] = await connection.execute("INSERT INTO equipments (name, price, rarity, category, image, stock, status) VALUES (?, 100, 'N', 'weapon', '', 10, 'on_sale')", [`测试装备 ${i}`]);
        extraIds.push(row.insertId);
      }
      for (const id of extraIds.slice(0, 100)) await connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, 1)', [cart.id, id]);
      const body = { merge_id: randomUUID(), items: [{ equipment_id: extraIds[0], quantity: 1 }, { equipment_id: extraIds[100], quantity: 1 }] };
      await assert.rejects(cartService.mergeCart(userOne.id, body), (error) => error.status === 422);
      const cartAfter = await cartService.getCart(userOne.id);
      assert.equal(cartAfter.items.length, 100); assert.equal(cartAfter.items[0].quantity, 1);
      const [[row]] = await connection.execute('SELECT COUNT(*) AS count FROM cart_merge_receipts WHERE merge_id = ?', [body.merge_id]);
      assert.equal(row.count, 0);
      await assert.rejects(cartService.addItem(userOne.id, { equipment_id: extraIds[100], quantity: 1 }), (error) => error.status === 422);
      const same = await cartService.addItem(userOne.id, { equipment_id: extraIds[0], quantity: 1 });
      assert.equal(same.items[0].quantity, 2);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool?.end();
    try { if (created) await connection.query(`DROP DATABASE \`${databaseName}\``); }
    finally { await connection.end(); }
  }
});
