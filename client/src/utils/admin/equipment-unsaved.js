import { computed, onScopeDispose, ref, watch } from 'vue';
import { equipmentFormDirty, equipmentFormSnapshot } from './equipment-form.js';

export function createBeforeUnloadHandler(isDirty) {
  return (event) => {
    if (!isDirty()) return;
    event.preventDefault?.();
    event.returnValue = '';
  };
}

export function useEquipmentUnsavedGuard(form, { window = globalThis.window } = {}) {
  const baseline = ref(null);
  const dirty = computed(() => baseline.value !== null && equipmentFormDirty(form, baseline.value));

  function markBaseline() { baseline.value = equipmentFormSnapshot(form); }
  function markSaved() { markBaseline(); }
  function clearBaseline() { baseline.value = null; }

  const beforeUnload = createBeforeUnloadHandler(() => dirty.value);
  const stop = window
    ? watch(dirty, (value) => {
        if (value) window.addEventListener('beforeunload', beforeUnload);
        else window.removeEventListener('beforeunload', beforeUnload);
      }, { immediate: true, flush: 'sync' })
    : undefined;

  onScopeDispose(() => {
    stop?.();
    window?.removeEventListener?.('beforeunload', beforeUnload);
  });

  return { dirty, markBaseline, markSaved, clearBaseline };
}
