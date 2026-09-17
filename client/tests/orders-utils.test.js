import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutErrors, confirmationItems, orderAmountLabel, orderQueryFromRoute, orderQueryToApi } from '../src/utils/orders.js';
import { createCheckoutStorage } from '../src/utils/checkout-storage.js';
import { storageHarness } from './helpers/cart-storage.js';
import { randomUUID } from 'node:crypto';
const fields = { character_id: 1, server: 'star_1' };
const items = [{ cart_item_id: 2, equipment_id: 11, quantity: 2, expected_price: 100 }];

test('checkout fields and confirmation retain cart IDs and expected prices, never invent final totals', () => {
  assert.deepEqual(checkoutErrors(fields, [{ value: 'star_1' }]), {});
  assert.ok(checkoutErrors({ server: 'bad', character_id: null }, []).character_id);
  assert.ok(checkoutErrors({ ...fields, server: 'bad' }, [{ value: 'star_1' }]).server);
  assert.deepEqual(confirmationItems([{ id: 2, equipment_id: 11, quantity: 2, price: 100, stock: 500 }]), items);
  assert.equal(orderAmountLabel('pending'), '应付金额');
  assert.equal(orderAmountLabel('paid'), '实付金额');
  assert.equal(orderAmountLabel('completed'), '实付金额');
  assert.equal(orderAmountLabel('cancelled'), '订单金额');
});

test('order filters restore from routes, reject invalid date ranges and produce ISO query boundaries', () => {
  const filter = orderQueryFromRoute({ status: 'paid', page: '2', page_size: '20', from: '2026-09-15', to: '2026-09-16' });
  const query = orderQueryToApi(filter); assert.equal(query.page, 2); assert.equal(query.page_size, 20);
  assert.match(query.created_from, /Z$/); assert.ok(new Date(query.created_to) > new Date(query.created_from));
  assert.equal(query.created_from, new Date('2026-09-15T00:00:00').toISOString());
  assert.equal(query.created_to, new Date('2026-09-17T00:00:00').toISOString());
  assert.throws(() => orderQueryToApi({ ...filter, from: '2026-09-17' }), /结束日期/);
  assert.throws(() => orderQueryToApi({ ...filter, from: '2026-02-30', to: '' }), /有效日期/);
  assert.deepEqual(orderQueryFromRoute({ status: 'hacked', page: 'NaN', page_size: '3' }), { status: '', from: '', to: '', page: 1, page_size: 10 });
});

function storageTest() {
  const h = storageHarness(); let tail = Promise.resolve();
  const lock = (task) => { const promise = tail.then(task); tail = promise.catch(() => {}); return promise; };
  const storage = createCheckoutStorage({ storage: h.storage, lock, uuid: randomUUID });
  return { storage, local: h.storage };
}

test('checkout preparation is persistent and concurrent callers reuse the same immutable submission', async () => {
  const { storage } = storageTest(); const body = { ...fields, items };
  const [first, second] = await Promise.all([storage.prepare(7, body, () => true), storage.prepare(7, { ...body, character_id: 2 }, () => true)]);
  assert.deepEqual(first, second); assert.deepEqual(storage.read(7), first); assert.equal(storage.read(8), null);
  await assert.rejects(storage.discardRejected(7, () => true), /尚未确认/);
  await storage.complete(7, randomUUID(), () => true); assert.deepEqual(storage.read(7), first);
  await storage.complete(7, first.payload.request_id, () => true); assert.equal(storage.read(7), null);
});

test('only a confirmed rejection can be discarded and old-session cleanup cannot erase another draft', async () => {
  const { storage } = storageTest();
  const first = await storage.prepare(7, { ...fields, items }, () => true);
  await assert.rejects(storage.complete(7, first.payload.request_id, () => false), /账号状态/);
  await storage.rejected(7, first.payload.request_id, () => true);
  assert.equal(storage.read(7).state, 'rejected');
  await storage.discardRejected(7, () => true); assert.equal(storage.read(7), null);
});

test('storage failure and malformed saved data never report a successful preparation or erase source data', async () => {
  const { storage, local } = storageTest();
  local.setItem('game_store.checkout.7.v1', '{broken');
  await assert.rejects(storage.prepare(7, { ...fields, items }, () => true), /损坏/);
  assert.equal(local.getItem('game_store.checkout.7.v1'), '{broken');
  local.setItem = () => { throw new Error('quota'); };
  await assert.rejects(storage.prepare(8, { ...fields, items }, () => true), /保存失败/);
  assert.equal(storage.read(8), null);
});

test('legacy checkout records remain immutable and recoverable while new submissions use version 2', async () => {
  const { storage, local } = storageTest();
  const legacy = { version: 1, user_id: 7, state: 'pending', payload: { request_id: randomUUID(), character_name: '旧角色', server: 'star_1', remark: '旧备注', items } };
  local.setItem('game_store.checkout.7.v1', JSON.stringify(legacy));
  assert.deepEqual(storage.read(7), legacy);
  assert.deepEqual(await storage.prepare(7, { ...fields, items }, () => true), legacy);
  await assert.rejects(storage.discardRejected(7, () => true), /尚未确认/);
  await storage.complete(7, legacy.payload.request_id, () => true);
  const current = await storage.prepare(7, { ...fields, items }, () => true);
  assert.equal(current.version, 2); assert.equal(current.payload.character_id, 1);
  assert.equal(current.payload.character_name, undefined); assert.equal(current.payload.remark, undefined);
});
