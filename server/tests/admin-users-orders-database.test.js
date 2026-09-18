import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';
import { createConnection } from '../src/config/database.js';
import { applySchema } from '../../database/helpers.js';
import { createAdminUserService } from '../src/modules/admin/users/user.service.js';
import { createAdminOrderService } from '../src/modules/admin/orders/order.service.js';
import { createAdminEquipmentService } from '../src/modules/admin/equipments/equipment.service.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokenService } from '../src/utils/token.js';
import { createAdminOverviewService } from '../src/modules/admin/overview/overview.service.js';
import { createApp } from '../src/app.js';
import { createOrderService } from '../src/modules/orders/orders.service.js';
import { createCartService } from '../src/modules/cart/cart.service.js';

test('admin users and orders operate on real data with ownership, stock and soft-delete rules', async (t) => {
  const databaseName = `game_store_admin_orders_${randomBytes(8).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false; let pool; let server;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await applySchema(connection);
    for (const [username, email, role] of [['admin', 'admin@example.test', 'admin'], ['buyer', 'buyer@example.test', 'user'], ['other', 'other@example.test', 'user']]) {
      await connection.execute('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [username, email, 'x'.repeat(60), role]);
    }
    await connection.execute('INSERT INTO carts (user_id) VALUES (2), (3)');
    for (const [name, stock] of [['可取消长剑', 10], ['可完成护甲', 5], ['自由饰品', 3]]) {
      await connection.execute("INSERT INTO equipments (name, price, rarity, category, image, stock, status) VALUES (?, ?, 'R', 'weapon', '/images/equipments/placeholder.svg', ?, 'on_sale')", [name, 100, stock]);
    }
    const [first] = await connection.execute("INSERT INTO orders (order_no, user_id, total, actual_total, character_name, server, status) VALUES ('ORD-PENDING-001', 2, 200, 200, '先锋', 'star_1', 'pending')");
    await connection.execute("INSERT INTO order_items (order_id, equipment_id, equipment_name, equipment_image, rarity, price, quantity) VALUES (?, 1, ?, '/a.svg', 'R', 100, 2)", [first.insertId, '可取消长剑']);
    const [second] = await connection.execute("INSERT INTO orders (order_no, user_id, total, actual_total, character_name, server, status, payment_time) VALUES ('ORD-PAID-002', 2, 100, 100, '先锋', 'star_1', 'paid', CURRENT_TIMESTAMP)");
    await connection.execute("INSERT INTO order_items (order_id, equipment_id, equipment_name, equipment_image, rarity, price, quantity) VALUES (?, 2, ?, '/b.svg', 'R', 100, 1)", [second.insertId, '可完成护甲']);
    await connection.execute("INSERT INTO orders (order_no, user_id, total, actual_total, character_name, server, status, completed_at) VALUES ('ORD-DONE-003', 3, 300, 300, '守望', 'dusk_2', 'completed', CURRENT_TIMESTAMP)");

    pool = mysql.createPool({ ...env.db, database: databaseName, connectionLimit: 5, timezone: 'Z', charset: 'utf8mb4' });
    const runWithConnection = async (run) => { const client = await pool.getConnection(); try { await client.query("SET time_zone = '+00:00'"); return await run(client); } finally { client.release(); } };
    const runWithTransaction = (run) => runWithConnection(async (client) => { await client.beginTransaction(); try { const value = await run(client); await client.commit(); return value; } catch (error) { await client.rollback(); throw error; } });
    const tokens = createTokenService({ secret: randomBytes(32).toString('hex'), expiresIn: '2h' });
    const authService = createAuthService({ tokens, runWithConnection, runWithTransaction });
    const overview = createAdminOverviewService({ runWithConnection });
    const users = createAdminUserService({ runWithConnection });
    const orders = createAdminOrderService({ runWithConnection, runWithTransaction });
    const equipments = createAdminEquipmentService({ runWithConnection });
    server = createApp({ authService, adminServices: { users, orders, equipments, overview }, logger: () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/admin`;
    const headers = { Authorization: `Bearer ${tokens.sign(1)}` };
    const stock = async (id) => (await connection.execute('SELECT stock FROM equipments WHERE id = ?', [id]))[0][0].stock;

    await t.test('overview counts paid/completed amounts and low-stock links match the real equipment list', async () => {
      const summary = await fetch(base + '/overview', { headers });
      assert.equal(summary.status, 200);
      assert.equal(summary.headers.get('cache-control'), 'no-store');
      const initial = (await summary.json()).data;
      assert.equal(initial.pending_orders, 1);
      assert.equal(initial.awaiting_delivery_orders, 1);
      assert.equal(initial.paid_amount, 400);
      assert.equal(initial.low_stock_count, 2);
      for (const [name, stock, status] of [['售罄样本', 0, 'on_sale'], ['下架样本', 1, 'off_sale'], ['删除样本', 0, 'deleted']]) {
        await connection.execute("INSERT INTO equipments (name, price, rarity, category, image, stock, status) VALUES (?, 100, 'N', 'weapon', '/images/equipments/placeholder.svg', ?, ?)", [name, stock, status]);
      }
      const latest = await overview.get();
      assert.equal(latest.low_stock_count, 3);
      const response = await fetch(base + '/equipments?status=on_sale&low_stock=1', { headers });
      const list = (await response.json()).data;
      assert.equal(list.total, latest.low_stock_count);
      assert.deepEqual(list.items.map(item => item.stock).sort((a, b) => a - b), [0, 3, 5]);
      const stocked = await equipments.list({ status: 'on_sale', low_stock: '1', in_stock: '1' });
      assert.equal(stocked.total, 2);
      assert.equal((await fetch(base.replace('/api/admin', '/api/equipments') + '?low_stock=1')).status, 422);
    });

    await t.test('user list exposes safe columns, matches keyword/status and separates pagination', async () => {
      const response = await fetch(`${base}/users?keyword=buyer&status=active`, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = (await response.json()).data;
      assert.equal(data.total, 1);
      assert.equal(data.items[0].username, 'buyer');
      assert.equal(data.items[0].role, 'user');
      assert.equal(Object.hasOwn(data.items[0], 'password_hash'), false);
      assert.equal((await fetch(`${base}/users?status=frozen`, { headers }).then((res) => res.json())).data.total, 0);
      const page = (await fetch(`${base}/users?page_size=20`, { headers }).then((res) => res.json())).data;
      assert.equal(page.items.length, 3);
      assert.equal(page.page_size, 20);
    });

    await t.test('user status only changes normal accounts and a frozen token is immediately rejected', async () => {
      const frozen = await fetch(`${base}/users/2/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'frozen' }) });
      assert.equal(frozen.status, 200);
      assert.equal((await frozen.json()).data.status, 'frozen');
      assert.equal((await fetch(base + '/users/2', { headers: { Authorization: `Bearer ${tokens.sign(2)}` } })).status, 403);
      const restore = await fetch(`${base}/users/2/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
      assert.equal((await restore.json()).data.status, 'active');
      const adminDenied = await fetch(`${base}/users/1/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'frozen' }) });
      assert.equal(adminDenied.status, 403);
      assert.equal((await adminDenied.json()).code, 10003);
    });

    await t.test('order list combines user, status and time filters with snapshot pagination', async () => {
      const filtered = await fetch(`${base}/orders?user_id=2&status=pending`, { headers }).then((res) => res.json());
      assert.equal(filtered.data.total, 1);
      assert.equal(filtered.data.items[0].order_no, 'ORD-PENDING-001');
      const paid = await fetch(`${base}/orders?status=paid`, { headers }).then((res) => res.json());
      assert.equal(paid.data.total, 1);
      const range = await fetch(`${base}/orders?created_from=2026-01-01T00:00:00.000Z&created_to=2099-01-01T00:00:00.000Z`, { headers }).then((res) => res.json());
      assert.equal(range.data.total, 3);
      assert.equal((await fetch(`${base}/orders?user_id=999`, { headers }).then((res) => res.json())).data.total, 0);
      const byNo = await fetch(`${base}/orders?order_no=ORD-PENDING-001`, { headers }).then((res) => res.json());
      assert.equal(byNo.data.total, 1);
      assert.equal(byNo.data.items[0].order_no, 'ORD-PENDING-001');
      assert.equal((await fetch(`${base}/orders?order_no=ORD-PENDING-001&status=pending`, { headers }).then((res) => res.json())).data.total, 1);
      assert.equal((await fetch(`${base}/orders?order_no=ORD-PENDING-001&status=paid`, { headers }).then((res) => res.json())).data.total, 0);
      assert.equal((await fetch(`${base}/orders?order_no=ORD-PAID-002&user_id=2`, { headers }).then((res) => res.json())).data.total, 1);
      assert.equal((await fetch(`${base}/orders?order_no=NO-SUCH-ORDER`, { headers }).then((res) => res.json())).data.total, 0);
      assert.equal((await fetch(`${base}/orders?order_no=  ORD-PAID-002  `, { headers }).then((res) => res.json())).data.total, 1);
    });

    await t.test('order detail returns historical item snapshots regardless of equipment changes', async () => {
      const response = await fetch(`${base}/orders/${first.insertId}`, { headers });
      assert.equal(response.status, 200);
      const detail = (await response.json()).data;
      assert.equal(detail.status, 'pending');
      assert.equal(detail.items.length, 1);
      assert.equal(detail.items[0].equipment_name, '可取消长剑');
      assert.equal(detail.items[0].subtotal, 200);
      await connection.execute("UPDATE equipments SET name = '改名后的剑' WHERE id = 1");
      const after = await fetch(`${base}/orders/${first.insertId}`, { headers }).then((res) => res.json());
      assert.equal(after.data.items[0].equipment_name, '可取消长剑');
      await connection.execute("UPDATE equipments SET name = '可取消长剑' WHERE id = 1");
    });

    await t.test('admin cancellation returns stock once and completion only applies to paid orders', async () => {
      assert.equal(await stock(1), 10);
      const cancel = await fetch(`${base}/orders/${first.insertId}/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
      assert.equal(cancel.status, 200);
      assert.equal((await cancel.json()).data.status, 'cancelled');
      assert.equal(await stock(1), 12);
      const repeated = await fetch(`${base}/orders/${first.insertId}/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
      assert.equal(repeated.status, 200);
      assert.equal(await stock(1), 12);

      const complete = await fetch(`${base}/orders/${second.insertId}/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
      assert.equal(complete.status, 200);
      const completed = (await complete.json()).data;
      assert.equal(completed.status, 'completed');
      assert.ok(completed.completed_at);
      const invalidCancel = await fetch(`${base}/orders/${second.insertId}/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
      assert.equal(invalidCancel.status, 409);
      assert.equal((await invalidCancel.json()).code, 10008);
      const invalidComplete = await fetch(`${base}/orders/${first.insertId}/status`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
      assert.equal(invalidComplete.status, 409);
    });

    await t.test('equipment soft delete is blocked by unfinished orders and idempotent afterwards', async () => {
      await connection.execute("INSERT INTO orders (order_no, user_id, total, actual_total, character_name, server, status) VALUES ('ORD-PENDING-BLOCK', 2, 100, 100, '先锋', 'star_1', 'pending')");
      const [[blockedOrder]] = await connection.execute("SELECT id FROM orders WHERE order_no = 'ORD-PENDING-BLOCK'");
      await connection.execute("INSERT INTO order_items (order_id, equipment_id, equipment_name, equipment_image, rarity, price, quantity) VALUES (?, 3, ?, '/c.svg', 'R', 100, 1)", [blockedOrder.id, '自由饰品']);
      await assert.rejects(equipments.remove(1, '3'), (error) => error.status === 409 && error.code === 10008);
      await connection.execute("UPDATE orders SET status = 'cancelled' WHERE id = ?", [blockedOrder.id]);
      const removed = await equipments.remove(1, '3');
      assert.equal(removed.status, 'deleted');
      assert.equal((await equipments.remove(1, '3')).status, 'deleted');
      assert.equal((await equipments.get('3')).status, 'deleted');
      await assert.rejects(equipments.remove(1, '4294967295'), { status: 404 });
    });

    await t.test('admin routes remain protected for anonymous, normal and frozen accounts', async () => {
      for (const [method, path] of [['GET', '/users'], ['GET', '/orders'], ['DELETE', '/equipments/1']]) {
        assert.equal((await fetch(base + path, { method })).status, 401);
        assert.equal((await fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens.sign(3)}` } })).status, 403);
      }
      await connection.query("UPDATE users SET status = 'frozen' WHERE id = 1");
      assert.equal((await fetch(base + '/users', { headers })).status, 403);
      await connection.query("UPDATE users SET status = 'active' WHERE id = 1");
    });
    await t.test('new accounts receive unique roles, can checkout and retain historical character snapshots', async () => {
      const buyer = await authService.register({ username: 'new_player', email: 'newplayer@example.test', password: 'PreviewOnly42!' });
      assert.deepEqual((await authService.listCharacters(buyer.id)).items, []);
      const ownHeaders = { Authorization: `Bearer ${tokens.sign(buyer.id)}` };
      const endpoint = `${base}/users/${buyer.id}/characters/star_1`;
      const body = { character_name: '新星先锋', expected_name: null };
      const put = (data) => fetch(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      assert.equal((await put(body)).status, 200);
      const replay = (await (await put(body)).json()).data;
      assert.equal(replay.items.length, 1);
      const character = replay.items[0];
      const mineUrl = base.replace('/api/admin', '/api/auth/me/characters');
      const mine = await fetch(`${mineUrl}?user_id=2`, { headers: ownHeaders });
      assert.equal(mine.headers.get('cache-control'), 'no-store');
      assert.equal((await mine.json()).data.items[0].id, character.id);
      const other = await fetch(mineUrl, { headers: { Authorization: `Bearer ${tokens.sign(3)}` } });
      assert.deepEqual((await other.json()).data.items, []);
      assert.equal((await fetch(mineUrl)).status, 401);
      assert.equal((await fetch(mineUrl, { headers })).status, 403);
      assert.equal((await fetch(endpoint, { method: 'PUT', headers: { ...ownHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
      const playerOrders = createOrderService({ runWithConnection, runWithTransaction });
      const cartService = createCartService({ runWithConnection, runWithTransaction });
      const equipment = await equipments.create(1, { name: '角色测试装备', price: 100, stock: 5, rarity: 'N', category: 'weapon', image: '/images/equipments/placeholder.svg', status: 'on_sale' });
      const cart = await cartService.addItem(buyer.id, { equipment_id: equipment.id, quantity: 1 });
      const createdOrder = await playerOrders.createOrder(buyer.id, { request_id: crypto.randomUUID(), server: 'star_1', character_id: character.id, items: cart.items.map(item => ({ cart_item_id: item.id, equipment_id: item.equipment_id, quantity: item.quantity, expected_price: item.price })) });
      assert.equal(createdOrder.order.character_name, '新星先锋');
      const renamed = await put({ character_name: '新星游侠', expected_name: '新星先锋' });
      assert.equal(renamed.status, 200);
      assert.equal((await renamed.json()).data.items[0].id, character.id);
      assert.equal((await playerOrders.getCharacter(buyer.id, { server: 'star_1' })).character.character_name, '新星游侠');
      assert.equal((await playerOrders.getOrder(buyer.id, String(createdOrder.order.id))).character_name, '新星先锋');
      assert.equal((await put({ character_name: '过期修改', expected_name: '新星先锋' })).status, 409);
      await assert.rejects(users.saveCharacter(1, '1', 'star_1', body), { status: 403 });
      await assert.rejects(users.saveCharacter(1, '99999', 'star_1', body), { status: 404 });
      const results = await Promise.allSettled(['暮光角色', '暮光游侠'].map(character_name => users.saveCharacter(1, String(buyer.id), 'dusk_2', { character_name, expected_name: null })));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
      assert.equal((await users.listCharacters(String(buyer.id))).items.length, 2);
      await connection.execute("UPDATE users SET status = 'frozen' WHERE id = ?", [buyer.id]);
      assert.equal((await fetch(mineUrl, { headers: ownHeaders })).status, 403);
    });
  } finally {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool?.end();
      if (created) await connection.query(`DROP DATABASE \`${databaseName}\``);
    } finally { await connection.end(); }
  }
});
