import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { validateMysqlVersion } from '../../database/helpers.js';
import { randomBytes } from 'node:crypto';
import { createTokenService } from '../src/utils/token.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { AppError } from '../src/utils/errors.js';
import jwt from 'jsonwebtoken';

async function withServer(overrides, run) {
  const authService = createAuthService({ tokens: createTokenService({ secret: randomBytes(32).toString('hex'), expiresIn: '2h' }) });
  const server = createApp({ logger: () => {}, authService, ...overrides }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health reports ready only when the database check is ready', async () => {
  await withServer({ healthCheck: async () => 'ready' }, async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: 0, message: 'success', data: { service: 'game-store-api', status: 'ready', database: 'ready' },
    });
    assert.equal(response.headers.has('x-powered-by'), false);
  });
});

test('missing tables and failed connections are unavailable, not healthy', async () => {
  for (const state of ['not_initialized', 'schema_mismatch', 'connection_failure']) {
    await withServer({ healthCheck: async () => {
      if (state === 'connection_failure') throw new Error('private database connection details');
      return state;
    } }, async (base) => {
      const response = await fetch(`${base}/api/health`);
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, 10010);
      assert.equal(body.data.database, state === 'connection_failure' ? 'unavailable' : state);
      assert.equal(JSON.stringify(body).includes('private'), false);
    });
  }
});

test('MySQL version suffixes cannot bypass the CHECK support requirement', () => {
  for (const version of ['8.0.15-log', '5.7.44', '10.11.2-MariaDB', 'unknown']) assert.throws(() => validateMysqlVersion(version));
  for (const version of ['8.0.16-log', '8.4.0', '9.4.0']) assert.doesNotThrow(() => validateMysqlVersion(version));
});

test('metadata contains the four grades, four categories and three game servers', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/api/meta`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data.rarities.map((item) => item.value), ['SSR', 'SR', 'R', 'N']);
    assert.equal(data.categories.length, 4);
    assert.equal(data.servers.length, 3);
  });
});

test('equipment pagination is validated before the database is called', async () => {
  let calls = 0;
  await withServer({ equipmentList: async ({ page, pageSize }) => {
    calls++;
    return { items: [], page, page_size: pageSize, total: 0 };
  } }, async (base) => {
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1&page=2', 'page_size=10', 'page_size=12x', 'page=9007199254740991', 'sort=stock_desc', 'keyword=a&keyword=b', 'rarities=SSR&rarities=SR', 'category=weapon&category=armor', 'sort=newest&sort=price_asc', 'rarities=SSR,,SR', 'status=on_sale', 'in_stock=1&in_stock=0', 'in_stock=true', 'in_stock=2']) {
      const response = await fetch(`${base}/api/equipments?${query}`);
      assert.equal(response.status, 422, query);
      const body = await response.json();
      assert.equal(body.code, 10001);
      assert.ok(body.data.errors[0].field);
    }
    assert.equal(calls, 0);
    const response = await fetch(`${base}/api/equipments?page=2&page_size=8`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { items: [], page: 2, page_size: 8, total: 0 });
    assert.equal(calls, 1);
  });
});

test('combined equipment filters reach the service normalized and without authentication', async () => {
  const received = [];
  await withServer({ equipmentList: async (filters) => {
    received.push(filters);
    return { items: [], page: filters.page, page_size: filters.pageSize, total: 2 };
  } }, async (base) => {
    const params = new URLSearchParams({ keyword: '  剑%_\\  ', rarities: 'SSR,SR,SSR', category: 'weapon', sort: 'price_asc', in_stock: '1', page: '2', page_size: '8' });
    const response = await fetch(`${base}/api/equipments?${params}`);
    assert.equal(response.status, 200);
    assert.deepEqual(received[0], { page: 2, pageSize: 8, keyword: '剑%_\\', rarities: ['SSR', 'SR'], category: 'weapon', sort: 'price_asc', inStock: true, series: '' });
    assert.deepEqual((await response.json()).data, { items: [], page: 2, page_size: 8, total: 2 });
    for (const suffix of ['', '?in_stock=', '?in_stock=0']) {
      assert.equal((await fetch(`${base}/api/equipments${suffix}`)).status, 200);
      assert.equal(received.at(-1).inStock, false);
    }
  });
});

test('equipment details validate IDs, preserve zero stock and distinguish hidden records', async () => {
  const soldOut = { id: 7, name: '时隙徽记', price: 99900, stock: 0 };
  const calls = [];
  await withServer({ equipmentDetail: async (id) => {
    calls.push(id);
    if (id === 7) return soldOut;
    if (id === 9) throw new Error('private SELECT database details');
    throw new AppError(404, 10004, '装备不存在或已下架');
  } }, async (base) => {
    for (const id of ['0', '01', '-1', '+1', '1.5', '1x', '4294967296', '%E0%A4', '1%2F2']) {
      const response = await fetch(`${base}/api/equipments/${id}`);
      assert.equal(response.status, 422, id);
      assert.equal((await response.json()).code, 10001);
    }
    assert.deepEqual(calls, []);
    const response = await fetch(`${base}/api/equipments/7`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, soldOut);
    const hidden = await fetch(`${base}/api/equipments/8`);
    assert.equal(hidden.status, 404);
    assert.equal((await hidden.json()).code, 10004);
    const failed = await fetch(`${base}/api/equipments/9`);
    assert.equal(failed.status, 500);
    assert.equal(JSON.stringify(await failed.json()).includes('private'), false);
  });
});

test('JWT-protected routes still validate purpose, current role and frozen status', async () => {
  const secret = randomBytes(32).toString('hex');
  const tokens = createTokenService({ secret, expiresIn: '2h' });
  let currentUser = { id: 42, username: 'api_player', email: 'api@example.test', role: 'user', status: 'active', avatar: null, created_at: new Date(), updated_at: new Date() };
  let reads = 0;
  const authService = createAuthService({ tokens, runWithConnection: async (callback) => callback({ execute: async () => {
    reads++;
    return [[currentUser]];
  } }) });
  const token = tokens.sign(42);
  const invalid = [
    'not-a-token',
    jwt.sign({}, secret, { subject: '42', issuer: 'game-store', audience: 'game-store-web', expiresIn: -1 }),
    jwt.sign({}, secret, { subject: '42', issuer: 'other-service', audience: 'game-store-web', expiresIn: 60 }),
    jwt.sign({}, secret, { subject: '42', issuer: 'game-store', audience: 'game-store-web', algorithm: 'HS384', expiresIn: 60 }),
  ];
  await withServer({ authService }, async (base) => {
    for (const invalidToken of invalid) {
      const response = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${invalidToken}` } });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, 10002);
    }
    assert.equal(reads, 0);
    const headers = { Authorization: `Bearer ${token}` };
    const me = await fetch(`${base}/api/auth/me`, { headers });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get('cache-control'), 'no-store');
    assert.equal((await me.json()).data.id, 42);
    const denied = await fetch(`${base}/api/admin/me`, { headers });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 10003);
    currentUser = { ...currentUser, role: 'admin' };
    assert.equal((await fetch(`${base}/api/admin/me`, { headers })).status, 200);
    const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 200);
    currentUser = { ...currentUser, status: 'frozen' };
    const frozen = await fetch(`${base}/api/auth/me`, { headers });
    assert.equal(frozen.status, 403);
    assert.equal((await frozen.json()).code, 10006);
    currentUser = undefined;
    assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 401);
  });
});

test('unexpected failures do not expose database SQL or credentials', async () => {
  await withServer({ equipmentList: async () => { throw new Error('SELECT password_hash secret_password'); } }, async (base) => {
    const response = await fetch(`${base}/api/equipments`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { code: 99999, message: '服务暂时不可用，请稍后重试', data: null });
  });
});

test('unknown endpoints and malformed JSON use the response envelope', async () => {
  await withServer({}, async (base) => {
    const missing = await fetch(`${base}/api/not-real`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 10004);
    const invalid = await fetch(`${base}/api/not-real`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 422);
    assert.equal((await invalid.json()).code, 10001);
  });
});
