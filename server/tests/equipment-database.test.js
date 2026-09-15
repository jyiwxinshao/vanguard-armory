import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';
import { createConnection } from '../src/config/database.js';
import { applySchema } from '../../database/helpers.js';
import { demoEquipments } from '../../database/equipments.js';
import { createEquipmentService } from '../src/modules/equipments/equipment.service.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokenService } from '../src/utils/token.js';
import { createApp } from '../src/app.js';

test('equipment browsing against an isolated real MySQL database', async (t) => {
  const databaseName = `game_store_catalog_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false;
  let pool;
  let server;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await applySchema(connection);
    const special = (name, price, rarity = 'N', category = 'accessory', status = 'on_sale') => ({
      name, price, rarity, category, status, image: '/images/equipments/placeholder.svg', attack: 0, defense: 0, stock: 6, description: '仅测试描述关键词',
    });
    const fixtures = [
      ...demoEquipments,
      special('强度100%核心', 1200, 'SSR'), special('编号_A核心', 1300, 'SR', 'weapon'),
      special('路径\\核心', 1400), special("冒险者'核心", 1500, 'R'), special('惊叹!核心', 1700),
      special('已删除测试装备', 1800, 'N', 'accessory', 'deleted'),
    ];
    for (const item of fixtures) {
      const [result] = await connection.execute(
        'INSERT INTO equipments (name, price, rarity, category, image, attack, defense, description, stock, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.name, item.price, item.rarity, item.category, item.image, item.attack, item.defense, item.description, item.stock, item.status, '2026-01-01 00:00:00'],
      );
      item.id = result.insertId;
    }
    const visible = fixtures.filter((item) => item.status === 'on_sale');
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
    const equipment = createEquipmentService({ runWithConnection, runWithTransaction });
    const authService = createAuthService({ tokens: createTokenService({ secret: randomBytes(32).toString('hex') }) });
    server = createApp({ equipmentList: equipment.listEquipments, equipmentDetail: equipment.getEquipmentById, authService, logger: () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/equipments`;
    const request = async (suffix = '') => {
      const response = await fetch(`${base}${suffix}`);
      return { status: response.status, body: await response.json() };
    };
    const list = async (params = {}) => {
      const result = await request(`?${new URLSearchParams(params)}`);
      assert.equal(result.status, 200, JSON.stringify(params));
      return result.body.data;
    };
    const ids = (items) => items.map((item) => item.id);

    await t.test('public pagination includes sold-out equipment and excludes hidden inventory', async () => {
      const first = await list({ page_size: 8 });
      const second = await list({ page: 2, page_size: 8 });
      const third = await list({ page: 3, page_size: 8 });
      assert.equal(first.total, visible.length);
      assert.equal(first.items.length, 8);
      assert.equal(second.page, 2);
      assert.deepEqual(ids([...first.items, ...second.items, ...third.items]), ids(visible.toReversed()));
      assert.ok([...first.items, ...second.items, ...third.items].some((item) => item.stock === 0));
      assert.ok(first.items.every((item) => !('status' in item) && !('password_hash' in item)));
    });

    await t.test('combined category, multiple rarity and keyword filters use the same total as results', async () => {
      const result = await list({ category: 'weapon', rarities: 'SSR,SR,SSR', keyword: '  刃  ', sort: 'price_asc', page_size: 8 });
      assert.equal(result.total, 1);
      assert.deepEqual(result.items.map((item) => item.name), ['灰烬巨刃']);
      const multiple = await list({ category: 'armor', rarities: 'SSR,SR', page_size: 8 });
      assert.equal(multiple.total, 2);
      assert.ok(multiple.items.every((item) => item.category === 'armor' && ['SSR', 'SR'].includes(item.rarity)));
      const nameOnly = await list({ keyword: '仅测试描述关键词' });
      assert.equal(nameOnly.total, 0);
    });

    await t.test('in-stock filtering applies to the whole catalog before counting and paging', async () => {
      const stocked = visible.filter((item) => item.stock > 0);
      const pages = await Promise.all([1, 2, 3].map((page) => list({ in_stock: '1', page, page_size: 8 })));
      assert.ok(pages.every((page) => page.total === stocked.length));
      assert.deepEqual(ids(pages.flatMap((page) => page.items)), ids(stocked.toReversed()));
      assert.ok(pages.flatMap((page) => page.items).every((item) => item.stock > 0));
      assert.equal(pages[0].items.length, 8);
      assert.equal(pages[1].items.length, 8);
      assert.equal((await list({ in_stock: '0' })).total, visible.length);
      assert.equal((await list({ in_stock: '' })).total, visible.length);

      const allLegendaryAccessories = await list({ category: 'accessory', rarities: 'SSR' });
      const stockedLegendaryAccessories = await list({ category: 'accessory', rarities: 'SSR,SSR', in_stock: '1', sort: 'price_asc' });
      const expected = stocked.filter((item) => item.category === 'accessory' && item.rarity === 'SSR').sort((a, b) => a.price - b.price || b.id - a.id);
      assert.ok(allLegendaryAccessories.total > stockedLegendaryAccessories.total);
      assert.equal(stockedLegendaryAccessories.total, expected.length);
      assert.deepEqual(ids(stockedLegendaryAccessories.items), ids(expected));
      const literalKeyword = await list({ keyword: '%', category: 'accessory', rarities: 'SSR', in_stock: '1' });
      assert.equal(literalKeyword.total, 1);
      assert.equal(literalKeyword.items[0].name, '强度100%核心');

      const beyond = await list({ in_stock: '1', page: 999, page_size: 8 });
      assert.equal(beyond.total, stocked.length);
      assert.equal(beyond.page, 999);
      assert.deepEqual(beyond.items, []);
      const soldOut = visible.find((item) => item.stock === 0);
      assert.equal((await list({ in_stock: '1', keyword: soldOut.name })).total, 0);
      const detail = await request(`/${soldOut.id}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.data.stock, 0);
    });

    await t.test('search treats wildcard, escape and quote characters literally', async () => {
      for (const [keyword, name] of [['%', '强度100%核心'], ['_', '编号_A核心'], ['\\', '路径\\核心'], ["'", "冒险者'核心"], ['!', '惊叹!核心']]) {
        const result = await list({ keyword });
        assert.equal(result.total, 1, keyword);
        assert.equal(result.items[0].name, name);
      }
      assert.equal((await list({ keyword: "' OR 1=1 --" })).total, 0);
      assert.equal((await list({ keyword: '%_' })).total, 0);
    });

    await t.test('price and rarity ordering are stable across pages and tied values', async () => {
      const rarityRank = { SSR: 4, SR: 3, R: 2, N: 1 };
      for (const [sort, compare] of [
        ['price_asc', (a, b) => a.price - b.price || b.id - a.id],
        ['price_desc', (a, b) => b.price - a.price || b.id - a.id],
        ['rarity_desc', (a, b) => rarityRank[b.rarity] - rarityRank[a.rarity] || b.id - a.id],
      ]) {
        const first = await list({ sort, page_size: 16 });
        const second = await list({ sort, page_size: 16, page: 2 });
        assert.deepEqual(ids([...first.items, ...second.items]), ids([...visible].sort(compare)), sort);
      }
    });

    await t.test('empty filters, no-match results and out-of-range pages have predictable envelopes', async () => {
      assert.equal((await list({ keyword: '', rarities: '', category: '', sort: '' })).total, visible.length);
      assert.deepEqual((await list({ keyword: '绝对不存在的装备' })).items, []);
      const beyond = await list({ page: 999, page_size: 8 });
      assert.equal(beyond.page, 999);
      assert.equal(beyond.total, visible.length);
      assert.deepEqual(beyond.items, []);
    });

    await t.test('details expose the sold-out item but never off-sale, deleted or missing equipment', async () => {
      const soldOut = visible.find((item) => item.stock === 0);
      const result = await request(`/${soldOut.id}`);
      assert.equal(result.status, 200);
      assert.equal(result.body.data.name, soldOut.name);
      assert.equal(result.body.data.stock, 0);
      assert.equal(result.body.data.price, soldOut.price);
      for (const id of [...fixtures.filter((item) => item.status !== 'on_sale').map((item) => item.id), 4294967295]) {
        const hidden = await request(`/${id}`);
        assert.equal(hidden.status, 404);
        assert.equal(hidden.body.code, 10004);
      }
      const target = visible[0];
      await connection.execute("UPDATE equipments SET status = 'off_sale' WHERE id = ?", [target.id]);
      assert.equal((await request(`/${target.id}`)).status, 404);
      assert.equal((await list()).total, visible.length - 1);
      await connection.execute("UPDATE equipments SET status = 'on_sale' WHERE id = ?", [target.id]);
    });

    await t.test('HTTP query arrays, invalid enums and malformed identifiers are rejected', async () => {
      for (const suffix of [
        '?keyword=a&keyword=b', '?rarities=SSR&rarities=SR', '?category=weapon&category=armor',
        '?sort=price_asc&sort=newest', '?rarities=BAD', '?rarities=SSR,,SR', '?category=anything',
        '?sort=stock_desc', '?status=off_sale', '?page=0', '?page=1.5', '?page_size=10',
        '?in_stock=1&in_stock=0', '?in_stock=true', '?in_stock=2', '?in_stock=%201%20',
        `?keyword=${encodeURIComponent('长'.repeat(51))}`, '/0', '/-1', '/1.5', '/1abc', '/4294967296',
      ]) {
        const result = await request(suffix);
        assert.equal(result.status, 422, suffix);
        assert.equal(result.body.code, 10001, suffix);
      }
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool?.end();
    try { if (created) await connection.query(`DROP DATABASE \`${databaseName}\``); }
    finally { await connection.end(); }
  }
});
