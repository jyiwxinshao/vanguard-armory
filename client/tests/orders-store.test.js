import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPinia, setActivePinia, disposePinia } from 'pinia';
import { useOrdersStore } from '../src/stores/orders.js';
import { useAuthStore } from '../src/stores/auth.js';
import { useCartStore } from '../src/stores/cart.js';
import { AUTH_TOKEN_KEY } from '../src/utils/auth.js';
import { createCheckoutStorage } from '../src/utils/checkout-storage.js';
import { http, configureAuthTransport } from '../src/api/http.js';
import { storageHarness } from './helpers/cart-storage.js';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const cartData = { items: [{ id: 4, equipment_id: 11, quantity: 2, price: 100, name: '长剑', image: '', rarity: 'R', stock: 20, status: 'on_sale', available: true, subtotal: 200 }], total_price: 200 };
const emptyCart = { items: [], total_price: 0 };
const fields = { character_name: '星河旅人', server: 'star_1', remark: '' };
const orderData = (id = 1, status = 'pending') => ({ id, status, order_no: 'order-1', actual_total: 200, total: 200, discount: 0, items: [{ id: 1, equipment_id: 11, equipment_name: '长剑', equipment_image: '', rarity: 'R', price: 100, quantity: 2 }] });
function harness(t) {
  const local = storageHarness();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: local.storage, configurable: true });
  const pinia = createPinia(); setActivePinia(pinia);
  const auth = useAuthStore(); const cart = useCartStore(); cart.configureStorage(local.store);
  const orders = useOrdersStore();
  let lockTail = Promise.resolve();
  const checkoutStorage = createCheckoutStorage({ storage: local.storage, uuid: randomUUID, lock: (task) => { const next = lockTail.then(task); lockTail = next.catch(() => {}); return next; } });
  orders.configureStorage(checkoutStorage);
  const calls = []; const adapter = http.defaults.adapter;
  configureAuthTransport({ getToken: () => auth.token, getRevision: () => auth.revision, isCurrentSession: (token, revision) => auth.isCurrentSession(token, revision) });
  http.defaults.adapter = (config) => new Promise((resolve, reject) => calls.push({ config,
    ok: (data) => resolve({ config, status: 200, headers: {}, data: { code: 0, data } }),
    fail: (status, code) => { const error = new Error('network failed'); error.config = config; if (status) error.response = { status, data: { code, message: '测试拒绝' } }; reject(error); },
  }));
  function login(id = 7) { local.storage.setItem(AUTH_TOKEN_KEY, `token-${id}`); auth.token = `token-${id}`; auth.user = { id, role: 'user' }; auth.revision += 1; auth.status = 'authenticated'; }
  login();
  async function ready() {
    const token = auth.token; const revision = auth.revision;
    const initial = cart.setSession({ kind: 'server', userId: auth.user.id, token, revision, current: () => auth.isCurrentSession(token, revision) });
    await flush(); calls.at(-1).ok(cartData); await initial;
    const load = orders.loadCheckout(); await flush(); calls.at(-1).ok(cartData); await load;
  }
  t.after(() => { http.defaults.adapter = adapter; configureAuthTransport({}); disposePinia(pinia); if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  return { auth, cart, orders, local, checkoutStorage, calls, login, ready };
}

test('confirmation waits for server cart and submission persists before POST, deduplicates clicks and applies returned cart', async (t) => {
  const h = harness(t); await h.ready();
  const submitted = h.orders.submit(fields); const duplicate = h.orders.submit(fields);
  await flush(); h.calls.at(-1).ok(cartData); await flush();
  const call = h.calls.at(-1); assert.equal(call.config.url, '/orders');
  const body = JSON.parse(call.config.data); assert.equal(body.items[0].cart_item_id, 4);
  assert.equal(h.checkoutStorage.read(7).payload.request_id, body.request_id);
  call.ok({ order: orderData(), request_id: body.request_id, replayed: false, cart: emptyCart });
  const results = await Promise.all([submitted, duplicate]); assert.equal(results[0].id, results[1].id);
  assert.equal(h.calls.filter((call) => call.config.url === '/orders').length, 1);
  assert.equal(h.cart.itemCount, 0); assert.equal(h.checkoutStorage.read(7), null);
});

test('network failure preserves immutable request through page reinitialization and retries the original ID', async (t) => {
  const h = harness(t); await h.ready();
  const initial = h.orders.submit(fields); const rejected = assert.rejects(initial);
  await flush(); h.calls.at(-1).ok(cartData); await flush();
  const body = JSON.parse(h.calls.at(-1).config.data); h.calls.at(-1).fail(); await rejected;
  assert.equal(h.orders.draft.state, 'pending');
  await h.orders.loadCheckout(); assert.equal(h.orders.draft.payload.request_id, body.request_id);
  const retry = h.orders.submit({ ...fields, remark: 'ignored' }); await flush(); h.calls.at(-1).ok(emptyCart); await flush();
  assert.deepEqual(JSON.parse(h.calls.at(-1).config.data), body);
  h.calls.at(-1).ok({ order: orderData(), request_id: body.request_id, replayed: true, cart: emptyCart });
  assert.equal((await retry).id, 1); assert.equal(h.checkoutStorage.read(7), null);
});

test('a 404 recovery is not proof of failure and cannot discard the pending submission', async (t) => {
  const h = harness(t); await h.checkoutStorage.prepare(7, { ...fields, items: [{ cart_item_id: 4, equipment_id: 11, quantity: 2, expected_price: 100 }] }, () => true);
  await h.orders.loadCheckout(); const recover = h.orders.recover(); const failed = assert.rejects(recover); await flush();
  h.calls.at(-1).fail(404, 10004); await failed;
  assert.ok(h.checkoutStorage.read(7)); await assert.rejects(h.orders.reconfirm(), /尚未确认/);
});

test('business rejection retains the source until explicit reconfirmation; storage failure prevents sending an order', async (t) => {
  const h = harness(t); await h.ready();
  const submit = h.orders.submit(fields); const rejected = assert.rejects(submit); await flush(); h.calls.at(-1).ok(cartData); await flush(); h.calls.at(-1).fail(409, 10007); await rejected;
  assert.equal(h.orders.draft.state, 'rejected');
  const recheck = h.orders.reconfirm(); await flush(); h.calls.at(-1).ok(cartData); await recheck;
  assert.equal(h.orders.draft, null);
  const before = h.calls.length; h.local.storage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(h.orders.submit(fields), /保存失败/); assert.equal(h.calls.length, before);
});

test('late A order response after B login cannot populate B detail or clear A persistent draft', async (t) => {
  const h = harness(t); await h.ready();
  const submit = h.orders.submit(fields); const rejected = assert.rejects(submit); await flush(); h.calls.at(-1).ok(cartData); await flush();
  const old = h.calls.at(-1); const body = JSON.parse(old.config.data);
  h.login(8);
  old.ok({ order: orderData(), request_id: body.request_id, cart: emptyCart }); await rejected;
  assert.equal(h.orders.detail, null); assert.equal(h.orders.draft, null); assert.equal(h.orders.checkoutLoading, false);
  assert.equal(h.checkoutStorage.read(7).payload.request_id, body.request_id); assert.equal(h.checkoutStorage.read(8), null);
});

test('latest detail/list request wins and old actions cannot overwrite another order page', async (t) => {
  const h = harness(t);
  const a = h.orders.loadDetail(1); const b = h.orders.loadDetail(2); await flush();
  h.calls[1].ok(orderData(2)); await b; h.calls[0].ok(orderData(1)); await a; assert.equal(h.orders.detail.id, 2);
  const pay = h.orders.action('pay'); await flush(); const other = h.orders.loadDetail(3); await flush();
  h.calls.at(-1).ok(orderData(3)); await other; h.calls[2].ok(orderData(2, 'paid')); await pay; assert.equal(h.orders.detail.id, 3);
  const oldList = h.orders.loadList({ page: 1 }); const newList = h.orders.loadList({ page: 2 }); await flush();
  h.calls.at(-1).ok({ items: [{ id: 2 }], total: 2 }); await newList;
  h.calls.at(-2).ok({ items: [{ id: 1 }], total: 2 }); await oldList; assert.equal(h.orders.items[0].id, 2);
});

test('payment error keeps server-confirmed state and requires a fresh status read', async (t) => {
  const h = harness(t); const load = h.orders.loadDetail(1); await flush(); h.calls[0].ok(orderData()); await load;
  const pay = h.orders.action('pay'); const rejected = assert.rejects(pay); await flush(); h.calls[1].fail(); await rejected;
  assert.equal(h.orders.detail.status, 'pending'); assert.match(h.orders.detailError, /刷新/);
  const refresh = h.orders.loadDetail(1); await flush(); h.calls[2].ok(orderData(1, 'paid')); await refresh;
  assert.equal(h.orders.detail.status, 'paid'); assert.equal(h.orders.detailError, '');
});

test('cleanup failure still returns the confirmed order and preserves a recoverable record', async (t) => {
  const h = harness(t); await h.ready(); const submit = h.orders.submit(fields); await flush(); h.calls.at(-1).ok(cartData); await flush();
  const body = JSON.parse(h.calls.at(-1).config.data); h.local.storage.removeItem = () => { throw new Error('quota'); };
  h.calls.at(-1).ok({ order: orderData(), request_id: body.request_id, cart: emptyCart });
  assert.equal((await submit).id, 1); assert.ok(h.checkoutStorage.read(7)); assert.match(h.orders.checkoutNotice, /清理待重试/);
});

test('queued checkout initialization cannot load A private draft after switching to B', async (t) => {
  const h = harness(t);
  await h.checkoutStorage.prepare(7, { ...fields, items: [{ cart_item_id: 4, equipment_id: 11, quantity: 2, expected_price: 100 }] }, () => true);
  const loading = h.orders.loadCheckout(); const rejected = assert.rejects(loading); h.login(8); await rejected;
  assert.equal(h.orders.draft, null); assert.equal(h.orders.checkoutError, '');
});

test('retrying a rejected order marks it pending again before sending; a lost retry cannot be discarded', async (t) => {
  const h = harness(t); await h.ready();
  const first = h.orders.submit(fields); const failed = assert.rejects(first); await flush(); h.calls.at(-1).ok(cartData); await flush(); h.calls.at(-1).fail(409, 10005); await failed;
  assert.equal(h.orders.draft.state, 'rejected');
  const retry = h.orders.submit(fields); const unknown = assert.rejects(retry); await flush(); h.calls.at(-1).ok(cartData); await flush();
  assert.equal(h.checkoutStorage.read(7).state, 'pending'); h.calls.at(-1).fail(); await unknown;
  assert.equal(h.orders.draft.state, 'pending'); await assert.rejects(h.orders.reconfirm(), /尚未确认/);
});

test('history exposes recovery for a persisted checkout, isolates owners, and tolerates a damaged record', async (t) => {
  const h = harness(t);
  await h.checkoutStorage.prepare(7, { ...fields, items: [{ cart_item_id: 4, equipment_id: 11, quantity: 2, expected_price: 100 }] }, () => true);
  const first = h.orders.loadList({ page: 1 }); await flush();
  h.calls.at(-1).ok({ items: [], total: 0 }); await first;
  assert.equal(h.orders.checkoutRecoveryAvailable, true);
  h.login(8); assert.equal(h.orders.checkoutRecoveryAvailable, false);
  const second = h.orders.loadList({ page: 1 }); await flush();
  h.calls.at(-1).ok({ items: [], total: 0 }); await second;
  assert.equal(h.orders.checkoutRecoveryAvailable, false);
  h.local.storage.setItem('game_store.checkout.8.v1', '{broken');
  const damaged = h.orders.loadList({ page: 1 }); await flush();
  h.calls.at(-1).ok({ items: [{ id: 2 }], total: 1 }); await damaged;
  assert.equal(h.orders.checkoutRecoveryAvailable, true); assert.equal(h.orders.items[0].id, 2);
  assert.equal(h.local.storage.getItem('game_store.checkout.8.v1'), '{broken');
});
