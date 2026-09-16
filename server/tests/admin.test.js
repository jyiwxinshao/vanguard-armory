import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokenService } from '../src/utils/token.js';
import { createAdminEquipmentService } from '../src/modules/admin/equipments/equipment.service.js';
import { parseAdminEquipmentQuery } from '../src/modules/admin/equipments/equipment.validation.js';

const reserved = [
  ['POST', '/equipments'],
  ['PUT', '/equipments/1'], ['PATCH', '/equipments/1/stock'], ['DELETE', '/equipments/1'],
  ['GET', '/users'], ['GET', '/users/1'], ['PUT', '/users/1/status'],
  ['GET', '/orders'], ['GET', '/orders/1'], ['PUT', '/orders/1/status'],
];

async function withAdminServer(run, adminServices = {}) {
  const tokens = createTokenService({ secret: randomBytes(32).toString('hex'), expiresIn: '2h' });
  const account = { id: 42, username: 'admin_test', email: 'admin@example.test', role: 'admin', status: 'active', avatar: null };
  const authService = createAuthService({ tokens, runWithConnection: async (callback) => callback({ execute: async () => [[account]] }) });
  const server = createApp({ authService, adminServices, logger: () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/admin`;
    await run({ account, base, headers: { Authorization: `Bearer ${tokens.sign(42)}` } });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('every admin module rejects anonymous, normal and frozen accounts before its handlers', async () => {
  await withAdminServer(async ({ account, base, headers }) => {
    for (const [method, path] of [['GET', '/me'], ['GET', '/equipments'], ['GET', '/equipments/1'], ...reserved]) {
      assert.equal((await fetch(base + path, { method })).status, 401, path);
      account.role = 'user';
      assert.equal((await fetch(base + path, { method, headers })).status, 403, path);
      account.role = 'admin'; account.status = 'frozen';
      const frozen = await fetch(base + path, { method, headers });
      assert.equal(frozen.status, 403, path);
      assert.equal((await frozen.json()).code, 10006);
      account.status = 'active';
    }
  });
});

test('admin equipment queries share catalog filters but enforce separate pagination and statuses', () => {
  assert.deepEqual(parseAdminEquipmentQuery(), {
    page: 1, pageSize: 10, keyword: '', rarities: [], category: '', sort: 'newest', inStock: false, series: '', status: '',
  });
  const filters = parseAdminEquipmentQuery({ page: '2', page_size: '50', status: 'deleted', rarities: 'SSR,SR,SSR', keyword: ' 刃 ', series: ' eclipse_relics ', in_stock: '1' });
  assert.equal(filters.pageSize, 50);
  assert.deepEqual(filters.rarities, ['SSR', 'SR']);
  assert.equal(filters.keyword, '刃');
  assert.equal(filters.series, 'eclipse_relics');
  assert.equal(filters.status, 'deleted');
  for (const query of [
    { page_size: '12' }, { page_size: '8' }, { page: '0' }, { page: '9007199254740991' },
    { status: ['on_sale', 'deleted'] }, { status: 'all' }, { page: ['1', '2'] },
    { keyword: 'x'.repeat(51) }, { series: 'x'.repeat(65) }, { sort: 'stock_desc' },
    { category: 'bad' }, { rarities: 'SSR,,SR' }, { in_stock: 'true' }, { user_id: '1' }, null,
  ]) assert.throws(() => parseAdminEquipmentQuery(query), { status: 422 });
});

test('admin list validates HTTP input before querying and rolls back a failed snapshot', async () => {
  let connections = 0;
  let rolledBack = false;
  const failure = new Error('simulated page query failure');
  const service = createAdminEquipmentService({ runWithConnection: async (run) => {
    connections++;
    return run({ query: async () => {}, execute: async (sql) => {
      if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
      throw failure;
    }, rollback: async () => { rolledBack = true; }, commit: async () => assert.fail('failed reads must not commit') });
  } });
  await withAdminServer(async ({ base, headers }) => {
    for (const suffix of ['?status=wrong', '?page_size=12', '?page=1&page=2', '?unknown=1']) {
      assert.equal((await fetch(base + '/equipments' + suffix, { headers })).status, 422);
    }
    assert.equal(connections, 0);
  }, { equipments: service });
  await assert.rejects(service.list({}), (error) => error === failure);
  assert.equal(rolledBack, true);
});

test('admin detail validates IDs before querying and distinguishes missing equipment', async () => {
  let connections = 0;
  const service = createAdminEquipmentService({ runWithConnection: async (run) => {
    connections++;
    return run({ execute: async (_sql, params) => { assert.deepEqual(params, [1]); return [[]]; } });
  } });
  await withAdminServer(async ({ base, headers }) => {
    for (const id of ['0', '-1', '1.5', '01', '1e2', '4294967296', 'abc', '1%20OR%201=1']) {
      assert.equal((await fetch(`${base}/equipments/${id}`, { headers })).status, 422);
    }
    assert.equal(connections, 0);
    const response = await fetch(`${base}/equipments/1`, { headers });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).message, '装备不存在');
    assert.equal(connections, 1);
  }, { equipments: service });
});

test('reserved business routes return explicit 501, retain /me and use no-store responses', async () => {
  await withAdminServer(async ({ base, headers }) => {
    const me = await fetch(base + '/me', { headers });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).data.role, 'admin');
    for (const [method, path] of reserved) {
      const response = await fetch(base + path, { method, headers });
      assert.equal(response.status, 501, path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { code: 10011, message: '此管理功能尚未开放', data: null });
    }
    assert.equal((await fetch(base + '/unknown', { headers })).status, 404);
  });
});

test('admin modules accept isolated services and pass the authenticated actor to writes', async () => {
  const calls = [];
  await withAdminServer(async ({ base, headers }) => {
    const denied = await fetch(base + '/equipments');
    assert.equal(denied.status, 401);
    assert.equal(calls.length, 0);
    const list = await fetch(base + '/equipments?status=off_sale', { headers });
    assert.equal(list.status, 200);
    assert.deepEqual(calls[0], { status: 'off_sale' });
    const response = await fetch(base + '/users/9/status', {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'frozen' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls[1], [42, '9', { status: 'frozen' }]);
  }, {
    equipments: { list: async (query) => { calls.push({ ...query }); return { items: [], total: 0 }; } },
    users: { changeStatus: async (...args) => { calls.push(args); return { id: 9, status: 'frozen' }; } },
  });
});
