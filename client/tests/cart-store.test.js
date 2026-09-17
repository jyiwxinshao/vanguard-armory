import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { useCartStore } from '../src/stores/cart.js';
import { http, configureAuthTransport } from '../src/api/http.js';
import { storageHarness } from './helpers/cart-storage.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const item = (quantity = 2, id = 1) => ({ id, equipment_id: 11, name: '晨星长剑', image: '', price: 100, rarity: 'R', category: 'weapon', quantity, stock: 20, status: 'on_sale', available: true, reason: null, subtotal: quantity * 100 });
const payload = (quantity = 0) => ({ items: quantity ? [item(quantity)] : [], total_price: quantity * 100 });
function harness(t, local = storageHarness()) {
  const pinia = createPinia(); setActivePinia(pinia);
  const cart = useCartStore(); cart.configureStorage(local.store);
  const calls = [];
  const adapter = http.defaults.adapter;
  configureAuthTransport({});
  http.defaults.adapter = (config) => new Promise((resolve, reject) => {
    calls.push({ config,
      ok: (data) => resolve({ status: 200, headers: {}, config, data: { code: 0, data } }),
      fail: (status, code = 99999) => {
        const error = new Error('network failed'); error.config = config;
        if (status) error.response = { status, data: { code, message: '测试错误', data: { stock: 3 } } };
        reject(error);
      },
    });
  });
  let revision = 0;
  const session = (kind = 'server', userId = 7) => {
    const expected = ++revision;
    return cart.setSession({ kind, userId, token: kind === 'server' ? `user-${userId}` : null, revision, current: () => revision === expected });
  };
  async function ready(quantity = 0) {
    const promise = session(); await flush(); calls.at(-1).ok(payload(quantity)); await promise;
  }
  t.after(() => { http.defaults.adapter = adapter; configureAuthTransport({}); disposePinia(pinia); });
  return { cart, calls, local, session, ready };
}

test('server cart initializes once and counts quantities, including unavailable rows', async (t) => {
  const { cart, calls, session } = harness(t);
  const promise = session();
  const shared = cart.fetchCart();
  await flush(); assert.equal(calls.length, 1);
  const data = { items: [item(2), { ...item(3, 2), equipment_id: 12, available: false }], total_price: 500 };
  calls[0].ok(data); await Promise.all([promise, shared]);
  assert.equal(cart.itemCount, 5); assert.equal(cart.availableTotal, 200); assert.equal(cart.checkoutAllowed, false);
  assert.equal(cart.loading, false);
});

test('server mutations use correct IDs, absolute updates, and one atomic batch request', async (t) => {
  const { cart, calls, ready } = harness(t); await ready(2);
  let pending = cart.addItem(11, 3); await flush();
  assert.deepEqual(JSON.parse(calls.at(-1).config.data), { equipment_id: 11, quantity: 3 });
  calls.at(-1).ok(payload(5)); await pending; assert.equal(cart.itemCount, 5);
  pending = cart.updateItem(1, 4); await flush(); assert.equal(calls.at(-1).config.url, '/cart/items/1');
  calls.at(-1).ok(payload(4)); await pending;
  pending = cart.removeItems([1, 2]); await flush();
  assert.equal(calls.at(-1).config.url, '/cart/items/batch-delete');
  assert.deepEqual(JSON.parse(calls.at(-1).config.data), { ids: [1, 2] });
  calls.at(-1).ok(payload()); await pending; assert.equal(cart.itemCount, 0);
  pending = cart.clear(); await flush(); calls.at(-1).ok(payload()); await pending;
  assert.equal(calls.at(-1).config.method, 'delete');
  const count = calls.length; await cart.removeItems([]); assert.equal(calls.length, count);
});

test('reads and writes are serialized so an old GET cannot overwrite a later mutation', async (t) => {
  const { cart, calls, ready } = harness(t); await ready(2);
  const read = cart.fetchCart();
  const add = cart.addItem(11, 1);
  await flush(); assert.equal(calls.length, 2);
  calls[1].ok(payload(2)); await read; await flush(); assert.equal(calls.length, 3);
  calls[2].ok(payload(3)); await add;
  assert.equal(cart.itemCount, 3); assert.equal(cart.loading, false);
});

test('logout and account switches ignore late success, errors and finalizers', async (t) => {
  const { cart, calls, session } = harness(t);
  const a = session('server', 7); await flush();
  const b = session('server', 8); await flush();
  calls[0].ok(payload(9)); await assert.rejects(a, /账号状态/);
  assert.equal(cart.itemCount, 0); assert.equal(cart.loading, true);
  calls[1].ok(payload(3)); await b; assert.equal(cart.itemCount, 3);
  const old = cart.fetchCart(); await flush();
  await session('guest');
  calls[2].fail(401); await assert.rejects(old);
  assert.equal(cart.itemCount, 0); assert.equal(cart.error, ''); assert.equal(cart.mode, 'guest');
});

test('queued operations never dispatch using a different account token', async (t) => {
  const { cart, calls, ready, session } = harness(t); await ready(2);
  const first = cart.addItem(11, 1); const second = cart.addItem(11, 1);
  const rejected = Promise.allSettled([first, second]);
  await flush(); await session('admin', 1);
  calls[1].ok(payload(3));
  const result = await rejected;
  assert.ok(result.every((entry) => entry.status === 'rejected'));
  assert.equal(calls.length, 2); assert.equal(cart.itemCount, 0);
});

test('anonymous cart is empty and rejects mutations without touching local storage or APIs', async (t) => {
  const { cart, calls, session } = harness(t);
  cart.configureStorage(new Proxy({}, { get() { throw new Error('guest storage must not be accessed'); } }));
  await session('guest'); await cart.fetchCart();
  assert.equal(cart.itemCount, 0); assert.equal(cart.totalPrice, 0);
  assert.equal(cart.canWrite, false); assert.equal(cart.canManage, false); assert.equal(cart.checkoutAllowed, false);
  for (const mutate of [() => cart.addItem(11, 2), () => cart.updateItem(1, 1), () => cart.removeItem(1), () => cart.removeItems([1]), () => cart.clear()]) {
    await assert.rejects(mutate(), /登录/);
  }
  assert.equal(calls.length, 0); assert.deepEqual(cart.items, []);
});

test('fresh server carts do not create guest data or require a legacy storage lock', async (t) => {
  const { cart, calls, session, local } = harness(t);
  cart.configureStorage({ read: local.store.read, prepare: () => { throw new Error('no legacy batch'); } });
  const pending = session(); await flush();
  assert.equal(calls[0].config.url, '/cart');
  calls[0].ok(payload(2)); await pending;
  assert.equal(cart.itemCount, 2); assert.equal(local.store.read().revision, 0);
  await session('guest');
  assert.equal(cart.itemCount, 0); assert.equal(cart.canWrite, false);
  assert.equal(local.store.read().revision, 0);
});

test('merge applies the complete server response once and only then consumes the guest batch', async (t) => {
  const { cart, calls, session, local } = harness(t);
  await local.store.mutate((entries) => entries.push({ equipment_id: 11, quantity: 2 }));
  const pending = session(); const duplicate = cart.fetchCart(); await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].config.url, '/cart/merge');
  const body = JSON.parse(calls[0].config.data);
  assert.equal(local.store.read().batches[0].items[0].quantity, 2);
  calls[0].ok({ ...payload(5), merge: { merge_id: body.merge_id, replayed: false }, adjustments: [] });
  await Promise.all([pending, duplicate]);
  assert.equal(cart.itemCount, 5); assert.equal(local.store.read().batches.length, 0);
});

test('lost merge response retains its ID through refresh and retries without client-side addition', async (t) => {
  const { cart, calls, session, local } = harness(t);
  await local.store.mutate((entries) => entries.push({ equipment_id: 11, quantity: 2 }));
  const initial = session(); const checked = assert.rejects(initial); await flush();
  const original = JSON.parse(calls[0].config.data);
  calls[0].fail(); await flush(); calls[1].ok(payload(5)); await checked;
  assert.equal(cart.phase, 'merge-error'); assert.equal(local.store.read().batches.length, 1);
  const retry = cart.fetchCart(); await flush();
  assert.deepEqual(JSON.parse(calls[2].config.data), original);
  calls[2].ok({ ...payload(5), merge: { merge_id: original.merge_id, replayed: true }, adjustments: [] });
  await retry; assert.equal(cart.itemCount, 5); assert.equal(local.store.read().batches.length, 0);
});

test('successful A merge arriving after B login cannot clear A snapshot or overwrite B state', async (t) => {
  const { cart, calls, session, local } = harness(t);
  await local.store.mutate((entries) => entries.push({ equipment_id: 11, quantity: 2 }));
  const a = session('server', 7); const rejected = assert.rejects(a); await flush();
  const body = JSON.parse(calls[0].config.data);
  const b = session('server', 8); await flush();
  assert.equal(calls[1].config.url, '/cart');
  calls[1].ok(payload(1)); await b;
  calls[0].ok({ ...payload(5), merge: { merge_id: body.merge_id, replayed: false }, adjustments: [] }); await rejected;
  assert.equal(cart.itemCount, 1); assert.equal(local.store.read().batches[0].merge.target_user_id, 7);
});

test('cleanup failure retains the receipt-bound batch and a safe replay completes cleanup', async (t) => {
  const { cart, calls, session, local } = harness(t);
  await local.store.mutate((entries) => entries.push({ equipment_id: 11, quantity: 2 }));
  const first = session(); const rejected = assert.rejects(first, /清理待重试/); await flush();
  const body = JSON.parse(calls[0].config.data);
  const write = local.storage.setItem;
  local.storage.setItem = () => { throw new Error('quota'); };
  calls[0].ok({ ...payload(5), merge: { merge_id: body.merge_id }, adjustments: [] }); await rejected;
  assert.equal(cart.itemCount, 5); assert.equal(local.store.read().batches.length, 1);
  local.storage.setItem = write;
  const retry = cart.fetchCart(); await flush();
  calls[1].ok({ ...payload(4), merge: { merge_id: body.merge_id, replayed: true }, adjustments: [] }); await retry;
  assert.equal(cart.itemCount, 4); assert.equal(local.store.read().batches.length, 0);
});

test('malformed success does not clear the batch and ordinary write timeouts require reconciliation', async (t) => {
  const { cart, calls, session, local } = harness(t);
  await local.store.mutate((entries) => entries.push({ equipment_id: 11, quantity: 2 }));
  const first = session(); const rejected = assert.rejects(first, /响应/); await flush();
  calls[0].ok(payload(5)); await rejected; assert.equal(local.store.read().batches.length, 1);
  await session('guest');
  const next = session('server', 8); await flush(); calls.at(-1).ok(payload()); await next;
  const add = cart.addItem(11, 2); const uncertain = assert.rejects(add, /结果待核对/); await flush(); calls.at(-1).fail(); await uncertain;
  assert.equal(cart.phase, 'uncertain'); assert.equal(cart.canWrite, false);
});

test('administrator and pending identity do not fetch or consume guest cart', async (t) => {
  const { cart, calls, session, local } = harness(t);
  await local.store.mutate((entries) => entries.push({ equipment_id: 11, quantity: 2 }));
  await session('admin', 1); await session('pending');
  assert.equal(calls.length, 0); assert.equal(cart.itemCount, 0); assert.equal(cart.canWrite, false);
  assert.equal(local.store.read().batches[0].merge, null);
});

test('a real failed login leaves legacy data untouched and the anonymous cart empty', async (t) => {
  const { useAuthStore } = await import('../src/stores/auth.js');
  const { installCartSession } = await import('../src/cart-session.js');
  const { GUEST_CART_KEY } = await import('../src/utils/guest-cart-storage.js');
  const h = harness(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: h.local.storage, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  await h.local.store.mutate((entries) => entries.push({ equipment_id: 11, quantity: 2 }));
  const auth = useAuthStore();
  const stop = installCartSession(auth, h.cart, new EventTarget()); t.after(stop);
  await flush(); assert.equal(h.calls.length, 0);
  const before = h.local.storage.getItem(GUEST_CART_KEY);
  const login = auth.login({ account: 'wrong_user', password: 'wrong_password' });
  const rejected = assert.rejects(login);
  await flush(); h.calls[0].fail(401, 10002); await rejected;
  assert.equal(auth.isAuthenticated, false); assert.equal(h.cart.mode, 'guest'); assert.equal(h.cart.itemCount, 0);
  assert.equal(h.local.storage.getItem(GUEST_CART_KEY), before);
});
