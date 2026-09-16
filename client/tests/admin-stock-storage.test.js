import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockStorage, parseStockDelta } from '../src/utils/admin/stock-storage.js';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
function fixture() {
  const values = new Map(); let tail = Promise.resolve(); let index = 0;
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const lock = (run) => { const next = tail.then(run); tail = next.catch(() => {}); return next; };
  const make = () => createStockStorage({ storage, lock, uuid: () => ids[index++ % ids.length] });
  return { values, storage, make };
}
test('stock deltas reject zero, rounding and overflow', () => {
  assert.equal(parseStockDelta('+10'), 10); assert.equal(parseStockDelta('-2'), -2);
  for (const value of [0, '', '-0', '1.5', '1e2', '4294967296', 'NaN']) assert.throws(() => parseStockDelta(value));
});
test('pending stock operation survives refresh, concurrent tabs and account/equipment changes', async () => {
  const { make } = fixture(); const first = make(), second = make();
  const operations = await Promise.all([first.prepare(1, 7, 5, () => true), second.prepare(1, 7, -3, () => true)]);
  assert.deepEqual(operations[0], operations[1]);
  assert.deepEqual(make().read(1, 7), operations[0]);
  assert.equal(make().read(2, 7), null); assert.equal(make().read(1, 8), null);
  await first.complete(1, 7, ids[1], () => true);
  assert.ok(first.read(1, 7));
  await first.complete(1, 7, ids[0], () => true);
  const next = await second.prepare(1, 7, 2, () => true);
  await first.complete(1, 7, ids[0], () => true);
  assert.deepEqual(second.read(1, 7), next);
  await assert.rejects(first.prepare(1, 8, 2, () => false), /账号或装备/);
});
test('storage failure blocks preparation and preserves unresolved operations and corrupt data', async () => {
  const { make, storage, values } = fixture(); const store = make();
  const originalSet = storage.setItem;
  storage.setItem = () => { throw new Error('full'); };
  await assert.rejects(store.prepare(1, 7, 3, () => true), /保存失败/);
  assert.equal(store.read(1, 7), null);
  storage.setItem = originalSet;
  const operation = await store.prepare(1, 7, 3, () => true);
  storage.removeItem = () => { throw new Error('blocked'); };
  await assert.rejects(store.complete(1, 7, operation.payload.request_id, () => true), /保存失败/);
  assert.deepEqual(store.read(1, 7), operation);
  const key = [...values.keys()][0]; values.set(key, '{bad');
  assert.throws(() => store.read(1, 7), /损坏/);
  assert.equal(values.get(key), '{bad');
});
