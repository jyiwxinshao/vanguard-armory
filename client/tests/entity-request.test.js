import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityRequest } from '../src/utils/entity-request.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('a slow response for an older id cannot overwrite a newer id', async () => {
  const first = deferred();
  const second = deferred();
  const values = [];
  const finishes = [];
  const loader = createEntityRequest({
    fetchEntity: (id) => id === '1' ? first.promise : second.promise,
    onSuccess: (value) => values.push(value),
    onFinish: () => finishes.push('finished'),
  });
  const old = loader.load('1');
  const latest = loader.load('2');
  second.resolve({ id: '2' });
  await latest;
  first.resolve({ id: '1' });
  await old;
  assert.deepEqual(values, [{ id: '2' }]);
  assert.deepEqual(finishes, ['finished']);
});

test('rapid id changes settle on the final id only', async () => {
  const pending = new Map();
  const values = [];
  const loader = createEntityRequest({
    fetchEntity: (id) => {
      const entry = deferred();
      pending.set(id, entry);
      return entry.promise;
    },
    onSuccess: (value) => values.push(value),
  });
  const runs = ['1', '2', '3'].map((id) => loader.load(id));
  pending.get('3').resolve('three');
  await runs[2];
  pending.get('2').resolve('two');
  await runs[1];
  pending.get('1').resolve('one');
  await runs[0];
  assert.deepEqual(values, ['three']);
});

test('a current response still publishes and a disposed loader drops everything', async () => {
  const work = deferred();
  const values = [];
  const loader = createEntityRequest({
    fetchEntity: () => work.promise,
    onSuccess: (value) => values.push(value),
  });
  const running = loader.load('9');
  work.resolve('ok');
  await running;
  assert.deepEqual(values, ['ok']);

  const disposed = deferred();
  const silent = createEntityRequest({ fetchEntity: () => disposed.promise, onSuccess: (value) => values.push(value) });
  const ignored = silent.load('10');
  silent.dispose();
  disposed.resolve('late');
  await ignored;
  assert.deepEqual(values, ['ok']);
});
