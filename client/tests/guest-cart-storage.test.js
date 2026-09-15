import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GUEST_CART_KEY } from '../src/utils/guest-cart-storage.js';
import { storageHarness } from './helpers/cart-storage.js';

test('guest changes survive recreation, same-batch writes are serialized, and only IDs and quantities are saved', async () => {
  const h = storageHarness();
  await h.store.ensureGuest();
  await Promise.all([h.store, h.create()].map((store) => store.mutate((items) => {
    const item = items.find((entry) => entry.equipment_id === 11);
    if (item) item.quantity += 1; else items.push({ equipment_id: 11, quantity: 1 });
  })));
  assert.deepEqual((await h.create().ensureGuest()).items, [{ equipment_id: 11, quantity: 2 }]);
});

test('a claimed batch stays durable, retries keep the ID, and another account cannot claim it', async () => {
  const h = storageHarness();
  await h.store.mutate((items) => items.push({ equipment_id: 1, quantity: 2 }));
  const [batch] = await h.store.prepare(7);
  assert.deepEqual((await h.create().prepare(7))[0], batch);
  assert.deepEqual(await h.create().prepare(8), []);
  assert.equal(h.store.read().batches[0].items[0].quantity, 2);
  await h.store.mutate((items) => items.push({ equipment_id: 2, quantity: 1 }));
  await assert.rejects(h.store.acknowledge(batch, 8), /变化/);
  await h.store.acknowledge(batch, 7);
  assert.deepEqual((await h.store.ensureGuest()).items, [{ equipment_id: 2, quantity: 1 }]);
});

test('malformed, future-version and invalid quantities preserve the original local bytes', async () => {
  const h = storageHarness();
  for (const raw of ['{broken', '{"version":2}', JSON.stringify({ version: 1, revision: 0, active_batch_id: null, batches: [{ batch_id: randomUUID(), items: [{ equipment_id: 1, quantity: 0 }], merge: null }] })]) {
    h.storage.setItem(GUEST_CART_KEY, raw);
    await assert.rejects(h.store.ensureGuest());
    assert.equal(h.storage.getItem(GUEST_CART_KEY), raw);
  }
});

test('quota errors and session changes cannot consume or overwrite a pending guest batch', async () => {
  const h = storageHarness();
  await h.store.mutate((items) => items.push({ equipment_id: 1, quantity: 2 }));
  const before = h.storage.getItem(GUEST_CART_KEY);
  await assert.rejects(h.store.prepare(7, () => false), /账号状态/);
  assert.equal(h.storage.getItem(GUEST_CART_KEY), before);
  h.storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(h.store.prepare(7), /保存失败/);
  assert.equal(h.storage.getItem(GUEST_CART_KEY), before);
});

test('100 distinct kinds is enforced without overwriting the existing batch', async () => {
  const h = storageHarness();
  await h.store.mutate((items) => { for (let id = 1; id <= 100; id++) items.push({ equipment_id: id, quantity: 1 }); });
  await assert.rejects(h.store.mutate((items) => items.push({ equipment_id: 101, quantity: 1 })), /100/);
  assert.equal((await h.store.ensureGuest()).items.length, 100);
});
