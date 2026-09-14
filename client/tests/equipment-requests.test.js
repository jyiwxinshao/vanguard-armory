import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinia, setActivePinia } from 'pinia';
import { createLatestRequest } from '../src/utils/latest-request.js';
import { equipmentImageSource, EQUIPMENT_PLACEHOLDER, nextEquipmentImage } from '../src/utils/equipment-image.js';
import { useCatalogStore } from '../src/stores/catalog.js';
import { http } from '../src/api/http.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('only the latest equipment response can update results or end loading', async () => {
  const request = createLatestRequest();
  const first = deferred();
  const second = deferred();
  const values = [];
  const finishes = [];
  let firstSignal;
  const old = request.run((signal) => { firstSignal = signal; return first.promise; }, { onSuccess: (value) => values.push(value), onFinish: () => finishes.push('old') });
  const latest = request.run(() => second.promise, { onSuccess: (value) => values.push(value), onFinish: () => finishes.push('latest') });
  assert.equal(firstSignal.aborted, true);
  second.resolve('new result');
  await latest;
  first.resolve('old result');
  await old;
  assert.deepEqual(values, ['new result']);
  assert.deepEqual(finishes, ['latest']);
});

test('late failures cannot replace a newer success', async () => {
  const request = createLatestRequest();
  const first = deferred();
  const errors = [];
  const values = [];
  const old = request.run(() => first.promise, { onError: (error) => errors.push(error) });
  await request.run(async () => 'ready', { onSuccess: (value) => values.push(value) });
  first.reject(new Error('old network failure'));
  await old;
  assert.deepEqual(values, ['ready']);
  assert.deepEqual(errors, []);
});

test('a disposed equipment page cannot receive success, errors, or loading changes', async () => {
  const request = createLatestRequest();
  const work = deferred();
  const updates = [];
  const running = request.run(() => work.promise, { onSuccess: () => updates.push('success'), onError: () => updates.push('error'), onFinish: () => updates.push('finish') });
  request.dispose();
  work.resolve('late response');
  await running;
  await request.run(async () => { updates.push('new request'); });
  assert.deepEqual(updates, []);
});

test('a current request failure is visible and a later retry can succeed', async () => {
  const request = createLatestRequest();
  const updates = [];
  await request.run(async () => { throw new Error('offline'); }, { onError: (error) => updates.push(error.message), onFinish: () => updates.push('stopped') });
  await request.run(async () => 'recovered', { onSuccess: (value) => updates.push(value) });
  assert.deepEqual(updates, ['offline', 'stopped', 'recovered']);
});

test('equipment images stay local and a broken placeholder never loops', () => {
  assert.equal(equipmentImageSource('/images/equipments/sword.webp'), '/images/equipments/sword.webp');
  for (const source of [undefined, 'https://example.com/image.png', '//example.com/image.png', '/images/equipments/../private.png', '/images/equipments/%5csecret.png']) assert.equal(equipmentImageSource(source), EQUIPMENT_PLACEHOLDER);
  assert.equal(nextEquipmentImage('/images/equipments/missing.png'), EQUIPMENT_PLACEHOLDER);
  assert.equal(nextEquipmentImage(EQUIPMENT_PLACEHOLDER), null);
});

test('catalog metadata requests are deduplicated, cached, and retryable after failure', async () => {
  setActivePinia(createPinia());
  const catalog = useCatalogStore();
  const originalGet = http.get;
  let calls = 0;
  const work = deferred();
  const metadata = { rarities: [{ value: 'SSR', label: '传说' }], categories: [], servers: [] };
  http.get = () => { calls += 1; return work.promise; };
  try {
    const first = catalog.load();
    const duplicate = catalog.load();
    assert.equal(calls, 1);
    work.reject(new Error('offline'));
    await Promise.all([assert.rejects(first, /offline/), assert.rejects(duplicate, /offline/)]);
    assert.equal(catalog.loaded, false);
    http.get = async () => { calls += 1; return metadata; };
    await catalog.load();
    await catalog.load();
    assert.equal(calls, 2);
    assert.equal(catalog.loaded, true);
    assert.equal(catalog.rarity('SSR').label, '传说');
  } finally { http.get = originalGet; }
});
