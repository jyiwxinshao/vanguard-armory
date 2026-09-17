import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePromotions } from '../src/utils/promotion-display.js';
import { consumeInitialHome, recordInitialRoute, resetPromotionSession } from '../src/utils/promotion-session.js';

const eclipse = { id: 'eclipse-relics-2026-09', active: true, series: 'eclipse_relics', theme: 'eclipse' };
const abyssal = { id: 'abyssal-remnants-2026-09', active: true, series: 'abyssal_remnants', theme: 'abyssal' };
const promotions = [eclipse, abyssal];

function decision({ seen = [], isDev = true } = {}) {
  return decidePromotions({
    promotions,
    hasSeen: (id) => seen.includes(id),
    isInitialHome: consumeInitialHome(),
    isDev,
  });
}

test('dev opening the home route directly shows the promotion even if already seen', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.deepEqual(decision({ seen: [eclipse.id, abyssal.id], isDev: true }), promotions);
});

test('returning to the home route inside the same SPA lifecycle does not show it again', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.deepEqual(decision({ isDev: true }), promotions);
  recordInitialRoute('/equipments/1');
  assert.deepEqual(decision({ isDev: true }), []);
});

test('reloading the app with home as the initial route can show it again', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.deepEqual(decision({ seen: [eclipse.id, abyssal.id], isDev: true }), promotions);
  resetPromotionSession();
  recordInitialRoute('/');
  assert.deepEqual(decision({ seen: [eclipse.id, abyssal.id], isDev: true }), promotions);
});

test('production shows all active promotions when at least one is unseen', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.deepEqual(decision({ seen: [eclipse.id], isDev: false }), promotions);
  resetPromotionSession();
  recordInitialRoute('/');
  assert.deepEqual(decision({ seen: [eclipse.id, abyssal.id], isDev: false }), []);
});

test('no active promotions and a missing initial home never open the carousel', () => {
  resetPromotionSession();
  assert.deepEqual(decidePromotions({
    promotions: [],
    hasSeen: () => false,
    isInitialHome: consumeInitialHome(),
    isDev: true,
  }), []);
  resetPromotionSession();
  recordInitialRoute('/cart');
  assert.deepEqual(decision({ isDev: true }), []);
});
