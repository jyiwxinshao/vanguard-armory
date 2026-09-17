import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { installCartSession } from '../src/cart-session.js';
import { GUEST_CART_KEY } from '../src/utils/guest-cart-storage.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));
function harness() {
  const target = new EventTarget();
  const auth = reactive({ status: 'anonymous', user: null, revision: 0, token: null,
    get isAuthenticated() { return this.status === 'authenticated' && !!this.user && !!this.token; },
    isCurrentSession(token, revision) { return token === this.token && revision === this.revision; },
  });
  const calls = [];
  const cart = reactive({ mode: 'guest', loading: false, refreshes: 0,
    async setSession(next) { calls.push(next); this.mode = next.kind; },
    async fetchCart() { this.refreshes += 1; },
  });
  const stop = installCartSession(auth, cart, target);
  return { auth, cart, calls, target, stop };
}

test('session coordination tracks identity and role, and a failed login without identity change cannot claim a batch', () => {
  const h = harness();
  try {
    assert.equal(h.calls.at(-1).kind, 'guest');
    const old = h.calls.at(-1);
    // A failed login has no authenticated identity transition.
    h.auth.status = 'anonymous';
    assert.equal(h.calls.length, 1);
    h.auth.token = 'A'; h.auth.user = { id: 7, role: 'user' }; h.auth.status = 'authenticated';
    assert.equal(h.calls.at(-1).kind, 'server'); assert.equal(h.calls.at(-1).userId, 7);
    assert.equal(old.current(), false);
    h.auth.user = { id: 8, role: 'user' };
    assert.equal(h.calls.at(-1).userId, 8);
    h.auth.user.role = 'admin'; assert.equal(h.calls.at(-1).kind, 'admin');
    h.auth.status = 'unavailable'; assert.equal(h.calls.at(-1).kind, 'pending');
  } finally { h.stop(); }
});

test('legacy storage notifications during authenticated synchronization refresh after loading', async () => {
  const h = harness();
  try {
    h.auth.token = 'A'; h.auth.user = { id: 7, role: 'user' }; h.auth.status = 'authenticated';
    h.cart.loading = true;
    const event = new Event('storage'); Object.defineProperty(event, 'key', { value: GUEST_CART_KEY });
    h.target.dispatchEvent(event);
    await tick(); assert.equal(h.cart.refreshes, 0);
    h.cart.loading = false;
    await tick(); assert.equal(h.cart.refreshes, 1);
  } finally { h.stop(); }
});


test('focus and legacy storage events do not refresh or resurrect an anonymous cart', async () => {
  const h = harness();
  try {
    const event = new Event('storage'); Object.defineProperty(event, 'key', { value: GUEST_CART_KEY });
    h.target.dispatchEvent(event); h.target.dispatchEvent(new Event('focus'));
    await tick(); assert.equal(h.cart.refreshes, 0);
    h.auth.token = 'A'; h.auth.user = { id: 7, role: 'user' }; h.auth.status = 'authenticated';
    h.cart.loading = true; h.target.dispatchEvent(event);
    await tick();
    h.auth.token = null; h.auth.user = null; h.auth.status = 'anonymous'; h.cart.loading = false;
    await tick(); assert.equal(h.cart.refreshes, 0);
  } finally { h.stop(); }
});
