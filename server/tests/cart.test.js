import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { AppError } from '../src/utils/errors.js';
import {
  CART_ITEM_QUANTITY_MAX,
  createCartService,
  parseAddItem,
  parseCartItemId,
  parseUpdateItem,
} from '../src/modules/cart/cart.service.js';

const isValidation = (field) => (error) => error.status === 422 && error.code === 10001 && error.data.errors[0].field === field;

test('cart body and identifier validation enforce positive integers and quantity caps', () => {
  assert.deepEqual(parseAddItem({ equipment_id: 1, quantity: 2 }), { equipmentId: 1, quantity: 2 });
  assert.deepEqual(parseUpdateItem({ quantity: 9999 }), { quantity: 9999 });
  assert.equal(parseCartItemId('1'), 1);
  assert.equal(parseCartItemId(4294967295), 4294967295);

  for (const body of [null, undefined, [], '1']) assert.throws(() => parseAddItem(body), isValidation('body'));
  assert.throws(() => parseAddItem({}), isValidation('equipment_id'));
  assert.throws(() => parseAddItem({ equipment_id: 1, quantity: 2, price: 100 }), isValidation('price'));
  for (const equipment_id of [undefined, '1', 0, -1, 1.5, 4294967296, null, true]) {
    assert.throws(() => parseAddItem({ equipment_id, quantity: 1 }), isValidation('equipment_id'));
  }
  for (const quantity of [undefined, '1', 0, -1, 1.5, null, true, CART_ITEM_QUANTITY_MAX + 1]) {
    assert.throws(() => parseAddItem({ equipment_id: 1, quantity }), isValidation('quantity'));
  }
  assert.throws(() => parseUpdateItem({ quantity: 0 }), isValidation('quantity'));
  assert.throws(() => parseUpdateItem({ quantity: CART_ITEM_QUANTITY_MAX + 1 }), isValidation('quantity'));
  assert.throws(() => parseUpdateItem({ quantity: 1, equipment_id: 2 }), isValidation('equipment_id'));
  for (const value of ['', '0', '01', '-1', '+1', '1.0', '1x', '1e2', ' 1', '4294967296', ['1'], null, 1.5]) {
    assert.throws(() => parseCartItemId(value), isValidation('id'));
  }
});

function cartHarness(handlers, state = {}) {
  const events = [];
  const connection = {
    beginTransaction: async () => { events.push({ type: 'begin' }); },
    commit: async () => { events.push({ type: 'commit' }); },
    rollback: async () => { events.push({ type: 'rollback' }); },
    query: async (sql) => { events.push({ type: 'query', sql }); },
    execute: async (sql, parameters = []) => {
      events.push({ type: 'execute', sql, parameters: [...parameters] });
      const handler = handlers.find(([matcher]) => matcher(sql));
      if (!handler) throw new Error(`unhandled execute: ${sql}`);
      return handler[1](sql, [...parameters], { events, state });
    },
  };
  const runWithConnection = async (callback) => callback(connection);
  const runWithTransaction = async (callback) => {
    await connection.beginTransaction();
    try {
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  };
  return { service: createCartService({ runWithConnection, runWithTransaction }), events, state };
}

test('getCart maps live equipment data and calculates subtotals and total server-side', async () => {
  const rows = [
    { id: 1, equipment_id: 11, quantity: 2, name: '晨星长剑', image: '/images/equipments/placeholder.svg', price: 12900, rarity: 'R', category: 'weapon', stock: 24, status: 'on_sale' },
    { id: 2, equipment_id: 12, quantity: 3, name: '生命药剂', image: '/images/equipments/placeholder.svg', price: 800, rarity: 'N', category: 'consumable', stock: 200, status: 'on_sale' },
  ];
  const { service } = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 7 }]]],
    [(sql) => sql.includes('FROM cart_items ci'), () => [rows]],
  ]);
  const result = await service.getCart(42);
  assert.deepEqual(result, {
    items: [
      { ...rows[0], subtotal: 25800, available: true, reason: null },
      { ...rows[1], subtotal: 2400, available: true, reason: null },
    ],
    total_price: 28200, available_total_price: 28200, invalid_count: 0, checkout_allowed: true,
  });
});

test('addItem accumulates existing quantity and never deducts equipment stock', async () => {
  const { service, events, state } = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT id, stock FROM equipments'), () => [[{ id: 11, stock: 5 }]]],
    [(sql) => sql.includes('SELECT quantity FROM cart_items'), () => [[{ quantity: state.existing }]]],
    [(sql) => sql.startsWith('UPDATE cart_items'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.startsWith('SELECT COUNT(*) AS count'), () => [[{ count: 0 }]]],
    [(sql) => sql.startsWith('INSERT INTO cart_items'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.startsWith('UPDATE carts'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.includes('FROM cart_items ci'), () => [[{ id: 3, equipment_id: 11, quantity: 5, name: '晨星长剑', image: '', price: 12900, rarity: 'R', category: 'weapon', stock: 5 }]]],
  ], { existing: 2 });

  const result = await service.addItem(42, { equipment_id: 11, quantity: 3 });
  assert.equal(result.total_price, 64500);
  const update = events.find(({ type, sql }) => type === 'execute' && sql.startsWith('UPDATE cart_items'));
  assert.deepEqual(update.parameters, [5, 9, 11]);
  assert.equal(events.some(({ sql }) => /UPDATE equipments/.test(sql)), false);
});

test('addItem inserts a new row when the equipment is not already in the cart', async () => {
  const { service, events } = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT id, stock FROM equipments'), () => [[{ id: 11, stock: 4 }]]],
    [(sql) => sql.includes('SELECT quantity FROM cart_items'), () => [[]]],
    [(sql) => sql.startsWith('SELECT COUNT(*) AS count'), () => [[{ count: 0 }]]],
    [(sql) => sql.startsWith('INSERT INTO cart_items'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.startsWith('UPDATE carts'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.includes('FROM cart_items ci'), () => [[]]],
  ]);
  await service.addItem(42, { equipment_id: 11, quantity: 2 });
  const insert = events.find(({ type, sql }) => type === 'execute' && sql.startsWith('INSERT INTO cart_items'));
  assert.deepEqual(insert.parameters, [9, 11, 2]);
});

test('addItem rejects hidden equipment, sold-out stock and quantity-cap overflow', async () => {
  const unavailable = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT id, stock FROM equipments'), () => [[]]],
  ]);
  await assert.rejects(unavailable.service.addItem(42, { equipment_id: 999, quantity: 1 }), (error) => error.status === 404 && error.code === 10004);

  const soldOut = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT id, stock FROM equipments'), () => [[{ id: 11, stock: 0 }]]],
    [(sql) => sql.includes('SELECT quantity FROM cart_items'), () => [[]]],
  ]);
  await assert.rejects(soldOut.service.addItem(42, { equipment_id: 11, quantity: 1 }), (error) => error.status === 409 && error.code === 10005 && error.data.stock === 0);

  const overCap = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT id, stock FROM equipments'), () => [[{ id: 11, stock: CART_ITEM_QUANTITY_MAX + 10 }]]],
    [(sql) => sql.includes('SELECT quantity FROM cart_items'), () => [[{ quantity: CART_ITEM_QUANTITY_MAX }]]],
  ]);
  await assert.rejects(overCap.service.addItem(42, { equipment_id: 11, quantity: 1 }), isValidation('quantity'));
});

test('updateItem sets an absolute quantity and enforces ownership, stock and on-sale status', async () => {
  const owned = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT equipment_id FROM cart_items'), () => [[{ equipment_id: 11 }]]],
    [(sql) => sql.includes('SELECT id, stock FROM equipments'), () => [[{ id: 11, stock: 8 }]]],
    [(sql) => sql.startsWith('UPDATE cart_items'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.startsWith('UPDATE carts'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.includes('FROM cart_items ci'), () => [[]]],
  ]);
  await owned.service.updateItem(42, '7', { quantity: 4 });
  const update = owned.events.find(({ type, sql }) => type === 'execute' && sql.startsWith('UPDATE cart_items'));
  assert.deepEqual(update.parameters, [4, 7]);

  const missing = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT equipment_id FROM cart_items'), () => [[]]],
  ]);
  await assert.rejects(missing.service.updateItem(42, '7', { quantity: 1 }), (error) => error.status === 404 && error.code === 10004);

  const insufficient = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.includes('SELECT equipment_id FROM cart_items'), () => [[{ equipment_id: 11 }]]],
    [(sql) => sql.includes('SELECT id, stock FROM equipments'), () => [[{ id: 11, stock: 2 }]]],
  ]);
  await assert.rejects(insufficient.service.updateItem(42, '7', { quantity: 3 }), (error) => error.status === 409 && error.code === 10005 && error.data.stock === 2);
});

test('deleteItem and clearCart only affect the current cart and return the refreshed cart', async () => {
  const deleted = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.startsWith('DELETE FROM cart_items'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.startsWith('UPDATE carts'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.includes('FROM cart_items ci'), () => [[]]],
  ]);
  assert.deepEqual(await deleted.service.deleteItem(42, '7'), { items: [], total_price: 0, available_total_price: 0, invalid_count: 0, checkout_allowed: false });

  const missing = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.startsWith('DELETE FROM cart_items'), () => [{ affectedRows: 0 }]],
  ]);
  await assert.rejects(missing.service.deleteItem(42, '7'), (error) => error.status === 404 && error.code === 10004);

  const cleared = cartHarness([
    [(sql) => sql.includes('SELECT id FROM carts'), () => [[{ id: 9 }]]],
    [(sql) => sql.startsWith('DELETE FROM cart_items'), () => [{ affectedRows: 2 }]],
    [(sql) => sql.startsWith('UPDATE carts'), () => [{ affectedRows: 1 }]],
    [(sql) => sql.includes('FROM cart_items ci'), () => [[]]],
  ]);
  assert.deepEqual(await cleared.service.clearCart(42), { items: [], total_price: 0, available_total_price: 0, invalid_count: 0, checkout_allowed: false });
});

async function withCartApi(cartService, run) {
  const authService = {
    async authenticate(authorization) {
      if (authorization === 'Bearer user-token') {
        return { id: 42, username: 'cart_player', email: 'cart@example.test', avatar: null, role: 'user', status: 'active', created_at: new Date(), updated_at: new Date() };
      }
      if (authorization === 'Bearer admin-token') {
        return { id: 1, username: 'admin', email: 'admin@example.test', avatar: null, role: 'admin', status: 'active', created_at: new Date(), updated_at: new Date() };
      }
      throw new AppError(401, 10002, '登录状态无效或已过期，请重新登录');
    },
  };
  const server = createApp({ authService, cartService, logger: () => {} }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('cart endpoints require an active normal user and route to the current user cart', async () => {
  const calls = [];
  const cartService = {
    getCart: async (userId) => { calls.push(['get', userId]); return { items: [], total_price: 0 }; },
    addItem: async (userId, body) => { calls.push(['add', userId, body]); return { items: [], total_price: 0 }; },
    updateItem: async (userId, id, body) => { calls.push(['update', userId, id, body]); return { items: [], total_price: 0 }; },
    deleteItem: async (userId, id) => { calls.push(['delete', userId, id]); return { items: [], total_price: 0 }; },
    clearCart: async (userId) => { calls.push(['clear', userId]); return { items: [], total_price: 0 }; },
  };

  await withCartApi(cartService, async (base) => {
    const unauthorized = await fetch(`${base}/api/cart`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).code, 10002);

    const admin = await fetch(`${base}/api/cart`, { headers: { Authorization: 'Bearer admin-token' } });
    assert.equal(admin.status, 403);
    assert.equal((await admin.json()).code, 10003);

    const headers = { Authorization: 'Bearer user-token' };
    const get = await fetch(`${base}/api/cart`, { headers });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await get.json(), { code: 0, message: 'success', data: { items: [], total_price: 0 } });

    const add = await fetch(`${base}/api/cart/items`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ equipment_id: 11, quantity: 2 }),
    });
    assert.equal(add.status, 201);

    const update = await fetch(`${base}/api/cart/items/7`, {
      method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ quantity: 3 }),
    });
    assert.equal(update.status, 200);
    assert.equal((await fetch(`${base}/api/cart/items/7`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(`${base}/api/cart`, { method: 'DELETE', headers })).status, 200);

    assert.deepEqual(calls.map(([name]) => name), ['get', 'add', 'update', 'delete', 'clear']);
    assert.deepEqual(calls[0], ['get', 42]);
    assert.deepEqual(calls[1], ['add', 42, { equipment_id: 11, quantity: 2 }]);
    assert.deepEqual(calls[2], ['update', 42, '7', { quantity: 3 }]);
    assert.deepEqual(calls[3], ['delete', 42, '7']);
    assert.deepEqual(calls[4], ['clear', 42]);
  });
});
