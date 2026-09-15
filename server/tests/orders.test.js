import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { parseCreateOrder, parseOrderId, parseOrderQuery, parseOrderAction } from '../src/modules/orders/orders.validation.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/utils/errors.js';
const body = () => ({ request_id: randomUUID(), character_name: '星河旅人', server: 'star_1', remark: '', items: [{ cart_item_id: 1, equipment_id: 11, quantity: 2, expected_price: 100 }] });
const invalid = (error) => error.status === 422 && error.code === 10001;

test('order validation rejects trusted-price/identity fields, duplicate IDs and invalid quantities', () => {
  const parsed = parseCreateOrder(body()); assert.equal(parsed.items[0].quantity, 2);
  for (const key of ['user_id', 'total', 'actual_total', 'discount', 'status']) assert.throws(() => parseCreateOrder({ ...body(), [key]: 1 }), invalid);
  for (const quantity of [0, -1, 1.2, '2', 10000, null]) assert.throws(() => parseCreateOrder({ ...body(), items: [{ ...body().items[0], quantity }] }), invalid);
  for (const expected_price of [0, -1, 1.5, '100', 1000001]) assert.throws(() => parseCreateOrder({ ...body(), items: [{ ...body().items[0], expected_price }] }), invalid);
  for (const items of [[], [body().items[0], body().items[0]], [{ ...body().items[0], cart_item_id: undefined }]]) assert.throws(() => parseCreateOrder({ ...body(), items }), invalid);
  assert.throws(() => parseCreateOrder({ ...body(), request_id: 'not-uuid' }), invalid);
});

test('redemption fields enforce Unicode length, valid server and optional bounded remark', () => {
  assert.equal(parseCreateOrder({ ...body(), character_name: '  星河  ', remark: undefined }).characterName, '星河');
  for (const character_name of ['', '星', '星'.repeat(11), 'ab\ncd', null]) assert.throws(() => parseCreateOrder({ ...body(), character_name }), invalid);
  assert.equal(parseCreateOrder({ ...body(), character_name: '😀😀' }).characterName, '😀😀');
  for (const server of ['', 'fake', [], null]) assert.throws(() => parseCreateOrder({ ...body(), server }), invalid);
  assert.throws(() => parseCreateOrder({ ...body(), remark: 'a'.repeat(201) }), invalid);
});

test('list filtering uses bounded scalar pagination and real ISO dates; actions accept no money or state', () => {
  assert.deepEqual(parseOrderQuery(), { status: '', from: null, to: null, page: 1, pageSize: 10 });
  for (const query of [{ status: ['paid'] }, { status: 'refunded' }, { user_id: '2' }, { page: '1e3' }, { page: '1000001' }, { page_size: '11' }, { created_from: '2026-02-30T00:00:00Z' }, { created_from: '2026-09-15' }, { created_from: '2026-09-16T00:00:00Z', created_to: '2026-09-15T00:00:00Z' }]) assert.throws(() => parseOrderQuery(query), invalid);
  assert.equal(parseOrderQuery({ page_size: '20', status: 'completed', created_from: '2026-09-15T00:00:00.000Z' }).pageSize, 20);
  for (const id of ['0', '01', '1e2', '4294967296', null]) assert.throws(() => parseOrderId(id), invalid);
  parseOrderAction({}); parseOrderAction(undefined);
  assert.throws(() => parseOrderAction({ amount: 1 }), invalid);
});

test('HTTP order routes enforce user role and use the authenticated owner, including request recovery', async () => {
  const calls = [];
  const authService = { authenticate: async (header) => {
    if (header === 'Bearer user') return { id: 7, role: 'user', status: 'active' };
    if (header === 'Bearer admin') return { id: 1, role: 'admin', status: 'active' };
    throw new AppError(401, 10002, '登录已过期');
  } };
  const orderService = {
    listOrders: async (...args) => { calls.push(['list', ...args]); return { items: [], total: 0, page: 1, page_size: 10 }; },
    createOrder: async (...args) => { calls.push(['create', ...args]); return { order: { id: 1 }, replayed: false }; },
    getOrder: async (...args) => { calls.push(['detail', ...args]); return { id: 1 }; },
    getByRequest: async (...args) => { calls.push(['recover', ...args]); return { order: { id: 1 } }; },
    changeStatus: async (...args) => { calls.push(['action', ...args]); return { id: 1 }; },
  };
  const server = createApp({ authService, orderService, logger: () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/orders`;
    const headers = { authorization: 'Bearer user', 'content-type': 'application/json' };
    for (const path of ['', '/1', '/by-request/x']) {
      assert.equal((await fetch(base + path)).status, 401);
      assert.equal((await fetch(base + path, { headers: { authorization: 'Bearer admin' } })).status, 403);
    }
    assert.equal((await fetch(base, { headers })).headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify(body()) })).status, 201);
    await fetch(base + '/1', { headers }); await fetch(base + '/by-request/batch', { headers });
    await fetch(base + '/1/pay', { method: 'PUT', headers, body: '{}' }); await fetch(base + '/1/cancel', { method: 'PUT', headers, body: '{}' });
    assert.ok(calls.every((call) => call[1] === 7));
    assert.deepEqual(calls.map((call) => call[0]), ['list', 'create', 'detail', 'recover', 'action', 'action']);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
