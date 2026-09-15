import test from 'node:test';
import assert from 'node:assert/strict';
import { canQuickAdd, categoryLabel, isNewItem, rarityMeta } from '../src/utils/equipment-display.js';

test('isNewItem recognizes new flags while hiding normal equipment', () => {
  assert.equal(isNewItem({ is_new: true }), true);
  assert.equal(isNewItem({ is_new: 1 }), true);
  assert.equal(isNewItem({ is_new: false }), false);
  assert.equal(isNewItem({ is_new: 0 }), false);
  assert.equal(isNewItem({}), false);
  assert.equal(isNewItem(null), false);
});

test('canQuickAdd requires writable cart state and positive stock', () => {
  assert.equal(canQuickAdd({ stock: 3 }, true), true);
  assert.equal(canQuickAdd({ stock: 0 }, true), false);
  assert.equal(canQuickAdd({ stock: 3 }, false), false);
  assert.equal(canQuickAdd(null, true), false);
});

test('rarity and category mappings stay centralized', () => {
  assert.equal(rarityMeta('SSR').color, '#F59E0B');
  assert.equal(rarityMeta('SR').color, '#A855F7');
  assert.equal(rarityMeta('R').color, '#38BDF8');
  assert.equal(rarityMeta('N').color, '#94A3B8');
  assert.equal(categoryLabel('consumable'), '道具');
});
