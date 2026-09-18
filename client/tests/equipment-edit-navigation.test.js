import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { createMemoryHistory, createRouter, isNavigationFailure } from 'vue-router';
import { mountPage, flushPage } from './helpers/vue-page.js';

async function setup(t) {
  const empty = { render: () => null };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/equipments', component: empty },
    { path: '/admin/equipments/:id', component: empty },
  ] });
  const auth = reactive({ token: 'fixture', revision: 1, isAuthenticated: true, user: { id: 1, role: 'admin' }, isCurrentSession: () => true });
  const reads = [], writes = [], confirmations = [];
  let allowLeave = false;
  const page = await mountPage(new URL('../src/views/admin/EquipmentEdit.vue', import.meta.url), {
    '../../stores/auth.js': { useAuthStore: () => auth },
    '../../components/admin/EquipmentFields.vue': { default: empty },
    '../../utils/admin/equipment-confirm.js': { confirmEquipmentLeave: async () => { confirmations.push(true); return allowLeave; } },
    '../../api/admin/equipments.js': {
      getAdminEquipment: async (id) => {
        reads.push(id);
        return { id: Number(id), name: `装备 ${id}`, price: 100, rarity: 'R', category: 'weapon', image: '/images/equipments/placeholder.svg', attack: 0, defense: 0, stock: 1, status: 'on_sale', edit_version: 1 };
      },
      updateAdminEquipment: async (id, body) => { writes.push({ id, body }); },
    },
  }, {}, { router, routePath: '/admin/equipments/:id/edit', initialPath: '/admin/equipments/1/edit' });
  t.after(page.unmount);
  await flushPage();
  function historyMove(direction) {
    return new Promise((resolve) => {
      const stop = router.afterEach((_to, _from, failure) => { stop(); resolve(failure); });
      router[direction]();
    });
  }
  return { page, router, reads, writes, confirmations, historyMove, allow: (value) => { allowLeave = value; } };
}

test('changing equipment with dirty fields can be cancelled without losing edits or reloading', async (t) => {
  const { page, router, reads, confirmations } = await setup(t);
  page.state.form.name = '未保存的装备名称';
  const result = await router.push('/admin/equipments/2/edit');
  await flushPage();
  assert.ok(isNavigationFailure(result));
  assert.equal(router.currentRoute.value.params.id, '1');
  assert.equal(page.state.form.name, '未保存的装备名称');
  assert.equal(page.state.dirty, true);
  assert.deepEqual(reads, ['1']);
  assert.equal(confirmations.length, 1);
});

test('confirmed equipment changes load the new form and reset its baseline', async (t) => {
  const { page, router, reads, confirmations, allow } = await setup(t);
  page.state.form.name = '未保存';
  allow(true);
  await router.push('/admin/equipments/2/edit');
  await flushPage();
  assert.equal(page.state.form.name, '装备 2');
  assert.equal(page.state.dirty, false);
  assert.deepEqual(reads, ['1', '2']);
  assert.equal(confirmations.length, 1);
  await router.push('/admin/equipments/3/edit');
  await flushPage();
  assert.equal(page.state.form.name, '装备 3');
  assert.equal(confirmations.length, 1, 'clean forms navigate without confirmation');
});

test('a query-only navigation keeps the form and does not ask to discard it', async (t) => {
  const { page, router, reads, confirmations } = await setup(t);
  page.state.form.name = '继续编辑';
  await router.push('/admin/equipments/1/edit?returnTo=/admin/equipments?page=2');
  await flushPage();
  assert.equal(page.state.form.name, '继续编辑');
  assert.equal(page.state.dirty, true);
  assert.deepEqual(reads, ['1']);
  assert.equal(confirmations.length, 0);
});

test('back and forward between equipment edit pages respect cancel and confirm', async (t) => {
  const { page, router, reads, confirmations, historyMove, allow } = await setup(t);
  await router.push('/admin/equipments/2/edit');
  await flushPage();
  page.state.form.name = '装备 2 的未保存修改';
  assert.ok(isNavigationFailure(await historyMove('back')));
  await flushPage();
  assert.equal(router.currentRoute.value.params.id, '2');
  assert.equal(page.state.form.name, '装备 2 的未保存修改');
  assert.deepEqual(reads, ['1', '2']);

  allow(true);
  await historyMove('back');
  await flushPage();
  assert.equal(page.state.form.name, '装备 1');
  page.state.form.name = '装备 1 的未保存修改';
  allow(false);
  assert.ok(isNavigationFailure(await historyMove('forward')));
  await flushPage();
  assert.equal(page.state.form.name, '装备 1 的未保存修改');
  allow(true);
  await historyMove('forward');
  await flushPage();
  assert.equal(page.state.form.name, '装备 2');
  assert.equal(page.state.dirty, false);
  assert.equal(confirmations.length, 4);
});

test('leaving the editor still asks before discarding changes', async (t) => {
  const { page, router, confirmations, allow } = await setup(t);
  page.state.form.name = '未保存';
  assert.ok(isNavigationFailure(await router.push('/admin/equipments')));
  assert.equal(page.state.form.name, '未保存');
  allow(true);
  await router.push('/admin/equipments');
  assert.equal(router.currentRoute.value.path, '/admin/equipments');
  assert.equal(confirmations.length, 2);
});

test('successful save returns to the detail without an unsaved warning', async (t) => {
  const { page, router, writes, confirmations } = await setup(t);
  page.state.form.name = '已保存的名称';
  await page.state.submit();
  await flushPage();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.name, '已保存的名称');
  assert.equal(router.currentRoute.value.path, '/admin/equipments/1');
  assert.equal(confirmations.length, 0);
});
