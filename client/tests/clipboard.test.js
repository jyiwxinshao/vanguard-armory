import test from 'node:test';
import assert from 'node:assert/strict';
import { copyToClipboard } from '../src/utils/clipboard.js';
import { copyOrderNumber } from '../src/utils/order-copy.js';

test('copyToClipboard writes the requested text and reports success', async () => {
  const written = [];
  const result = await copyToClipboard('VA20260918', { clipboard: { writeText: async (text) => { written.push(text); } } });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(written, ['VA20260918']);
});

test('copyToClipboard degrades safely for empty, unavailable or failing clipboard', async () => {
  assert.deepEqual(await copyToClipboard('', { clipboard: { writeText: async () => {} } }), { ok: false, reason: 'empty' });
  assert.deepEqual(await copyToClipboard('VA', { clipboard: undefined }), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await copyToClipboard('VA', { clipboard: { writeText: async () => { throw new Error('denied'); } } }), { ok: false, reason: 'failed' });
});

test('copyOrderNumber notifies success and failure without throwing', async () => {
  const calls = [];
  const notify = { success: (message) => calls.push(['success', message]), error: (message) => calls.push(['error', message]) };
  assert.equal(await copyOrderNumber('VA2026', { notify, clipboard: { writeText: async () => {} } }), true);
  assert.deepEqual(calls.at(-1), ['success', '订单号已复制']);
  assert.equal(await copyOrderNumber('VA2026', { notify, clipboard: { writeText: async () => { throw new Error('x'); } } }), false);
  assert.deepEqual(calls.at(-1), ['error', '复制失败，请手动复制']);
});
