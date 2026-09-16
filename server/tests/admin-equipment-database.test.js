import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
  } finally {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool?.end();
      if (created) await connection.query(`DROP DATABASE \`${databaseName}\``);
    } finally { await connection.end(); }
  }
});
