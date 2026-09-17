import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { flushPage, mountPage } from './helpers/vue-page.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const httpError = (status) => ({ response: { status, data: { message: '状态已改变' } } });
const cases = [
  { page: 'UserDetail', entity: 'user', api: 'users', get: 'getAdminUser', write: 'updateAdminUserStatus', action: 'changeStatus', busy: 'acting', error: 'actionError', initial: 'active', final: 'frozen', button: '冻结账号' },
  { page: 'OrderDetail', entity: 'order', api: 'orders', get: 'getAdminOrder', write: 'updateAdminOrderStatus', action: 'changeStatus', busy: 'acting', error: 'actionError', initial: 'pending', final: 'cancelled', button: '取消订单', confirm: '确认取消' },
  { page: 'EquipmentDetail', entity: 'equipment', api: 'equipments', get: 'getAdminEquipment', write: 'removeAdminEquipment', action: 'removeEquipment', busy: 'deleting', error: 'deleteError', initial: 'on_sale', final: 'deleted', button: '删除装备', confirm: '确认删除' },
];
const fixture = (entry, id = 2, status = entry.initial) => ({
  id, status, role: 'user', username: `player_${id}`, email: `player${id}@example.test`,
  name: `装备 ${id}`, price: '10.00', stock: 3, items: [], total: '10.00', actual_total: '10.00',
});

async function setup(t, entry) {
  const route = reactive({ params: { id: '2' }, query: {} });
  const auth = reactive({
    token: 'admin-a', revision: 1, isAuthenticated: true, user: { id: 1, role: 'admin' },
    isCurrentSession(token, revision) { return this.token === token && this.revision === revision; },
  });
  const reads = [], writes = [];
  const api = {
    [entry.get](id, config) { const task = deferred(); reads.push({ id, config, ...task }); return task.promise; },
    [entry.write](id, ...args) { const task = deferred(); writes.push({ id, body: args.length === 2 ? args[0] : undefined, config: args.at(-1), ...task }); return task.promise; },
  };
  const page = await mountPage(new URL(`../src/views/admin/${entry.page}.vue`, import.meta.url), {
    'vue-router': { useRoute: () => route },
    '../../stores/auth.js': { useAuthStore: () => auth },
    [`../../api/admin/${entry.api}.js`]: api,
    '../../components/admin/UserCharacters.vue': { default: { render: () => null } },
    '../../components/EquipmentImage.vue': { default: { render: () => null } },
  });
  let mounted = true;
  const unmount = () => { if (mounted) { page.unmount(); mounted = false; } };
  t.after(unmount);
  reads[0].resolve(fixture(entry));
  await flushPage();
  async function click(label) {
    const button = page.button(label);
    assert.ok(button, `button exists: ${label}`);
    assert.ok(!button.props.disabled, `button enabled: ${label}`);
    const result = button.props.onClick();
    await flushPage();
    return { result };
  }
  async function act() {
    await click(entry.button);
    if (entry.confirm) await click(entry.confirm);
  }
  async function navigate(id) { route.params.id = id; await flushPage(); }
  return { ...page, route, auth, reads, writes, click, act, navigate, unmount };
}

for (const entry of cases) {
  test(`${entry.page}: real buttons accept numeric API IDs, send once and display the result`, async (t) => {
    const page = await setup(t, entry);
    await page.act();
    assert.equal(page.writes.length, 1);
    assert.equal(page.writes[0].id, 2);
    if (entry.entity !== 'equipment') assert.deepEqual(page.writes[0].body, { status: entry.final });
    assert.equal(page.writes[0].config.sessionGuard(), true);
    assert.equal(page.state[entry.busy], true);
    await page.state[entry.action](entry.final);
    assert.equal(page.writes.length, 1, 'duplicate clicks cannot send a second request');
    page.writes[0].resolve(fixture(entry, 2, entry.final));
    await flushPage();
    assert.equal(page.state[entry.entity].status, entry.final);
    assert.equal(page.state[entry.busy], false);
    assert.equal(page.state.uncertain, false);
  });

  test(`${entry.page}: late writes cannot overwrite a new page or clear its busy state`, async (t) => {
    const page = await setup(t, entry);
    await page.act();
    const old = page.writes[0];
    await page.navigate('3');
    assert.equal(old.config.signal.aborted, true);
    assert.equal(old.config.sessionGuard(), false);
    assert.equal(page.state[entry.busy], false);
    page.reads[1].resolve(fixture(entry, 3));
    await flushPage();
    await page.act();
    old.resolve(fixture(entry, 2, entry.final));
    await flushPage();
    assert.equal(page.state[entry.entity].id, 3);
    assert.equal(page.state[entry.busy], true, 'old finalizer must not finish the new write');
    page.writes[1].resolve(fixture(entry, 3, entry.final));
    await flushPage();
    assert.equal(page.state[entry.busy], false);
  });

  test(`${entry.page}: leaving and returning to the same ID invalidates old reads and writes`, async (t) => {
    const page = await setup(t, entry);
    await page.act();
    const old = page.writes[0];
    await page.navigate('3');
    const oldRead = page.reads[1];
    await page.navigate('2');
    assert.equal(old.config.sessionGuard(), false);
    assert.equal(oldRead.config.sessionGuard(), false);
    page.reads[2].resolve(fixture(entry));
    await flushPage();
    oldRead.resolve(fixture(entry, 3));
    old.reject(httpError(503));
    await flushPage();
    assert.equal(page.state[entry.entity].id, 2);
    assert.equal(page.state[entry.entity].status, entry.initial);
    assert.equal(page.state.uncertain, false);
    assert.equal(page.state[entry.error], '');
    assert.equal(page.state[entry.busy], false);
  });

  for (const failure of ['network', 500, 502, 503, 504]) {
    test(`${entry.page}: ${failure} blocks another write until a successful state refresh`, async (t) => {
      const page = await setup(t, entry);
      await page.act();
      page.writes[0].reject(failure === 'network' ? new Error('offline') : httpError(failure));
      await flushPage();
      assert.equal(page.state.uncertain, true);
      assert.match(page.text(), /操作结果待确认/);
      await page.state[entry.action](entry.final);
      assert.equal(page.writes.length, 1);
      await page.click('重新获取最新状态');
      page.reads[1].reject(new Error('still offline'));
      await flushPage();
      assert.equal(page.state.uncertain, true, 'failed reads cannot unlock another write');
      await page.state[entry.action](entry.final);
      assert.equal(page.writes.length, 1);
      await page.click('重新加载');
      page.reads[2].resolve(fixture(entry, 2, entry.final));
      await flushPage();
      assert.equal(page.state.uncertain, false);
      assert.equal(page.state[entry.entity].status, entry.final);
      assert.doesNotMatch(page.text(), /操作结果待确认/);
    });
  }

  test(`${entry.page}: business conflicts offer a refresh and use the latest server state`, async (t) => {
    const page = await setup(t, entry);
    await page.act();
    page.writes[0].reject(httpError(409));
    await flushPage();
    assert.equal(page.state.uncertain, false);
    assert.equal(page.state.needsReload, true);
    assert.match(page.text(), /状态已改变/);
    await page.state[entry.action](entry.final);
    assert.equal(page.writes.length, 1);
    await page.click('重新获取最新状态');
    page.reads[1].resolve(fixture(entry, 2, entry.final));
    await flushPage();
    assert.equal(page.state.needsReload, false);
    assert.equal(page.state[entry.entity].status, entry.final);
  });

  test(`${entry.page}: unmount and account changes prevent late mutation results`, async (t) => {
    for (const change of ['unmount', 'account']) {
      const page = await setup(t, entry);
      await page.act();
      if (change === 'unmount') page.unmount();
      else { page.auth.token = 'admin-b'; page.auth.revision++; }
      assert.equal(page.writes[0].config.sessionGuard(), false);
      if (change === 'unmount') assert.equal(page.writes[0].config.signal.aborted, true);
      page.writes[0].resolve(fixture(entry, 2, entry.final));
      await flushPage();
      assert.equal(page.state[entry.entity].status, entry.initial);
      await page.state[entry.action](entry.final);
      assert.equal(page.writes.length, 1);
    }
  });
}

test('user freeze can be reversed and paid orders can complete through their real buttons', async (t) => {
  const user = await setup(t, cases[0]);
  user.state.user.status = 'frozen';
  await flushPage();
  await user.click('恢复账号');
  assert.deepEqual(user.writes[0].body, { status: 'active' });
  user.writes[0].resolve(fixture(cases[0]));
  const order = await setup(t, cases[1]);
  order.state.order.status = 'paid';
  await flushPage();
  await order.click('确认交付');
  await order.click('确认完成');
  assert.deepEqual(order.writes[0].body, { status: 'completed' });
  order.writes[0].resolve(fixture(cases[1], 2, 'completed'));
  await flushPage();
  assert.equal(user.state.user.status, 'active');
  assert.equal(order.state.order.status, 'completed');
});
