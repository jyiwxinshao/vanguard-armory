import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromotionStorage, PROMOTION_SEEN_KEY } from '../src/utils/promotion-storage.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

const active = (id, overrides = {}) => ({ id, active: true, ...overrides });

test('the first active unseen promotion is selected once', () => {
  const storage = memoryStorage();
  const promotions = [active('a'), active('b')];
  assert.equal(createPromotionStorage({ storage }).nextUnseen(promotions).id, 'a');
  assert.equal(createPromotionStorage({ storage }).hasSeen('a'), false);
});

test('marking a promotion seen prevents it from repeating across new storage instances', () => {
  const storage = memoryStorage();
  const promotions = [active('a'), active('b')];
  const first = createPromotionStorage({ storage });
  first.markSeen('a');
  const second = createPromotionStorage({ storage });
  assert.equal(second.hasSeen('a'), true);
  assert.equal(second.nextUnseen(promotions).id, 'b');
});

test('a new promotion id is shown again after another is already seen', () => {
  const storage = memoryStorage();
  const first = createPromotionStorage({ storage });
  first.markSeen('old-promotion');
  assert.equal(first.nextUnseen([active('old-promotion'), active('new-promotion')]).id, 'new-promotion');
});

test('inactive promotions are skipped and malformed storage degrades safely', () => {
  const storage = memoryStorage();
  const promotions = [active('off', { active: false }), active('on')];
  assert.equal(createPromotionStorage({ storage }).nextUnseen(promotions).id, 'on');
  storage.setItem(PROMOTION_SEEN_KEY, '{broken');
  assert.equal(createPromotionStorage({ storage }).nextUnseen([active('on')]).id, 'on');
  assert.deepEqual(createPromotionStorage({ storage }).readSeen(), []);
});

test('marking many promotions seen deduplicates and preserves existing ids', () => {
  const storage = memoryStorage();
  const first = createPromotionStorage({ storage });
  first.markSeen('already-seen');
  first.markSeenMany(['a', 'b', 'a', '']);
  assert.deepEqual(first.readSeen().sort(), ['a', 'already-seen', 'b']);
  assert.equal(first.hasSeen('a'), true);
  assert.equal(first.hasSeen('b'), true);
});
