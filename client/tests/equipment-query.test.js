import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUIPMENT_CATEGORIES, EQUIPMENT_RARITIES, EQUIPMENT_SORTS,
  equipmentQueryToParams, equipmentQueryToRoute, keywordIssue, lastEquipmentPage, parseEquipmentQuery, safeCatalogReturn, updateEquipmentQuery,
} from '../src/utils/equipment-query.js';

const defaults = { keyword: '', rarities: [], category: '', sort: 'newest', in_stock: false, series: '', page: 1, page_size: 12 };

test('empty or malformed query values use catalog defaults', () => {
  assert.deepEqual(EQUIPMENT_RARITIES, ['SSR', 'SR', 'R', 'N']);
  assert.deepEqual(EQUIPMENT_CATEGORIES, ['weapon', 'armor', 'accessory', 'consumable']);
  assert.deepEqual(EQUIPMENT_SORTS, ['newest', 'price_asc', 'price_desc', 'rarity_desc']);
  for (const value of [undefined, null, '', 123, [], {}]) assert.deepEqual(parseEquipmentQuery(value), defaults);
  assert.deepEqual(parseEquipmentQuery({
    keyword: {}, rarities: [null, 3, {}, 'unknown'], category: 'unknown', sort: 'random', page: true, page_size: false,
  }), defaults);
  assert.deepEqual(parseEquipmentQuery({ keyword: [], rarities: [], category: [], sort: [], page: [], page_size: [] }), defaults);
});

test('rarities accept CSV or arrays, ignore invalid entries and have stable deduplicated order', () => {
  assert.deepEqual(parseEquipmentQuery({ rarities: 'N,SSR,R, SSR ,unknown,SR,ssr' }).rarities, EQUIPMENT_RARITIES);
  assert.deepEqual(parseEquipmentQuery({ rarities: ['N,R', 'SSR', 'R', '', null, ['SR'], 3] }).rarities, ['SSR', 'R', 'N']);
  assert.deepEqual(parseEquipmentQuery({ rarities: ['SR', 'SR'] }).rarities, ['SR']);
});

test('single-value fields consistently use the first route query entry', () => {
  assert.deepEqual(parseEquipmentQuery({
    keyword: [' 宝剑 ', 'ignored'], category: ['weapon', 'armor'], sort: ['price_desc', 'newest'],
    page: ['3', '8'], page_size: ['16', '8'],
  }), { keyword: '宝剑', rarities: [], category: 'weapon', sort: 'price_desc', in_stock: false, series: '', page: 3, page_size: 12 });
  assert.deepEqual(parseEquipmentQuery({ keyword: [null, 'ignored'], category: [null, 'armor'], page: [null, '2'] }), defaults);
});

test('keyword trimming and limits count Unicode characters without splitting an emoji', () => {
  const keyword = `  ${'剑😀'.repeat(25)}  `;
  assert.equal(parseEquipmentQuery({ keyword }).keyword, '剑😀'.repeat(25));
  assert.equal(keywordIssue(keyword), '');
  assert.equal(parseEquipmentQuery({ keyword: `${keyword.trim()}额外` }).keyword, keyword.trim());
  assert.equal(keywordIssue(`${keyword.trim()}额外`), '搜索关键词最多 50 个字符');
  assert.equal(parseEquipmentQuery({ keyword: '😀'.repeat(51) }).keyword, '😀'.repeat(50));
  for (const value of [undefined, null, {}, 50, '  ']) assert.equal(keywordIssue(value), '');
});

test('only supported categories and sorts are accepted', () => {
  for (const category of EQUIPMENT_CATEGORIES) assert.equal(parseEquipmentQuery({ category }).category, category);
  for (const sort of EQUIPMENT_SORTS) assert.equal(parseEquipmentQuery({ sort }).sort, sort);
  assert.equal(parseEquipmentQuery({ category: ' weapon ', sort: ' price_asc ' }).category, 'weapon');
  assert.equal(parseEquipmentQuery({ sort: ' price_asc ' }).sort, 'price_asc');
  assert.equal(parseEquipmentQuery({ category: 'WEAPON', sort: 'PRICE_ASC' }).category, '');
  assert.equal(parseEquipmentQuery({ sort: 'PRICE_ASC' }).sort, 'newest');
});

test('pagination accepts safe page numbers and normalizes every page size to the fixed 12', () => {
  for (const page of [1, 9, '1', '9', '0002']) {
    assert.equal(parseEquipmentQuery({ page }).page, Number(page));
  }
  for (const page of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, '', '0', '-2', '1.5', '1e2', '0x10', ' 2 ', 'Infinity', '9007199254740992']) {
    assert.equal(parseEquipmentQuery({ page }).page, 1);
  }
  for (const page_size of [8, 16, '8', '16', 0, 1, 10, 20, 100, 'all', '8.0', null]) assert.equal(parseEquipmentQuery({ page_size }).page_size, 12);
});

test('route output omits defaults and API output uses numeric pagination without empty filters', () => {
  assert.deepEqual(equipmentQueryToRoute(defaults), {});
  assert.deepEqual(equipmentQueryToParams(defaults), { sort: 'newest', page: 1, page_size: 12 });
  const filters = { keyword: ' 火焰 ', rarities: ['N', 'SSR'], category: 'weapon', sort: 'rarity_desc', page: 3, page_size: 8 };
  assert.deepEqual(equipmentQueryToRoute(filters), {
    keyword: '火焰', rarities: 'SSR,N', category: 'weapon', sort: 'rarity_desc', page: '3',
  });
  assert.deepEqual(equipmentQueryToParams(filters), {
    keyword: '火焰', rarities: 'SSR,N', category: 'weapon', sort: 'rarity_desc', page: 3, page_size: 12,
  });
});

test('normalized filters survive route and URL round trips', () => {
  const filters = { keyword: ' 剑 + 盾 & 😀 ', rarities: ['SR', 'SSR', 'SR'], category: 'armor', sort: 'price_asc', page: 2, page_size: 16 };
  const normalized = parseEquipmentQuery(filters);
  const route = equipmentQueryToRoute(filters);
  assert.deepEqual(parseEquipmentQuery(route), normalized);
  const path = `/?${new URLSearchParams(route).toString()}`;
  assert.equal(safeCatalogReturn(path), path);
  const restored = Object.fromEntries(new URL(safeCatalogReturn(path), 'https://game-store.invalid').searchParams);
  assert.deepEqual(parseEquipmentQuery(restored), normalized);
  assert.deepEqual(equipmentQueryToRoute(restored), route);
});

test('catalog return normalizes supported query values and strips unknown fields and fragments', () => {
  assert.equal(safeCatalogReturn('/'), '/');
  assert.equal(safeCatalogReturn('/#catalog'), '/');
  assert.equal(safeCatalogReturn('/?returnTo=https://outside.test&category=weapon#catalog'), '/?category=weapon');
  assert.equal(safeCatalogReturn('/?rarities=N&rarities=SSR,R,N&sort=price_desc&page=0002&page=8&page_size=8'),
    '/?rarities=SSR%2CR%2CN&sort=price_desc&page=2');
  assert.equal(safeCatalogReturn('/?keyword=%20%E5%89%91%20&category=unknown&page=-1&page_size=100&sort=random'), '/?keyword=%E5%89%91');
  assert.equal(safeCatalogReturn('/?page=1&page_size=12&sort=newest'), '/');
});

test('catalog return rejects external URLs, non-root paths and control characters', () => {
  for (const value of [
    undefined, null, 1, ['/?page=2'], '', 'https://outside.test/', 'https://game-store.invalid/', '//outside.test',
    '///outside.test', '/\\outside.test', '\\outside.test', '/equipments/1', '/account?keyword=sword',
    '/account/../?page=2', '/./?page=2', '/%2e/?page=2', '/%2foutside.test', '/%5coutside.test',
    '/?keyword=line\nfeed', '/?keyword=%0A', '/?keyword=%00',
    '/?keyword=%7F', '/?keyword=%C2%85', '/?keyword=%zz', '/?keyword=%', '/?keyword=%E0%A4', '/\t?page=2',
  ]) assert.equal(safeCatalogReturn(value), '/', `Expected a root fallback for ${JSON.stringify(value)}`);
});

test('stock filtering survives refresh, API parameters and a details round trip', () => {
  const query = parseEquipmentQuery({ in_stock: '1', category: 'accessory', page: '2' });
  assert.equal(query.in_stock, true);
  assert.equal(equipmentQueryToParams(query).in_stock, 1);
  assert.equal(equipmentQueryToRoute(query).in_stock, '1');
  assert.equal(safeCatalogReturn('/?in_stock=1&category=accessory&page=2'), '/?category=accessory&in_stock=1&page=2');
  for (const in_stock of [false, '0', '', undefined, 'bad']) {
    assert.equal(parseEquipmentQuery({ in_stock }).in_stock, false);
    assert.equal('in_stock' in equipmentQueryToParams({ in_stock }), false);
  }
  assert.equal(safeCatalogReturn('/?keyword=%5Csword'), '/?keyword=%5Csword');
});

test('series is a trimmed bounded deep-link filter and participates in route/API round trips', () => {
  assert.equal(parseEquipmentQuery({ series: ' eclipse_relics ' }).series, 'eclipse_relics');
  assert.equal(parseEquipmentQuery({}).series, '');
  assert.equal(parseEquipmentQuery({ series: 'x'.repeat(100) }).series, 'x'.repeat(64));
  const filters = { ...defaults, series: 'eclipse_relics', page: 2 };
  assert.deepEqual(equipmentQueryToRoute(filters), { series: 'eclipse_relics', page: '2' });
  assert.deepEqual(equipmentQueryToParams(filters), { sort: 'newest', page: 2, page_size: 12, series: 'eclipse_relics' });
  assert.equal(safeCatalogReturn('/?series=eclipse_relics&page=2'), '/?series=eclipse_relics&page=2');
  assert.equal(updateEquipmentQuery({ ...defaults, series: 'eclipse_relics', page: 3 }, { series: 'next_series' }).page, 1);
});

test('changing a filter resets pagination, including a pending search during a page click', () => {
  const current = { ...defaults, page: 3, category: 'weapon' };
  for (const changes of [{ keyword: '剑' }, { category: 'armor' }, { rarities: ['SSR'] }, { sort: 'price_asc' }, { in_stock: true }, { page: 4, keyword: '剑' }]) {
    assert.equal(updateEquipmentQuery(current, changes).page, 1);
  }
  assert.equal(updateEquipmentQuery(current, { page: 4 }).page, 4);
  assert.equal(updateEquipmentQuery(current, { category: 'weapon' }).page, 3);
  assert.equal(updateEquipmentQuery({ ...current, keyword: '剑' }, { keyword: ' 剑 ' }).page, 3);
});

test('an emptied last page recovers to the latest valid page', () => {
  assert.equal(lastEquipmentPage(0, 12), 1);
  assert.equal(lastEquipmentPage(8, 8), 1);
  assert.equal(lastEquipmentPage(9, 8), 2);
  assert.equal(lastEquipmentPage(15, 12), 2);
});
