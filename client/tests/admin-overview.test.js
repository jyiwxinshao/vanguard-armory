import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { mountPage, flushPage } from './helpers/vue-page.js';
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const summary = { pending_orders: 2, awaiting_delivery_orders: 1, paid_amount: 12345, low_stock_count: 3, low_stock_threshold: 5, updated_at: '2026-09-18T00:00:00Z' };
test('overview supports loading, failure recovery and session isolation without showing stale counts', async (t) => {
  const auth = reactive({ token: 'a', revision: 1, status: 'authenticated', user: { role: 'admin' }, isAuthenticated: true, isCurrentSession(token, revision) { return this.token === token && this.revision === revision; } });
  const calls = [];
  const page = await mountPage(new URL('../src/views/admin/Overview.vue', import.meta.url), {
    '../../stores/auth.js': { useAuthStore: () => auth },
    '../../api/admin/overview.js': { getAdminOverview: (config) => { const task = deferred(); calls.push({ ...task, config }); return task.promise; } },
  });
  t.after(page.unmount);
  calls[0].resolve(summary); await flushPage();
  assert.match(page.text(), /123\.45/);
  assert.match(page.text(), /在售库存 ≤ 5 件/);
  const refresh = page.button('刷新概览').props.onClick();
  calls[1].reject(new Error('offline')); await refresh; await flushPage();
  assert.match(page.text(), /无法连接商城/);
  assert.doesNotMatch(page.text(), /123\.45/);
  const retry = page.state.load();
  auth.token = 'b'; auth.revision++;
  assert.equal(calls[2].config.sessionGuard(), false);
  calls[3].resolve({ ...summary, paid_amount: 200 }); await flushPage();
  calls[2].resolve(summary); await retry; await flushPage();
  assert.match(page.text(), /2\.00/);
  assert.doesNotMatch(page.text(), /123\.45/);
});
