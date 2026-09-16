import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAdminEquipmentReturn, adminEquipmentIssue, formatEquipmentDate } from '../src/utils/admin/equipment-detail.js';

test('detail return preserves committed admin filters and pagination, dropping unsupported parameters', () => {
  const result = new URL(safeAdminEquipmentReturn('/admin/equipments?page=3&page_size=20&status=deleted&series=eclipse_relics&category=weapon&rarities=SSR,SR&in_stock=1&keyword=刃&sort=price_asc&returnTo=https://outside.test#x'), 'https://game-store.invalid');
  assert.equal(result.pathname, '/admin/equipments');
  assert.equal(result.searchParams.get('page'), '3');
  assert.equal(result.searchParams.get('page_size'), '20');
  assert.equal(result.searchParams.get('status'), 'deleted');
  assert.equal(result.searchParams.get('series'), 'eclipse_relics');
  assert.equal(result.searchParams.get('category'), 'weapon');
  assert.equal(result.searchParams.get('rarities'), 'SSR,SR');
  assert.equal(result.searchParams.get('in_stock'), '1');
  assert.equal(result.searchParams.get('keyword'), '刃');
  assert.equal(result.searchParams.get('sort'), 'price_asc');
  assert.equal(result.searchParams.has('returnTo'), false);
  assert.equal(result.hash, '');
});

test('detail return rejects external, unrelated and malformed destinations', () => {
  for (const value of [undefined, ['/admin/equipments?page=2'], '//outside.test', 'https://outside.test', '/admin/users', '/admin/equipments/1', '/admin/users/../equipments', '/admin/equipments?keyword=%00', '/admin/equipments?keyword=%', '/admin/equipments?keyword=%5C']) {
    assert.equal(safeAdminEquipmentReturn(value), '/admin/equipments');
  }
  assert.equal(safeAdminEquipmentReturn('/admin/equipments?page=0&status=invalid'), '/admin/equipments');
});

test('detail distinguishes invalid IDs and missing records from retryable failures', () => {
  const issue = (status) => adminEquipmentIssue({ response: { status, data: {} } });
  assert.match(issue(404).message, /不存在/);
  assert.match(issue(422).message, /地址无效/);
  for (const status of [404, 422, 401, 403]) assert.equal(issue(status).retry, false);
  assert.equal(issue(500).retry, true);
  assert.equal(adminEquipmentIssue(new Error('offline')).retry, true);
  assert.equal(formatEquipmentDate(null), '—');
  assert.equal(formatEquipmentDate('invalid'), '—');
  assert.notEqual(formatEquipmentDate('2026-09-16T00:00:00.000Z'), '—');
});
