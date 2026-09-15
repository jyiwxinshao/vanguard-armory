import test from 'node:test';
import assert from 'node:assert/strict';
import { createEquipmentService, parseEquipmentId, parseEquipmentQuery, parsePagination } from '../src/modules/equipments/equipment.service.js';

const isValidation = (field) => (error) => error.status === 422 && error.code === 10001 && error.data.errors[0].field === field;

test('equipment queries normalize optional filters without changing pagination defaults', () => {
  assert.deepEqual(parsePagination({}), { page: 1, pageSize: 12 });
  assert.deepEqual(parseEquipmentQuery({ keyword: ' ', rarities: '', category: ' ', sort: '', in_stock: '' }), {
    page: 1, pageSize: 12, keyword: '', rarities: [], category: '', sort: 'newest', inStock: false,
  });
  assert.deepEqual(parseEquipmentQuery({ page: '2', page_size: '8', keyword: '  晨星  ', rarities: 'SSR, SR,SSR', category: 'weapon', sort: 'price_asc', in_stock: '1' }), {
    page: 2, pageSize: 8, keyword: '晨星', rarities: ['SSR', 'SR'], category: 'weapon', sort: 'price_asc', inStock: true,
  });
  assert.equal(parseEquipmentQuery({ keyword: '🗡'.repeat(50) }).keyword, '🗡'.repeat(50));
  assert.throws(() => parseEquipmentQuery({ keyword: '🗡'.repeat(51) }), isValidation('keyword'));
});

test('duplicate query values, unsupported enums and unsafe pagination are rejected', () => {
  for (const field of ['page', 'page_size', 'keyword', 'rarities', 'category', 'sort', 'in_stock']) {
    assert.throws(() => parseEquipmentQuery({ [field]: ['1', '1'] }), isValidation(field));
  }
  for (const [field, values] of [
    ['page', ['', '0', '-1', '1.5', '01', '1e2', '9007199254740991', 1]],
    ['page_size', ['', '0', '10', '12x', '16.0']],
    ['rarities', ['ssr', 'SSR,,SR', 'SSR,UNKNOWN', ',']],
    ['category', ['all', 'weapon,armor', 'UNKNOWN']],
    ['sort', ['stock_desc', 'price; DROP TABLE equipments', 'toString', '__proto__']],
  ]) {
    for (const value of values) assert.throws(() => parseEquipmentQuery({ [field]: value }), isValidation(field));
  }
  assert.throws(() => parseEquipmentQuery({ status: 'off_sale' }), isValidation('status'));
  assert.throws(() => parseEquipmentQuery(null), isValidation('query'));
});

test('in-stock filtering accepts only absent, empty, zero or one string values', () => {
  for (const input of [{}, { in_stock: '' }, { in_stock: '0' }]) assert.equal(parseEquipmentQuery(input).inStock, false);
  assert.equal(parseEquipmentQuery({ in_stock: '1' }).inStock, true);
  for (const value of [true, false, 1, null, 'true', 'false', '2', '-1', '01', ' 1 ', ' ', ['1'], {}]) {
    assert.throws(() => parseEquipmentQuery({ in_stock: value }), isValidation('in_stock'));
  }
});

test('equipment identifiers are canonical positive unsigned INT values', () => {
  assert.equal(parseEquipmentId('1'), 1);
  assert.equal(parseEquipmentId('4294967295'), 4294967295);
  for (const value of ['', '0', '01', '-1', '+1', '1.0', '1x', '1e2', ' 1', '4294967296', '9007199254740991', '１', ['1'], 1, null]) {
    assert.throws(() => parseEquipmentId(value), isValidation('id'));
  }
});

function serviceWithExecutor(execute) {
  const events = [];
  const connection = {
    query: async (sql) => { events.push({ type: 'query', sql }); },
    execute: async (sql, parameters) => {
      events.push({ type: 'execute', sql, parameters: [...parameters] });
      return execute(sql, parameters);
    },
    commit: async () => { events.push({ type: 'commit' }); },
    rollback: async () => { events.push({ type: 'rollback' }); },
  };
  const service = createEquipmentService({ runWithConnection: async (callback) => {
    try { return await callback(connection); }
    finally { events.push({ type: 'release' }); }
  } });
  return { service, events };
}

test('count and page share one read-only snapshot and the same parameterized filters', async () => {
  const item = { id: 11, name: '剑%_\\!\'核心', price: 12900, stock: 2 };
  const { service, events } = serviceWithExecutor((sql) => sql.startsWith('SELECT COUNT') ? [[{ total: 1 }]] : [[item]]);
  const result = await service.listEquipments(parseEquipmentQuery({ keyword: '剑%_\\!\'', rarities: 'SSR,SR', category: 'weapon', in_stock: '1', sort: 'price_asc', page: '2', page_size: '8' }));
  assert.deepEqual(result, { items: [item], page: 2, page_size: 8, total: 1 });
  assert.deepEqual(events.map(({ type }) => type), ['query', 'query', 'execute', 'execute', 'commit', 'release']);
  assert.equal(events[0].sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(events[1].sql, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const [count, page] = events.filter(({ type }) => type === 'execute');
  const countWhere = count.sql.split(' WHERE ')[1];
  const pageWhere = page.sql.split(' WHERE ')[1].split('\n')[0];
  assert.equal(countWhere, pageWhere);
  assert.match(countWhere, /status = 'on_sale' AND stock > 0/);
  assert.match(countWhere, /name LIKE \? ESCAPE '!'/);
  assert.deepEqual(count.parameters, ['%剑!%!_\\!!\'%', 'SSR', 'SR', 'weapon']);
  assert.deepEqual(page.parameters, count.parameters);
  assert.equal(page.sql.includes(item.name), false);
  assert.match(page.sql, /ORDER BY price ASC, id DESC LIMIT 8 OFFSET 8$/);
});

test('unfiltered lists retain sold-out inventory, empty pages and stable sort tie breaks', async () => {
  for (const [sort, clause] of [['newest', 'created_at DESC'], ['price_asc', 'price ASC'], ['price_desc', 'price DESC'], ['rarity_desc', "CASE rarity WHEN 'SSR' THEN 4"]]) {
    const { service, events } = serviceWithExecutor((sql) => sql.startsWith('SELECT COUNT') ? [[{ total: 15 }]] : [[]]);
    const result = await service.listEquipments({ page: 99, pageSize: 8, sort, inStock: false });
    assert.deepEqual(result, { items: [], page: 99, page_size: 8, total: 15 });
    const reads = events.filter(({ type }) => type === 'execute');
    assert.ok(reads.every(({ sql }) => !sql.includes('stock > 0')));
    assert.ok(reads[1].sql.includes(`ORDER BY ${clause}`));
    assert.match(reads[1].sql, /id DESC LIMIT 8 OFFSET 784$/);
  }
});

test('failed page reads roll back the snapshot and release the connection', async () => {
  const failure = new Error('simulated page query failure');
  const { service, events } = serviceWithExecutor((sql) => {
    if (sql.startsWith('SELECT COUNT')) return [[{ total: 15 }]];
    throw failure;
  });
  await assert.rejects(service.listEquipments(), (error) => error === failure);
  assert.deepEqual(events.map(({ type }) => type), ['query', 'query', 'execute', 'execute', 'rollback', 'release']);
});

test('detail reads allow zero stock but enforce public status and a parameterized identifier', async () => {
  const soldOut = { id: 7, name: '已售罄装备', price: 100, stock: 0 };
  const { service, events } = serviceWithExecutor((sql, parameters) => {
    assert.match(sql, /WHERE id = \? AND status = 'on_sale'$/);
    return parameters[0] === 7 ? [[soldOut]] : [[]];
  });
  assert.deepEqual(await service.getEquipmentById(7), soldOut);
  await assert.rejects(service.getEquipmentById(8), (error) => error.status === 404 && error.code === 10004);
  assert.equal(events.some(({ type }) => ['commit', 'query', 'rollback'].includes(type)), false);
  const count = events.length;
  await assert.rejects(service.getEquipmentById(['7']), isValidation('id'));
  await assert.rejects(service.listEquipments({ inStock: 'false' }), isValidation('in_stock'));
  assert.equal(events.length, count);
});
