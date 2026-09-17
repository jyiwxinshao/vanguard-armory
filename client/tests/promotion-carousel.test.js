import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromotionCarousel, nextIndex, previousIndex, promotionActionClass, wrapIndex } from '../src/utils/promotion-carousel.js';

function fakeTimers() {
  const timers = new Map();
  let nextId = 0;
  return {
    interval: (fn) => { const id = ++nextId; timers.set(id, fn); return id; },
    clear: (id) => { timers.delete(id); },
    fire: (id) => { const fn = timers.get(id); if (fn) fn(); },
    ids: () => [...timers.keys()],
    count: () => timers.size,
  };
}

test('carousel index arithmetic wraps circularly in both directions', () => {
  assert.equal(wrapIndex(0, 3), 0);
  assert.equal(wrapIndex(3, 3), 0);
  assert.equal(wrapIndex(-1, 3), 2);
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(previousIndex(0, 3), 2);
  assert.equal(wrapIndex(2, 0), 0);
});

test('promotion theme maps to a dedicated action class with eclipse as the fallback', () => {
  assert.equal(promotionActionClass('eclipse'), 'promotion-action--eclipse');
  assert.equal(promotionActionClass('abyssal'), 'promotion-action--abyssal');
  assert.equal(promotionActionClass('frostfire'), 'promotion-action--frostfire');
  assert.equal(promotionActionClass(undefined), 'promotion-action--eclipse');
  assert.equal(promotionActionClass('unknown'), 'promotion-action--eclipse');
});

test('carousel navigation, dot jumps and circular transitions stay in bounds', () => {
  const timers = fakeTimers();
  const changes = [];
  const carousel = createPromotionCarousel({ count: 3, interval: timers.interval, clear: timers.clear, onChange: (index) => changes.push(index) });
  assert.equal(carousel.getIndex(), 0);
  assert.equal(carousel.next(), 1);
  assert.equal(carousel.next(), 2);
  assert.equal(carousel.next(), 0);
  assert.equal(carousel.previous(), 2);
  assert.equal(carousel.goTo(5), 2);
  assert.equal(carousel.goTo(-1), 2);
  carousel.dispose();
});

test('autoplay starts for multiple slides, resets after manual navigation and pauses on hover', () => {
  const timers = fakeTimers();
  let ticks = 0;
  const carousel = createPromotionCarousel({ count: 2, interval: timers.interval, clear: timers.clear, onChange: () => { ticks += 1; } });
  assert.equal(timers.count(), 1);

  carousel.setHover(true);
  assert.equal(timers.count(), 0);
  carousel.setHover(false);
  assert.equal(timers.count(), 1);

  timers.fire(timers.ids()[0]);
  assert.equal(carousel.getIndex(), 1);
  assert.equal(ticks, 1);
  assert.equal(timers.count(), 1);

  carousel.next();
  assert.equal(carousel.getIndex(), 0);
  assert.equal(timers.count(), 1);
  carousel.dispose();
  assert.equal(timers.count(), 0);
});

test('single slide never starts autoplay and dispose clears the timer', () => {
  const timers = fakeTimers();
  const single = createPromotionCarousel({ count: 1, interval: timers.interval, clear: timers.clear });
  assert.equal(timers.count(), 0);
  single.next();
  assert.equal(single.getIndex(), 0);

  const multi = createPromotionCarousel({ count: 2, interval: timers.interval, clear: timers.clear });
  assert.equal(timers.count(), 1);
  multi.dispose();
  assert.equal(timers.count(), 0);
});
