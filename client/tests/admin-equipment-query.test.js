import test from 'node:test';
import assert from 'node:assert/strict';
import { adminEquipmentParams, adminEquipmentRoute, parseAdminEquipmentQuery } from '../src/utils/admin/equipment-query.js';

test('admin URL pagination normalizes unsupported values and remains separate from the storefront', () => {
  for (const page_size of [10, 20, 50, '10', '20', '50']) assert.equal(parseAdminEquipmentQuery({ page_size }).page_size, Number(page_size));
  for (const page_size of [8, 12, 16, 0, 'all', null]) assert.equal(parseAdminEquipmentQuery({ page_size }).page_size, 10);
  for (const page of ['0', '-1', '1.2', '1e5', '9007199254740991']) assert.equal(parseAdminEquipmentQuery({ page, page_size: '50' }).page, 1);
  assert.equal(parseAdminEquipmentQuery({ page: ['3', '9'], page_size: ['20', '50'] }).page, 3);
  assert.equal(parseAdminEquipmentQuery({ status: 'unexpected' }).status, '');
});

test('admin filters survive URL round trips, including deleted status and compound rarity/stock/series', () => {
  const form = { keyword: ' 刃%_ ', category: 'weapon', rarities: ['SR', 'SSR'], series: ' eclipse_relics ', status: 'deleted', in_stock: true, page: 2, page_size: 20, sort: 'price_asc' };
  const route = adminEquipmentRoute(form);
  assert.deepEqual(route, { page: '2', page_size: '20', sort: 'price_asc', keyword: '刃%_', category: 'weapon', series: 'eclipse_relics', status: 'deleted', rarities: 'SSR,SR', in_stock: '1' });
  assert.deepEqual(adminEquipmentParams(route), adminEquipmentParams(form));
  assert.equal(parseAdminEquipmentQuery({ series: '🗡'.repeat(65) }).series, '🗡'.repeat(64));
  assert.deepEqual(adminEquipmentRoute({ unknown: 'ignored' }), {});
});

test('pagination uses submitted filters and reset removes every constraint', () => {
  const submitted = parseAdminEquipmentQuery({ keyword: '剑', status: 'off_sale', page: '3' });
  const draft = { ...submitted, keyword: '尚未查询', status: 'deleted' };
  const nextPage = adminEquipmentRoute({ ...submitted, page: 4 });
  assert.equal(nextPage.keyword, '剑');
  assert.equal(nextPage.status, 'off_sale');
  assert.equal(adminEquipmentRoute({ ...draft, page: 1 }).page, undefined);
  assert.deepEqual(adminEquipmentRoute(parseAdminEquipmentQuery()), {});
});

test('low-stock overview link survives navigation, filtering, pagination and reset', () => {
  const filters = parseAdminEquipmentQuery({ status: 'on_sale', low_stock: '1' });
  assert.equal(filters.low_stock, true);
  assert.deepEqual(adminEquipmentRoute(filters), { status: 'on_sale', low_stock: '1' });
  assert.equal(adminEquipmentParams({ ...filters, page: 2 }).low_stock, '1');
  assert.equal(adminEquipmentParams({ ...filters, in_stock: true }).in_stock, '1');
  assert.equal(parseAdminEquipmentQuery().low_stock, false);
  assert.equal(adminEquipmentRoute({ low_stock: 'false' }).low_stock, undefined);
});
