import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAdminOrderReturn, safeAdminUserReturn } from '../src/utils/admin/navigation.js';

test('admin user return preserves committed filters and rejects unrelated paths', () => {
  const result = new URL(safeAdminUserReturn('/admin/users?keyword=%E5%88%83&status=frozen&page=2&page_size=20&returnTo=/outside'), 'https://game-store.invalid');
  assert.equal(result.pathname, '/admin/users');
  assert.equal(result.searchParams.get('keyword'), '刃');
  assert.equal(result.searchParams.get('status'), 'frozen');
  assert.equal(result.searchParams.get('page'), '2');
  assert.equal(result.searchParams.get('page_size'), '20');
  assert.equal(result.searchParams.has('returnTo'), false);
  for (const value of [undefined, '/admin/orders', '//outside.test', '/admin/users/1', '/admin/users?keyword=%00', '/admin/users?keyword=%']) {
    assert.equal(safeAdminUserReturn(value), '/admin/users');
  }
});

test('admin order return preserves committed filters and rejects unrelated paths', () => {
  const result = new URL(safeAdminOrderReturn('/admin/orders?status=paid&user_id=7&from=2026-09-01&to=2026-09-02&page=3&page_size=50'), 'https://game-store.invalid');
  assert.equal(result.pathname, '/admin/orders');
  assert.equal(result.searchParams.get('status'), 'paid');
  assert.equal(result.searchParams.get('user_id'), '7');
  assert.equal(result.searchParams.get('from'), '2026-09-01');
  assert.equal(result.searchParams.get('to'), '2026-09-02');
  assert.equal(result.searchParams.get('page'), '3');
  assert.equal(result.searchParams.get('page_size'), '50');
  for (const value of [undefined, '/admin/users', '/admin/orders/7', '/admin/orders?from=bad']) {
    assert.equal(safeAdminOrderReturn(value), '/admin/orders');
  }
});
