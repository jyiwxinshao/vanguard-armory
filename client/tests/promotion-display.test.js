import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePromotion } from '../src/utils/promotion-display.js';
import { consumeInitialHome, recordInitialRoute, resetPromotionSession } from '../src/utils/promotion-session.js';

const promotion = { id: 'eclipse-relics-2026-09', active: true };

function decision({ seen = false, isDev = true } = {}) {
  return decidePromotion({
    promotion,
    hasSeen: (id) => id === 'eclipse-relics-2026-09' ? seen : false,
    isInitialHome: consumeInitialHome(),
    isDev,
  });
}

test('dev opening the home route directly shows the promotion even if already seen', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.equal(decision({ seen: true, isDev: true }), promotion);
});

test('returning to the home route inside the same SPA lifecycle does not show it again', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.equal(decision({ isDev: true }), promotion);
  recordInitialRoute('/equipments/1');
  assert.equal(decision({ isDev: true }), null);
});

test('reloading the app with home as the initial route can show it again', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.equal(decision({ seen: true, isDev: true }), promotion);
  resetPromotionSession();
  recordInitialRoute('/');
  assert.equal(decision({ seen: true, isDev: true }), promotion);
});

test('production still respects the seen promotion id', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  assert.equal(decision({ seen: false, isDev: false }), promotion);
  resetPromotionSession();
  recordInitialRoute('/');
  assert.equal(decision({ seen: true, isDev: false }), null);
});

test('a new promotion id is shown again in production', () => {
  resetPromotionSession();
  recordInitialRoute('/');
  const result = decidePromotion({
    promotion: { id: 'next-series-2026-10', active: true },
    hasSeen: (id) => id === 'eclipse-relics-2026-09',
    isInitialHome: consumeInitialHome(),
    isDev: false,
  });
  assert.deepEqual(result, { id: 'next-series-2026-10', active: true });
});
