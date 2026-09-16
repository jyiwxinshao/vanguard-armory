import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';
import { createConnection } from '../src/config/database.js';
import { applySchema } from '../../database/helpers.js';
import { createAdminEquipmentService } from '../src/modules/admin/equipments/equipment.service.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokenService } from '../src/utils/token.js';
import { createApp } from '../src/app.js';

test('admin equipment lists use real permissions, filters and consistent read-only pagination', async (t) => {
  const databaseName = `game_store_admin_list_${randomBytes(10).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false;
  let pool;
  let server;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await applySchema(connection);
    for (const role of ['admin', 'user']) {
      await connection.execute('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [role, `${role}@example.test`, 'x'.repeat(60), role]);
    }
    for (let index = 1; index <= 27; index++) {
      await connection.execute(
        `INSERT INTO equipments (name, price, rarity, category, image, stock, status, series_code, created_at)
         VALUES (?, ?, ?, ?, '/images/equipments/placeholder.svg', ?, ?, ?, '2026-01-01 00:00:00')`,
        [index === 1 ? '符号%_!\\装备' : `测试装备${index}`, index * 100, index % 2 ? 'SSR' : 'SR', index % 2 ? 'weapon' : 'armor',
          index === 3 ? 0 : 5, index > 25 ? 'deleted' : index > 22 ? 'off_sale' : 'on_sale', index <= 6 ? 'eclipse_relics' : null],
      );
    }
    pool = mysql.createPool({ ...env.db, database: databaseName, connectionLimit: 4, timezone: 'Z', charset: 'utf8mb4' });
    const runWithConnection = async (run) => {
      const client = await pool.getConnection();
      try { await client.query("SET time_zone = '+00:00'"); return await run(client); }
      finally { client.release(); }
    };
    const tokens = createTokenService({ secret: randomBytes(32).toString('hex'), expiresIn: '2h' });
    const authService = createAuthService({ tokens, runWithConnection });
    const equipmentService = createAdminEquipmentService({ runWithConnection });
    server = createApp({ authService, adminServices: { equipments: equipmentService }, logger: () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/admin/equipments`;
    const headers = { Authorization: `Bearer ${tokens.sign(1)}` };
    const list = async (query = {}) => {
      const response = await fetch(`${base}?${new URLSearchParams(query)}`, { headers });
      assert.equal(response.status, 200);
      return (await response.json()).data;
    };
    await t.test('default pages include off-sale items but exclude deleted items without gaps or duplicates', async () => {
      const pages = await Promise.all([1, 2, 3].map((page) => list({ page })));
      assert.deepEqual(pages.map((page) => page.items.length), [10, 10, 5]);
      assert.ok(pages.every((page) => page.total === 25 && page.page_size === 10));
      assert.deepEqual(pages.flatMap((page) => page.items.map((item) => item.id)), Array.from({ length: 25 }, (_, i) => 25 - i));
      assert.ok(pages[0].items.some((item) => item.status === 'off_sale'));
      assert.equal((await list({ status: 'deleted' })).total, 2);
      assert.equal((await list({ status: 'on_sale' })).total, 22);
      assert.equal((await list({ status: 'off_sale' })).total, 3);
      const beyond = await list({ page: 99, page_size: 50 });
      assert.equal(beyond.total, 25);
      assert.deepEqual(beyond.items, []);
      assert.equal((await list({ page_size: 20 })).items.length, 20);
    });
    await t.test('compound filters share totals, search treats special characters literally, and sorting is stable', async () => {
      const filtered = await list({ series: 'eclipse_relics', category: 'weapon', rarities: 'SSR,SR', in_stock: 1, sort: 'price_asc' });
      assert.equal(filtered.total, 2);
      assert.deepEqual(filtered.items.map((item) => item.id), [1, 5]);
      for (const keyword of ['%', '_', '!', '\\', '%_!\\']) {
        const result = await list({ keyword });
        assert.equal(result.total, 1);
        assert.equal(result.items[0].id, 1);
      }
      assert.equal((await list({ keyword: "' OR 1=1 --" })).total, 0);
      assert.equal((await list({ sort: 'rarity_desc' })).items[0].id, 25);
      assert.equal((await list({ sort: 'price_desc' })).items[0].price, 2500);
    });
    await t.test('real user and frozen admin accounts are rejected using the same already-issued token', async () => {
      assert.equal((await fetch(base)).status, 401);
      assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${tokens.sign(2)}` } })).status, 403);
      await connection.query("UPDATE users SET status = 'frozen' WHERE id = 1");
      assert.equal((await fetch(base, { headers })).status, 403);
      await connection.query("UPDATE users SET status = 'active' WHERE id = 1");
      assert.equal((await list()).total, 25);
    });
    await t.test('admin detail reads all statuses and sold-out equipment without exposing them publicly', async () => {
      await connection.query("UPDATE equipments SET attack = 620, defense = 0, description = '档案介绍', new_until = '2099-01-01 00:00:00' WHERE id = 1");
      for (const [id, status] of [[1, 'on_sale'], [3, 'on_sale'], [23, 'off_sale'], [26, 'deleted']]) {
        const response = await fetch(`${base}/${id}`, { headers });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const detail = (await response.json()).data;
        assert.equal(detail.id, id);
        assert.equal(detail.status, status);
        assert.equal(detail.price, id * 100);
        assert.ok(detail.created_at && detail.updated_at);
        if (id === 3) assert.equal(detail.stock, 0);
        if (id === 1) {
          assert.equal(detail.attack, 620);
          assert.equal(detail.defense, 0);
          assert.equal(detail.description, '档案介绍');
          assert.equal(detail.series_code, 'eclipse_relics');
          assert.equal(detail.is_new, 1);
        }
      }
      // Use the same isolated database for the public visibility boundary.
      const { createEquipmentService } = await import('../src/modules/equipments/equipment.service.js');
      const publicService = createEquipmentService({ runWithConnection });
      for (const id of ['23', '26']) await assert.rejects(publicService.getEquipmentById(id), { status: 404 });
      assert.equal((await publicService.getEquipmentById('3')).stock, 0);
      assert.equal((await fetch(`${base}/4294967295`, { headers })).status, 404);
      assert.equal((await fetch(`${base}/1`)).status, 401);
      assert.equal((await fetch(`${base}/1`, { headers: { Authorization: `Bearer ${tokens.sign(2)}` } })).status, 403);
      await connection.query("UPDATE users SET status = 'frozen' WHERE id = 1");
      assert.equal((await fetch(`${base}/1`, { headers })).status, 403);
      await connection.query("UPDATE users SET status = 'active' WHERE id = 1");
    });
    await t.test('a concurrent insert between count and rows cannot split the list snapshot', async () => {
      let inserted = false;
      const snapshotService = createAdminEquipmentService({ runWithConnection: (run) => runWithConnection((client) => run({
        query: (...args) => client.query(...args), commit: () => client.commit(), rollback: () => client.rollback(),
        execute: async (sql, values) => {
          const result = await client.execute(sql, values);
          if (sql.includes('COUNT(*)') && !inserted) {
            inserted = true;
            await connection.query("INSERT INTO equipments (name, price, rarity, category, image, stock, status) VALUES ('并发新增', 100, 'N', 'weapon', '/test.png', 1, 'on_sale')");
          }
          return result;
        },
      })) });
      const result = await snapshotService.list({ page_size: '50' });
      assert.equal(result.total, 25);
      assert.equal(result.items.length, 25);
      assert.ok(!result.items.some((item) => item.name === '并发新增'));
      assert.equal((await list()).total, 26);
    });
    await t.test('creation persists exact amounts and fields, controls visibility and rolls back failed reads', async () => {
      const body = { name: ' 新增验证 ', price: 29, rarity: 'SR', category: 'weapon', image: '/images/equipments/placeholder.svg', stock: 5, attack: 68, defense: 0, description: '两行\n介绍', series_code: 'test_series', new_until: '2099-01-01T12:30:00.000Z' };
      const response = await fetch(base, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const createdItem = (await response.json()).data;
      assert.equal(createdItem.status, 'off_sale');
      assert.equal(createdItem.name, '新增验证');
      assert.equal(createdItem.price, 29);
      assert.equal(createdItem.stock, 5);
      assert.equal(createdItem.attack, 68);
      assert.equal(createdItem.defense, 0);
      assert.equal(createdItem.description, body.description);
      assert.equal(createdItem.series_code, body.series_code);
      assert.equal(createdItem.new_until, body.new_until);
      const { createEquipmentService } = await import('../src/modules/equipments/equipment.service.js');
      const publicService = createEquipmentService({ runWithConnection });
      await assert.rejects(publicService.getEquipmentById(String(createdItem.id)), { status: 404 });
      const live = await equipmentService.create(1, { ...body, name: '立即上架', status: 'on_sale' });
      assert.equal((await publicService.getEquipmentById(String(live.id))).price, 29);
      const failing = createAdminEquipmentService({ runWithConnection: (run) => runWithConnection((client) => run({
        beginTransaction: () => client.beginTransaction(), commit: () => client.commit(), rollback: () => client.rollback(),
        execute: async (sql, args) => { if (sql.startsWith('SELECT')) throw new Error('read-back failed'); return client.execute(sql, args); },
      })) });
      await assert.rejects(failing.create(1, { ...body, name: '回滚验证' }), /read-back failed/);
      const [[{ count }]] = await connection.query("SELECT COUNT(*) AS count FROM equipments WHERE name = '回滚验证'");
      assert.equal(count, 0);
    });
    await t.test('editing changes visibility and metadata while preserving stock and historical snapshots', async () => {
      const original = await equipmentService.create(1, { name: '旧快照', price: 500, rarity: 'R', category: 'weapon', image: '/images/equipments/placeholder.svg', stock: 9, status: 'on_sale' });
      const read = () => equipmentService.get(String(original.id));
      const payload = (item, changes = {}) => ({ ...Object.fromEntries(['name', 'price', 'rarity', 'category', 'image', 'attack', 'defense', 'status', 'description', 'series_code', 'new_until', 'edit_version'].map((key) => [key, item[key]])), ...changes });
      const baseline = await read();
      const [order] = await connection.execute("INSERT INTO orders (order_no, user_id, total, actual_total, character_name, server) VALUES ('admin-edit-snapshot', 2, 500, 500, '先锋', 'star_1')");
      await connection.execute('INSERT INTO order_items (order_id, equipment_id, equipment_name, equipment_image, rarity, price, quantity) VALUES (?, ?, ?, ?, ?, ?, 1)', [order.insertId, original.id, original.name, original.image, original.rarity, original.price]);
      // Simulate an inventory transaction holding the same row while the editor saves.
      const inventory = await pool.getConnection();
      let started;
      const waitingForLock = new Promise((resolve) => { started = resolve; });
      const lockedService = createAdminEquipmentService({ runWithConnection: (run) => runWithConnection((client) => run({
        beginTransaction: () => client.beginTransaction(), commit: () => client.commit(), rollback: () => client.rollback(),
        execute: (sql, args) => { const result = client.execute(sql, args); if (sql.includes('FOR UPDATE')) started(); return result; },
      })) });
      let saving;
      try {
        await inventory.beginTransaction();
        await inventory.execute('UPDATE equipments SET stock = stock - 2 WHERE id = ?', [original.id]);
        saving = lockedService.update(1, String(original.id), payload(baseline, { name: '新资料', price: 29, status: 'off_sale', series_code: 'updated_series' }));
        await waitingForLock;
        await inventory.commit();
        const edited = await saving;
        assert.equal(edited.stock, 7);
        assert.equal(edited.price, 29);
        assert.equal(edited.status, 'off_sale');
        assert.notEqual(edited.edit_version, baseline.edit_version);
      } finally { await inventory.rollback(); inventory.release(); await saving; }
      const { createEquipmentService } = await import('../src/modules/equipments/equipment.service.js');
      const publicService = createEquipmentService({ runWithConnection });
      await assert.rejects(publicService.getEquipmentById(String(original.id)), { status: 404 });
      const stale = await fetch(`${base}/${original.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload(baseline)) });
      assert.equal(stale.status, 409);
      const latest = await read();
      const response = await fetch(`${base}/${original.id}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload(latest, { status: 'on_sale', description: null, series_code: null, new_until: null })) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal((await publicService.getEquipmentById(String(original.id))).price, 29);
      const [[snapshot]] = await connection.execute('SELECT equipment_name, price FROM order_items WHERE order_id = ?', [order.insertId]);
      assert.deepEqual(snapshot, { equipment_name: '旧快照', price: 500 });
      const fresh = await read();
      const competing = await Promise.allSettled(['编辑甲', '编辑乙'].map((name) => equipmentService.update(1, String(original.id), payload(fresh, { name }))));
      assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(competing.find((result) => result.status === 'rejected').reason.status, 409);
      const beforeFailure = await read();
      const failing = createAdminEquipmentService({ runWithConnection: (run) => runWithConnection((client) => run({
        beginTransaction: () => client.beginTransaction(), commit: () => client.commit(), rollback: () => client.rollback(),
        execute: (sql, args) => { if (sql.startsWith('SELECT') && !sql.includes('FOR UPDATE')) throw new Error('edit read-back failed'); return client.execute(sql, args); },
      })) });
      await assert.rejects(failing.update(1, String(original.id), payload(beforeFailure, { name: '必须回滚' })), /edit read-back failed/);
      assert.equal((await read()).name, beforeFailure.name);
      await connection.execute("UPDATE equipments SET status = 'deleted' WHERE id = ?", [original.id]);
      await assert.rejects(equipmentService.update(1, String(original.id), payload(await read(), { status: 'on_sale' })), { status: 409 });
      await assert.rejects(equipmentService.update(1, '4294967295', payload(beforeFailure)), { status: 404 });
    });
    await t.test('inventory receipts replay success/rejection and bind actor, equipment and delta', async () => {
      const item = await equipmentService.create(1, { name: '库存验证', price: 100, rarity: 'N', category: 'weapon', image: '/images/equipments/placeholder.svg', stock: 10 });
      const adjust = (body, actor = 1, id = item.id) => equipmentService.adjustStock(actor, String(id), body);
      const request = { request_id: randomUUID(), delta: 5 };
      const first = await adjust(request);
      assert.equal(first.outcome, 'applied'); assert.equal(first.stock_before, 10); assert.equal(first.stock_after, 15);
      const repeated = await Promise.all([adjust(request), adjust(request)]);
      assert.ok(repeated.every((value) => value.replayed && value.stock_after === 15));
      assert.equal((await equipmentService.get(String(item.id))).stock, 15);
      await assert.rejects(adjust({ ...request, delta: 6 }), { status: 409 });
      await assert.rejects(adjust(request, 2), { status: 409 });
      await assert.rejects(adjust(request, 1, 1), { status: 409 });
      const rejected = { request_id: randomUUID(), delta: -16 };
      assert.equal((await adjust(rejected)).rejection_reason, 'insufficient_stock');
      await adjust({ request_id: randomUUID(), delta: 10 });
      assert.equal((await adjust(rejected)).outcome, 'rejected');
      assert.equal((await equipmentService.get(String(item.id))).stock, 25);
      await connection.execute('UPDATE equipments SET stock = 4294967295 WHERE id = ?', [item.id]);
      assert.equal((await adjust({ request_id: randomUUID(), delta: 1 })).rejection_reason, 'stock_overflow');
      await connection.execute("UPDATE equipments SET status = 'deleted' WHERE id = ?", [item.id]);
      assert.equal((await adjust({ request_id: randomUUID(), delta: -1 })).rejection_reason, 'deleted');
      assert.equal((await adjust(request)).outcome, 'applied');
      const httpResult = await fetch(`${base}/${item.id}/stock`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      assert.equal(httpResult.status, 200); assert.equal(httpResult.headers.get('cache-control'), 'no-store');
      const beforeMigration = (await connection.query('SELECT * FROM inventory_adjustments ORDER BY request_id'))[0];
      await applySchema(connection);
      assert.deepEqual((await connection.query('SELECT * FROM inventory_adjustments ORDER BY request_id'))[0], beforeMigration);
    });
    await t.test('concurrent inventory requests apply once and failed receipt writes roll back stock', async () => {
      const item = await equipmentService.create(1, { name: '库存竞争', price: 100, rarity: 'N', category: 'weapon', image: '/images/equipments/placeholder.svg', stock: 10 });
      const request = { request_id: randomUUID(), delta: -7 };
      const duplicates = await Promise.all([1, 2, 3].map(() => equipmentService.adjustStock(1, String(item.id), request)));
      assert.equal(duplicates.filter((value) => !value.replayed).length, 1);
      assert.equal((await equipmentService.get(String(item.id))).stock, 3);
      const competing = await Promise.all([1, 2].map(() => equipmentService.adjustStock(1, String(item.id), { request_id: randomUUID(), delta: -2 })));
      assert.equal(competing.filter((value) => value.outcome === 'applied').length, 1);
      assert.equal((await equipmentService.get(String(item.id))).stock, 1);
      const failRequest = { request_id: randomUUID(), delta: 6 };
      const failing = createAdminEquipmentService({ runWithConnection: (run) => runWithConnection((client) => run({
        beginTransaction: () => client.beginTransaction(), commit: () => client.commit(), rollback: () => client.rollback(),
        execute: (sql, args) => { if (sql.startsWith('UPDATE inventory_adjustments')) throw new Error('receipt write failed'); return client.execute(sql, args); },
      })) });
      await assert.rejects(failing.adjustStock(1, String(item.id), failRequest), /receipt write failed/);
      assert.equal((await equipmentService.get(String(item.id))).stock, 1);
      const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM inventory_adjustments WHERE request_id = ?', [failRequest.request_id]);
      assert.equal(total, 0);
      assert.equal((await equipmentService.adjustStock(1, String(item.id), failRequest)).stock_after, 7);
    });
    await t.test('checkout and cancellation racing stock adjustments preserve the inventory equation', async () => {
      const { createOrderService } = await import('../src/modules/orders/orders.service.js');
      const runWithTransaction = (run) => runWithConnection(async (client) => { await client.beginTransaction(); try { const value = await run(client); await client.commit(); return value; } catch (error) { await client.rollback(); throw error; } });
      const orders = createOrderService({ runWithConnection, runWithTransaction });
      const item = await equipmentService.create(1, { name: '下单库存竞争', price: 100, rarity: 'N', category: 'weapon', image: '/images/equipments/placeholder.svg', stock: 10, status: 'on_sale' });
      const [cart] = await connection.execute('INSERT INTO carts (user_id) VALUES (2)');
      const [line] = await connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, 3)', [cart.insertId, item.id]);
      const orderBody = { request_id: randomUUID(), character_name: '先锋', server: 'star_1', remark: '', items: [{ cart_item_id: line.insertId, equipment_id: item.id, quantity: 3, expected_price: 100 }] };
      const [sale, adjustment] = await Promise.allSettled([
        orders.createOrder(2, orderBody), equipmentService.adjustStock(1, String(item.id), { request_id: randomUUID(), delta: -8 }),
      ]);
      assert.equal(adjustment.status, 'fulfilled');
      const applied = adjustment.value.outcome === 'applied';
      const sold = sale.status === 'fulfilled';
      assert.notEqual(applied, sold);
      assert.equal((await equipmentService.get(String(item.id))).stock, 10 - (applied ? 8 : 0) - (sold ? 3 : 0));
      if (!sold) {
        await equipmentService.adjustStock(1, String(item.id), { request_id: randomUUID(), delta: 8 });
      }
      const order = sold ? sale.value.order : (await orders.createOrder(2, orderBody)).order;
      const before = (await equipmentService.get(String(item.id))).stock;
      const [cancel, reduction] = await Promise.all([
        orders.changeStatus(2, String(order.id), 'cancel', {}), equipmentService.adjustStock(1, String(item.id), { request_id: randomUUID(), delta: -9 }),
      ]);
      assert.equal(cancel.status, 'cancelled');
      assert.equal((await equipmentService.get(String(item.id))).stock, before + 3 - (reduction.outcome === 'applied' ? 9 : 0));
    });
  } finally {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool?.end();
      if (created) await connection.query(`DROP DATABASE \`${databaseName}\``);
    } finally { await connection.end(); }
  }
});
