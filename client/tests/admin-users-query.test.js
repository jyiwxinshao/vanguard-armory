import test from 'node:test';
import assert from 'node:assert/strict';
import { adminUserParams, adminUserRoute, parseAdminUserQuery } from '../src/utils/admin/users-query.js';

test('admin user URL pagination normalizes unsupported values', () => {
  for (const page_size of [10, 20, 50, '10', '20', '50']) assert.equal(parseAdminUserQuery({ page_size }).page_size, Number(page_size));
  for (const page_size of [8, 12, 16, 0, 'all', null]) assert.equal(parseAdminUserQuery({ page_size }).page_size, 10);
  for (const page of ['0', '-1', '1.2', '1e5', '9007199254740991']) assert.equal(parseAdminUserQuery({ page }).page, 1);
  assert.equal(parseAdminUserQuery({ keyword: '🗡'.repeat(51) }).keyword, '🗡'.repeat(50));
  assert.equal(parseAdminUserQuery({ status: 'deleted' }).status, '');
});

test('admin user filters survive URL round trips', () => {
  const form = { keyword: ' 刃 ', status: 'frozen', page: 2, page_size: 20 };
  assert.deepEqual(adminUserRoute(form), { keyword: '刃', status: 'frozen', page: '2', page_size: '20' });
  assert.deepEqual(adminUserParams(adminUserRoute(form)), { page: 2, page_size: 20, keyword: '刃', status: 'frozen' });
  assert.deepEqual(adminUserRoute(parseAdminUserQuery()), {});
});
