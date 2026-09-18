import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import * as Vue from 'vue';
import { mountPage, flushPage } from './helpers/vue-page.js';

const servers = [{ value: 'star_1', label: '星海一区' }, { value: 'dusk_2', label: '暮光二区' }];
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function checkoutOrders() {
  return reactive({
    canUse: true,
    checkoutLoading: false,
    checkoutError: '',
    checkoutNotice: '',
    draft: null,
    confirmation: [{ id: 1, equipment_id: 1, price: 100, quantity: 1 }],
    character: null,
    characterLoading: false,
    characterError: '',
    loadCheckout: async () => {},
    clearCharacter: () => {},
    loadCharacter: async () => {},
    submit: async () => ({ id: 1 }),
    recover: async () => {},
    reconfirm: async () => {},
  });
}

function auth() {
  return reactive({
    token: 'a', revision: 1, status: 'authenticated', isAuthenticated: true, user: { id: 1, role: 'user' },
    isCurrentSession(token, revision) { return this.token === token && this.revision === revision; },
  });
}

function catalog() {
  return reactive({ loaded: true, meta: { servers }, load: async () => {} });
}

async function checkoutPage({ orders, session, meta }) {
  return mountPage(new URL('../src/views/Checkout.vue', import.meta.url), {
    vue: { ...Vue, vModelText: {}, vModelSelect: {} },
    'vue-router': { useRouter: () => ({ replace: async () => {}, push: async () => {} }) },
    '../stores/auth.js': { useAuthStore: () => session },
    '../stores/orders.js': { useOrdersStore: () => orders },
    '../stores/catalog.js': { useCatalogStore: () => meta },
    '../components/SessionRecovery.vue': { default: { render: () => null } },
    '../components/OrderItems.vue': { default: { render: () => null } },
    '../utils/orders.js': { checkoutErrors: () => ({}) },
    '../utils/format.js': { formatMoney: (cents) => `¥${cents / 100}` },
    '../utils/auth.js': { fieldErrorsFrom: () => ({}) },
  });
}

test('checkout empty role offers refresh and recovers after a re-query', async (t) => {
  const session = auth();
  const meta = catalog();
  const orders = checkoutOrders();
  const calls = [];
  const tasks = [];
  orders.loadCharacter = (server) => {
    calls.push(server);
    const task = deferred();
    tasks.push(task);
    orders.characterLoading = true;
    orders.characterError = '';
    task.promise.then(
      (result) => { orders.character = result.character; },
      () => { orders.characterError = '角色查询失败'; },
    ).finally(() => { orders.characterLoading = false; });
    return task.promise;
  };

  const page = await checkoutPage({ orders, session, meta });
  t.after(page.unmount);

  page.state.form.server = 'star_1';
  await flushPage();
  assert.equal(calls.length, 1);
  tasks[0].resolve({ character: null });
  await tasks[0].promise;
  await flushPage();
  assert.match(page.text(), /暂无可用角色/);
  assert.ok(page.button('刷新角色'));

  page.button('刷新角色').props.onClick();
  await flushPage();
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'star_1');
  assert.equal(page.button('刷新角色'), undefined);
  assert.match(page.text(), /正在查询游戏角色/);

  tasks[1].resolve({ character: { id: 9, server: 'star_1', character_name: '星海先锋' } });
  await tasks[1].promise;
  await flushPage();
  assert.match(page.text(), /星海先锋/);
  assert.equal(page.button('刷新角色'), undefined);
});

test('checkout refresh keeps the empty state when the server still has no role', async (t) => {
  const session = auth();
  const meta = catalog();
  const orders = checkoutOrders();
  const tasks = [];
  orders.loadCharacter = (server) => {
    const task = deferred();
    tasks.push(task);
    orders.characterLoading = true;
    task.promise.then((result) => { orders.character = result.character; }).finally(() => { orders.characterLoading = false; });
    return task.promise;
  };

  const page = await checkoutPage({ orders, session, meta });
  t.after(page.unmount);
  page.state.form.server = 'star_1';
  await flushPage();
  tasks[0].resolve({ character: null });
  await tasks[0].promise;
  await flushPage();

  page.button('刷新角色').props.onClick();
  await flushPage();
  tasks[1].resolve({ character: null });
  await tasks[1].promise;
  await flushPage();
  assert.match(page.text(), /暂无可用角色/);
  assert.ok(page.button('刷新角色'));
  assert.equal(orders.characterError, '');
});

test('checkout refresh shows the existing error state after a failed request', async (t) => {
  const session = auth();
  const meta = catalog();
  const orders = checkoutOrders();
  const tasks = [];
  orders.loadCharacter = (server) => {
    const task = deferred();
    tasks.push(task);
    orders.characterLoading = true;
    orders.characterError = '';
    task.promise.catch(() => { orders.characterError = '角色查询失败'; }).finally(() => { orders.characterLoading = false; });
    return task.promise;
  };

  const page = await checkoutPage({ orders, session, meta });
  t.after(page.unmount);
  page.state.form.server = 'star_1';
  await flushPage();
  tasks[0].resolve({ character: null });
  await tasks[0].promise;
  await flushPage();

  page.button('刷新角色').props.onClick();
  await flushPage();
  tasks[1].reject(new Error('network'));
  await tasks[1].promise.catch(() => {});
  await flushPage();
  assert.match(page.text(), /角色查询失败/);
  assert.ok(page.button('重新查询角色'));
});
