import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { mountPage, flushPage } from './helpers/vue-page.js';
import { equipmentImageSource, EQUIPMENT_PLACEHOLDER } from '../src/utils/equipment-image.js';

async function setup(t) {
  const session = reactive({ status: 'authenticated', token: 'a', revision: 1, isAuthenticated: true, user: { role: 'admin' }, isCurrentSession(token, revision) { return token === this.token && revision === this.revision; } });
  const calls = [], changed = [], busy = [];
  const page = await mountPage(new URL('../src/components/admin/EquipmentImageUpload.vue', import.meta.url), {
    '../EquipmentImage.vue': { default: { template: '<span />' } },
    '../../stores/auth.js': { useAuthStore: () => session },
    '../../api/admin/equipments.js': { uploadAdminEquipmentImage: (file, config) => new Promise((resolve, reject) => calls.push({ file, config, resolve, reject })) },
  }, { modelValue: EQUIPMENT_PLACEHOLDER, 'onUpdate:modelValue': value => changed.push(value), onBusy: value => busy.push(value) });
  t.after(page.unmount);
  return { ...page, calls, changed, busy, session };
}
const event = (type = 'image/png', size = 100) => ({ target: { files: [{ type, size }], value: 'chosen' } });
const uploaded = '/api/uploads/equipments/' + 'a'.repeat(64) + '.webp';

test('upload validates files, blocks duplicate selection, emits URL only after success and permits selecting the same file again', async (t) => {
  const page = await setup(t);
  await page.state.choose(event('image/svg+xml')); await page.state.choose(event('image/png', 6 * 1024 * 1024));
  assert.equal(page.calls.length, 0);
  const selection = event(); const uploading = page.state.choose(selection);
  assert.equal(selection.target.value, ''); assert.equal(page.state.uploading, true);
  await page.state.choose(event()); assert.equal(page.calls.length, 1);
  assert.deepEqual(page.changed, []);
  page.calls[0].resolve({ image: uploaded }); await uploading;
  assert.deepEqual(page.changed, [uploaded]); assert.deepEqual(page.busy, [true, false]);
  assert.match(page.state.message, /上传成功/);
});

test('failed uploads retain the original picture and can retry', async (t) => {
  const page = await setup(t);
  const upload = page.state.choose(event()); page.calls[0].reject(new Error('offline')); await upload;
  assert.deepEqual(page.changed, []); assert.equal(page.state.uploading, false);
  const retry = page.state.choose(event()); page.calls[1].resolve({ image: uploaded }); await retry;
  assert.deepEqual(page.changed, [uploaded]);
});

test('session changes and unmount prevent late uploads from updating another form', async (t) => {
  const page = await setup(t);
  const upload = page.state.choose(event()); page.session.revision++; await flushPage();
  assert.equal(page.calls[0].config.signal.aborted, true);
  page.calls[0].resolve({ image: uploaded }); await upload; assert.deepEqual(page.changed, []);
  const second = page.state.choose(event()); page.unmount(); page.calls[1].resolve({ image: uploaded }); await second;
  assert.deepEqual(page.changed, []);
});

test('all equipment displays accept only the exact uploaded image URL shape', () => {
  assert.equal(equipmentImageSource(uploaded), uploaded);
  for (const value of [uploaded + '?x=1', '/api/uploads/equipments/evil.svg', '/api/uploads/equipments/../secret.webp', 'https://evil.test' + uploaded]) assert.equal(equipmentImageSource(value), EQUIPMENT_PLACEHOLDER);
});
