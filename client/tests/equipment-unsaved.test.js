import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, reactive } from 'vue';
import { createBeforeUnloadHandler, useEquipmentUnsavedGuard } from '../src/utils/admin/equipment-unsaved.js';

function windowMock() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
  };
}

test('beforeunload handler blocks only when dirty and always sets returnValue', () => {
  const dirty = createBeforeUnloadHandler(() => true);
  const clean = createBeforeUnloadHandler(() => false);
  const event = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  dirty(event);
  assert.equal(event.prevented, true);
  assert.equal(event.returnValue, '');

  const cleanEvent = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  clean(cleanEvent);
  assert.equal(cleanEvent.prevented, false);
  assert.equal(cleanEvent.returnValue, undefined);
});

test('unsaved guard tracks dirty, registers beforeunload and cleans up on dispose', () => {
  const window = windowMock();
  const form = reactive({ name: '长剑', price: '19.90', rarity: 'R', category: 'weapon', image: '/a.webp', attack: '0', defense: '0', stock: '12', status: 'off_sale', description: '', series_code: '', new_until: '' });
  const scope = effectScope();
  const guard = scope.run(() => useEquipmentUnsavedGuard(form, { window }));
  assert.equal(guard.dirty.value, false);
  guard.markBaseline();
  assert.equal(guard.dirty.value, false);
  form.name = '改过';
  assert.equal(guard.dirty.value, true);
  assert.equal(window.listeners.has('beforeunload'), true);

  form.name = '长剑';
  assert.equal(guard.dirty.value, false);
  assert.equal(window.listeners.has('beforeunload'), false);

  form.image = '/api/uploads/equipments/' + 'a'.repeat(64) + '.webp';
  assert.equal(guard.dirty.value, true);
  guard.markSaved();
  assert.equal(guard.dirty.value, false);

  form.name = '再次修改';
  assert.equal(window.listeners.has('beforeunload'), true);
  scope.stop();
  assert.equal(window.listeners.has('beforeunload'), false);
});

test('a missing window never crashes the guard', () => {
  const form = reactive({ name: '', price: '', rarity: 'N', category: 'weapon', image: '/placeholder.svg', attack: '0', defense: '0', stock: '0', status: 'off_sale', description: '', series_code: '', new_until: '' });
  const scope = effectScope();
  const guard = scope.run(() => useEquipmentUnsavedGuard(form, { window: undefined }));
  guard.markBaseline();
  form.name = 'x';
  assert.equal(guard.dirty.value, true);
  scope.stop();
});
