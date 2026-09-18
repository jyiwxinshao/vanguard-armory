import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { mountPage, flushPage } from './helpers/vue-page.js';

test('order detail exposes refresh, blocks duplicate refreshes and displays delivery or cancellation', async (t) => {
  const calls = [];
  const orders = reactive({ canUse: true, detail: null, detailError: '', detailLoading: false, acting: false,
    async loadDetail(id) {
      this.detailLoading = true; this.detailError = ''; this.detail = null;
      try { this.detail = await new Promise((resolve, reject) => calls.push({ id, resolve, reject })); }
      catch (error) { this.detailError = error.message; throw error; }
      finally { this.detailLoading = false; }
    },
  });
  const page = await mountPage(new URL('../src/views/OrderDetail.vue', import.meta.url), {
    'vue-router': { useRoute: () => ({ params: { id: '2' } }) },
    '../stores/auth.js': { useAuthStore: () => ({ isAuthenticated: true, status: 'authenticated', user: { id: 1 } }) },
    '../stores/orders.js': { useOrdersStore: () => orders },
    '../stores/catalog.js': { useCatalogStore: () => ({ meta: { servers: [] }, load: async () => {} }) },
    '../components/SessionRecovery.vue': { default: { render: () => null } },
    '../components/OrderItems.vue': { default: { render: () => null } },
    '../utils/notify.js': { notify: { success() {}, error() {}, info() {}, warning() {} } },
  });
  t.after(page.unmount);
  const order = (status) => ({ id: 2, status, order_no: 'TEST', total: 100, actual_total: 100, discount: 0, items: [] });
  calls[0].resolve(order('paid')); await flushPage();
  assert.equal(page.state.progress[1].current, true);
  assert.ok(page.button('刷新进度'));
  const refresh = page.button('刷新进度').props.onClick(); await flushPage();
  assert.equal(page.button('正在刷新…').props.disabled, true);
  await page.state.refresh(); assert.equal(calls.length, 2);
  calls[1].resolve(order('completed')); await refresh; await flushPage();
  assert.equal(page.state.progress[2].current, true);
  assert.match(page.text(), /订单已完成/);
  orders.acting = true; await flushPage();
  assert.equal(page.button('刷新进度').props.disabled, true);
  await page.state.refresh(); assert.equal(calls.length, 2);
  orders.acting = false;
  const failed = page.state.refresh(); calls[2].reject(new Error('网络错误')); await failed; await flushPage();
  assert.match(page.text(), /网络错误/); assert.ok(page.button('刷新进度'));
  const retry = page.state.refresh(); calls[3].resolve(order('cancelled')); await retry; await flushPage();
  assert.deepEqual(page.state.progress.map(step => step.label), ['订单创建', '已取消']);
  assert.match(page.text(), /库存已返还/);
});
