import test from 'node:test';
import assert from 'node:assert/strict';
import { adminOrderParams, adminOrderRoute, parseAdminOrderQuery } from '../src/utils/admin/orders-query.js';

test('admin order URL pagination and statuses are validated', () => {
  for (const page_size of [10, 20, 50, '10', '20', '50']) assert.equal(parseAdminOrderQuery({ page_size }).page_size, Number(page_size));
  for (const page_size of [8, 12, 0, 'all']) assert.equal(parseAdminOrderQuery({ page_size }).page_size, 10);
  for (const status of ['pending', 'paid', 'cancelled', 'completed']) assert.equal(parseAdminOrderQuery({ status }).status, status);
  assert.equal(parseAdminOrderQuery({ status: 'unknown' }).status, '');
  assert.equal(parseAdminOrderQuery({ user_id: 'abc' }).user_id, '');
  assert.equal(parseAdminOrderQuery({ user_id: '0' }).user_id, '');
  assert.equal(parseAdminOrderQuery({ from: '2026-9-1' }).from, '');
});

test('admin order filters survive URL round trips including user and dates', () => {
  const form = { status: 'paid', from: '2026-09-01', to: '2026-09-02', user_id: '7', page: 2, page_size: 20 };
  assert.deepEqual(adminOrderRoute(form), { status: 'paid', from: '2026-09-01', to: '2026-09-02', user_id: '7', page: '2', page_size: '20' });
  const params = adminOrderParams(form);
  assert.equal(params.status, 'paid');
  assert.equal(params.user_id, '7');
  assert.match(params.created_from, /Z$/);
  assert.match(params.created_to, /Z$/);
  assert.equal(params.page, 2);
  assert.equal(params.page_size, 20);
  assert.deepEqual(adminOrderRoute(parseAdminOrderQuery()), {});
});

test('admin order date range rejects an inverted range', () => {
  assert.throws(() => adminOrderParams({ from: '2026-09-10', to: '2026-09-01' }), /结束日期不能早于开始日期/);
});
