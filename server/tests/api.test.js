import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { validateMysqlVersion } from '../../database/helpers.js';
import { randomBytes } from 'node:crypto';
import { createTokenService } from '../src/utils/token.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';

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
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=1&page=2', 'page_size=10', 'page_size=12x', 'page=9007199254740991', 'sort=price_asc']) {
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
