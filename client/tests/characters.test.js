import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import * as Vue from 'vue';
import { mountPage, flushPage } from './helpers/vue-page.js';
const servers = [{ value: 'star_1', label: '星海一区' }, { value: 'dusk_2', label: '暮光二区' }];
const data = (name = '') => ({ servers, items: name ? [{ id: 9, server: 'star_1', character_name: name }] : [] });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function auth(role = 'admin') { return reactive({ token: 'a', revision: 1, status: 'authenticated', isAuthenticated: true, user: { id: 1, role }, isCurrentSession(token, revision) { return this.token === token && this.revision === revision; } }); }
async function adminPage(t) {
  const session = auth(), reads = [], writes = [];
  const page = await mountPage(new URL('../src/components/admin/UserCharacters.vue', import.meta.url), {
    // Native input directives need a DOM; state, lifecycle and save handlers remain real.
    vue: { ...Vue, vModelText: {}, vModelSelect: {} },
    '../../stores/auth.js': { useAuthStore: () => session },
    '../../api/admin/users.js': {
      getAdminUserCharacters: (id, config) => { const task = deferred(); reads.push({ id, config, ...task }); return task.promise; },
      saveAdminUserCharacter: (id, server, body, config) => { const task = deferred(); writes.push({ id, server, body, config, ...task }); return task.promise; },
    },
  }, { userId: 2 });
  t.after(page.unmount);
  reads[0].resolve(data()); await flushPage();
  return { ...page, session, reads, writes };
}

test('admin character form assigns a server role, prevents duplicate submits and carries expected old name on rename', async (t) => {
  const page = await adminPage(t);
  assert.match(page.text(), /尚未配置/);
  page.state.form.name = '星海先锋';
  const saved = page.state.save(); await page.state.save();
  assert.equal(page.writes.length, 1);
  assert.deepEqual(page.writes[0].body, { character_name: '星海先锋', expected_name: null });
  page.writes[0].resolve(data('星海先锋')); await saved; await flushPage();
  assert.match(page.text(), /角色已保存/);
  page.state.form.name = '新的角色';
  const rename = page.state.save();
  assert.deepEqual(page.writes[1].body, { character_name: '新的角色', expected_name: '星海先锋' });
  page.writes[1].resolve(data('新的角色')); await rename;
  page.state.form.server = 'dusk_2'; await flushPage();
  assert.equal(page.state.form.name, '');
  page.state.form.name = '一'; await page.state.save();
  assert.equal(page.writes.length, 2);
  assert.match(page.state.error, /2–10/);
});

for (const status of [409, 503]) {
  test(`character ${status} prevents blind retries, failed reload remains blocked and successful reload reconciles`, async (t) => {
    const page = await adminPage(t);
    page.state.form.name = '角色甲'; const saving = page.state.save();
    page.writes[0].reject({ response: { status } }); await saving;
    assert.equal(page.state.needsReload, true);
    await page.state.save(); assert.equal(page.writes.length, 1);
    const failed = page.state.load(); page.reads[1].reject(new Error('offline')); await failed;
    assert.equal(page.state.needsReload, true);
    const loaded = page.state.load(); page.reads[2].resolve(data('角色甲')); await loaded;
    assert.equal(page.state.needsReload, false);
    assert.equal(page.state.form.name, '角色甲');
  });
}

test('character writes and reads from a previous admin session never replace the new session data', async (t) => {
  const page = await adminPage(t);
  page.state.form.name = '旧角色'; const saving = page.state.save();
  page.session.token = 'b'; page.session.revision++;
  assert.equal(page.writes[0].config.signal.aborted, true);
  assert.equal(page.writes[0].config.sessionGuard(), false);
  page.reads[1].resolve(data('最新角色')); await flushPage();
  page.writes[0].resolve(data('旧角色')); await saving;
  assert.equal(page.state.form.name, '最新角色');
  assert.equal(page.state.saving, false);
});

test('personal characters are read-only, explain missing roles, and discard results after account changes', async (t) => {
  const session = auth('user'), reads = [];
  const page = await mountPage(new URL('../src/components/MyCharacters.vue', import.meta.url), {
    '../stores/auth.js': { useAuthStore: () => session },
    '../api/auth.js': { getMyCharacters: (config) => { const task = deferred(); reads.push({ config, ...task }); return task.promise; } },
  });
  t.after(page.unmount);
  session.token = 'b'; session.revision++;
  reads[1].resolve(data()); await flushPage();
  reads[0].resolve(data('另一账号角色')); await flushPage();
  assert.match(page.text(), /暂无角色/);
  assert.match(page.text(), /联系管理员/);
  assert.doesNotMatch(page.text(), /另一账号角色/);
  const refresh = page.button('刷新角色').props.onClick();
  reads[2].resolve(data('已分配角色')); await refresh; await flushPage();
  assert.match(page.text(), /已分配角色/);
  assert.equal(page.button('保存角色名'), undefined);
});
