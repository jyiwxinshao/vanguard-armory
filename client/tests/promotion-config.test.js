import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { activePromotions } from '../src/config/promotions.js';
import { createPromotionStorage } from '../src/utils/promotion-storage.js';
import { demoEquipments } from '../../database/equipments.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('the active promotions form three themed posters with a series deep link', () => {
  assert.equal(activePromotions.length, 3);
  assert.ok(activePromotions.every((promotion) => promotion.active === true));
  assert.deepEqual(activePromotions.map((promotion) => promotion.theme).sort(), ['abyssal', 'eclipse', 'frostfire']);
  assert.deepEqual(activePromotions.map((promotion) => promotion.series).sort(), ['abyssal_remnants', 'eclipse_relics', 'frostfire_resonance']);
  for (const promotion of activePromotions) {
    assert.ok(existsSync(fileURLToPath(new URL(`../public${promotion.image}`, import.meta.url))), `missing ${promotion.image}`);
  }
});

test('the seeded equipment catalog covers every active promotion series', () => {
  assert.equal(demoEquipments.filter((item) => item.series_code === 'eclipse_relics').length, 6);
  assert.equal(demoEquipments.filter((item) => item.series_code === 'abyssal_remnants').length, 8);
  const frostfire = demoEquipments.filter((item) => item.series_code === 'frostfire_resonance');
  assert.equal(frostfire.length, 8);
  for (const item of frostfire) {
    assert.ok(existsSync(fileURLToPath(new URL(`../public${item.image}`, import.meta.url))), `missing ${item.image}`);
  }
});

test('the active promotions are selected once and a new id can be selected again', () => {
  const storage = memoryStorage();
  const promotions = createPromotionStorage({ storage });
  assert.equal(promotions.nextUnseen(activePromotions).id, activePromotions[0].id);
  promotions.markSeenMany(activePromotions.map((promotion) => promotion.id));
  assert.equal(promotions.nextUnseen(activePromotions), null);
  assert.equal(promotions.nextUnseen([{ ...activePromotions[0], id: 'next-series-2026-10' }]).id, 'next-series-2026-10');
});
