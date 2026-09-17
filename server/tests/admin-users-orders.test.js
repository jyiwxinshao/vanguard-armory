import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminUserId, parseAdminUserQuery, parseAdminUserStatus } from '../src/modules/admin/users/user.validation.js';
import { parseAdminOrderId, parseAdminOrderQuery, parseAdminOrderStatus } from '../src/modules/admin/orders/order.validation.js';
import { createAdminUserService } from '../src/modules/admin/users/user.service.js';
import { createAdminOrderService } from '../src/modules/admin/orders/order.service.js';

test('admin user query validates keyword, status and dedicated pagination', () => {
  assert.deepEqual(parseAdminUserQuery(), { keyword: '', status: '', page: 1, pageSize: 10 });
  const parsed = parseAdminUserQuery({ keyword: ' 刃 ', status: 'frozen', page: '2', page_size: '50' });
  assert.equal(parsed.keyword, '刃');
  assert.equal(parsed.status, 'frozen');
  assert.equal(parsed.page, 2);
  assert.equal(parsed.pageSize, 50);
  for (const query of [
    null, [], { page_size: '8' }, { page_size: '12' }, { page: '0' }, { page: '9007199254740991' },
    { status: 'deleted' }, { status: ['active', 'frozen'] }, { keyword: 'x'.repeat(51) }, { unknown: '1' },
  ]) assert.throws(() => parseAdminUserQuery(query), { status: 422 });
});

test('admin user id and status reject invalid values and unknown fields', () => {
  assert.equal(parseAdminUserId('1'), 1);
  assert.equal(parseAdminUserId('4294967295'), 4294967295);
  for (const value of ['0', '-1', '1.5', 'abc', '4294967296', '01']) assert.throws(() => parseAdminUserId(value), { status: 422 });
  assert.deepEqual(parseAdminUserStatus({ status: 'active' }), { status: 'active' });
  assert.deepEqual(parseAdminUserStatus({ status: 'frozen' }), { status: 'frozen' });
  for (const body of [null, [], {}, { status: 'deleted' }, { status: 'active', role: 'admin' }, { status: 'admin' }]) assert.throws(() => parseAdminUserStatus(body), { status: 422 });
});

test('admin order query validates user, status, dates and pagination', () => {
  assert.deepEqual(parseAdminOrderQuery(), { userId: null, status: '', from: null, to: null, page: 1, pageSize: 10 });
  const parsed = parseAdminOrderQuery({
    user_id: '3', status: 'paid', created_from: '2026-01-01T00:00:00.000Z', created_to: '2026-01-02T00:00:00.000Z', page: '2', page_size: '20',
  });
  assert.equal(parsed.userId, 3);
  assert.equal(parsed.status, 'paid');
  assert.equal(parsed.from.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(parsed.to.toISOString(), '2026-01-02T00:00:00.000Z');
  assert.equal(parsed.page, 2);
  assert.equal(parsed.pageSize, 20);
  for (const query of [
    null, [], { page_size: '8' }, { page: '0' }, { user_id: '0' }, { user_id: 'abc' }, { user_id: ['1', '2'] },
    { status: 'unknown' }, { created_from: '2026-01-01' }, { created_to: 'not-a-date' },
    { created_from: '2026-02-01T00:00:00.000Z', created_to: '2026-01-01T00:00:00.000Z' }, { extra: '1' },
  ]) assert.throws(() => parseAdminOrderQuery(query), { status: 422 });
});

test('admin order id and status only allow cancelled or completed', () => {
  assert.equal(parseAdminOrderId('7'), 7);
  for (const value of ['0', '-1', '4294967296', 'abc', '1.5']) assert.throws(() => parseAdminOrderId(value), { status: 422 });
  assert.equal(parseAdminOrderStatus({ status: 'cancelled' }), 'cancelled');
  assert.equal(parseAdminOrderStatus({ status: 'completed' }), 'completed');
  for (const body of [null, [], {}, { status: 'pending' }, { status: 'paid' }, { status: 'cancelled', actor: 1 }]) assert.throws(() => parseAdminOrderStatus(body), { status: 422 });
});

test('admin user service exposes safe columns and never selects password hashes', async () => {
  const sqls = [];
  const service = createAdminUserService({ runWithConnection: async (run) => run({
    execute: async (sql, values) => {
      sqls.push(sql);
      if (sql.includes('COUNT(*)')) return [[{ total: 1 }]];
      if (sql.includes('FROM users')) return [[{ id: 9, username: 'u9', email: 'u9@test.test', role: 'user', status: 'active' }]];
      return [[]];
    },
    query: async () => {},
    commit: async () => {},
    rollback: async () => {},
  }) });
  const result = await service.list({ keyword: 'u9', status: 'active' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].username, 'u9');
  assert.ok(sqls.some((sql) => sql.includes('username, email, avatar, role, status')));
  assert.ok(sqls.every((sql) => !sql.includes('password_hash')));
});

test('admin user status only manages normal users and is idempotent', async () => {
  const user = { id: 5, role: 'user', status: 'active', username: 'u5' };
  const calls = [];
  const service = createAdminUserService({ runWithConnection: async (run) => run({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    execute: async (sql) => {
      calls.push(sql);
      if (sql.includes('FOR UPDATE')) return [[{ id: 5, role: 'user', status: user.status }]];
      if (sql.includes('UPDATE users')) { user.status = 'frozen'; return [{ affectedRows: 1 }]; }
      return [[user]];
    },
  }) });
  const first = await service.changeStatus(1, '5', { status: 'frozen' });
  assert.equal(first.status, 'frozen');
  const second = await service.changeStatus(1, '5', { status: 'frozen' });
  assert.equal(second.status, 'frozen');
  assert.equal(calls.filter((sql) => sql.includes('UPDATE users')).length, 1);

  const adminService = createAdminUserService({ runWithConnection: async (run) => run({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
    execute: async (sql) => [[{ id: 6, role: 'admin', status: 'active' }]],
  }) });
  await assert.rejects(adminService.changeStatus(1, '6', { status: 'frozen' }), { status: 403 });
});

test('admin order service cancels pending orders once and returns stock exactly once', async () => {
  const orderState = { status: 'pending', cancelled_at: null };
  const stock = { 1: 10 };
  const items = [{ id: 1, equipment_id: 1, equipment_name: '剑', equipment_image: '/a.svg', rarity: 'R', price: 100, quantity: 2 }];
  const service = createAdminOrderService({
    runWithConnection: async (run) => run({ query: async () => {}, commit: async () => {}, rollback: async () => {}, execute: async () => [] }),
    runWithTransaction: async (run) => {
      const connection = {
        execute: async (sql, values) => {
          if (sql.includes('FOR UPDATE')) return [[{ id: 7, status: orderState.status }]];
          if (sql.includes('SELECT equipment_id, quantity FROM order_items')) return [[{ equipment_id: 1, quantity: 2 }]];
          if (sql.includes('SELECT stock FROM equipments')) return [[{ stock: stock[values[0]] }]];
          if (sql.startsWith('UPDATE equipments')) { stock[values[1]] += values[0]; return [{ affectedRows: 1 }]; }
          if (sql.startsWith('UPDATE orders')) { orderState.status = values[0]; return [{ affectedRows: 1 }]; }
          if (sql.includes('FROM order_items')) return [items];
          if (sql.includes('FROM orders WHERE id = ?')) return [[{ id: 7, order_no: 'NO7', user_id: 1, total: 200, actual_total: 200, status: orderState.status, cancelled_at: orderState.cancelled_at }]];
          return [[]];
        },
      };
      return run(connection);
    },
  });
  const cancelled = await service.changeStatus(1, '7', { status: 'cancelled' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(stock[1], 12);
  const repeated = await service.changeStatus(1, '7', { status: 'cancelled' });
  assert.equal(repeated.status, 'cancelled');
  assert.equal(stock[1], 12);
});

test('admin order service completes only paid orders and rejects invalid transitions', async () => {
  const orderState = { status: 'paid', completed_at: null };
  const service = createAdminOrderService({
    runWithConnection: async (run) => run({ query: async () => {}, commit: async () => {}, rollback: async () => {}, execute: async () => [] }),
    runWithTransaction: async (run) => run({
      execute: async (sql, values) => {
        if (sql.includes('FOR UPDATE')) return [[{ id: 8, status: orderState.status }]];
        if (sql.startsWith('UPDATE orders')) { orderState.status = values[0]; return [{ affectedRows: 1 }]; }
        if (sql.includes('FROM order_items')) return [[]];
        if (sql.includes('FROM orders WHERE id = ?')) return [[{ id: 8, order_no: 'NO8', user_id: 1, total: 100, actual_total: 100, status: orderState.status }]];
        return [[]];
      },
    }),
  });
  const completed = await service.changeStatus(1, '8', { status: 'completed' });
  assert.equal(completed.status, 'completed');
  assert.equal(orderState.status, 'completed');
  // paid cannot be cancelled, and a completed order cannot transition again.
  const paidService = createAdminOrderService({
    runWithConnection: async (run) => run({ query: async () => {}, commit: async () => {}, rollback: async () => {}, execute: async () => [] }),
    runWithTransaction: async (run) => run({ execute: async (sql) => [[{ id: 9, status: 'paid' }]] }),
  });
  await assert.rejects(paidService.changeStatus(1, '9', { status: 'cancelled' }), { status: 409, code: 10008 });
});
