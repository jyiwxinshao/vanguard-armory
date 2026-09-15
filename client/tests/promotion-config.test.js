import test from 'node:test';
import assert from 'node:assert/strict';
import { activePromotion } from '../src/config/promotions.js';
import { createPromotionStorage } from '../src/utils/promotion-storage.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('the active promotion is a poster with an id, image and search keyword', () => {
  assert.equal(typeof activePromotion.id, 'string');
  assert.equal(activePromotion.active, true);
  assert.equal(typeof activePromotion.image, 'string');
  assert.equal(typeof activePromotion.keyword, 'string');
});

test('the active promotion is selected once and a new id can be selected again', () => {
  const storage = memoryStorage();
  const promotions = createPromotionStorage({ storage });
  assert.equal(promotions.nextUnseen([activePromotion]).id, activePromotion.id);
  promotions.markSeen(activePromotion.id);
  assert.equal(promotions.nextUnseen([activePromotion]), null);
  assert.equal(promotions.nextUnseen([{ ...activePromotion, id: 'next-series-2026-10' }]).id, 'next-series-2026-10');
});
