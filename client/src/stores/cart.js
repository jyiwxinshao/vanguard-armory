import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { addCartItem, clearCart, deleteCartItem, deleteCartItems, getCart, mergeCart, updateCartItem } from '../api/cart.js';
import { createGuestCartStorage, validateEquipmentId, validateGuestQuantity } from '../utils/guest-cart-storage.js';

function message(error) {
  if (error.response?.status === 409 && error.response.data?.code === 10005) return `库存不足，当前库存 ${error.response.data?.data?.stock ?? '未知'} 件`;
  return error.response?.data?.message || error.message || '购物车操作未成功，请重试';
}
function assertCart(data) {
  if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total_price) || data.total_price < 0
    || data.items.some((item) => !Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.equipment_id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999 || typeof item.available !== 'boolean')) {
    throw new Error('购物车响应格式异常，本地数据已保留');
  }
}

export const useCartStore = defineStore('cart', () => {
  const items = ref([]);
  const totalPrice = ref(0);
  const loading = ref(false);
  const error = ref('');
  const notice = ref('');
  const adjustments = ref([]);
  const mode = ref('pending');
  const phase = ref('idle');
  const scope = ref(0);
  const itemCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));
  const availableTotal = computed(() => items.value.filter((item) => item.available).reduce((sum, item) => sum + item.subtotal, 0));
  const checkoutAllowed = computed(() => mode.value === 'server' && phase.value === 'ready' && !loading.value && items.value.length > 0 && items.value.every((item) => item.available));
  const canWrite = computed(() => phase.value === 'ready' && mode.value === 'server' && !loading.value);
  const canManage = computed(() => (canWrite.value || (phase.value === 'merge-rejected' && mode.value === 'server' && !loading.value)));
  let storage = createGuestCartStorage();
  let session = { kind: 'pending', current: () => false };
  let identity = '';
  let tail = Promise.resolve();
  let initializing = null;
  let waiting = 0;

  function configureStorage(value) { storage = value; }
  function context() {
    const revision = scope.value;
    const expected = session;
    const current = () => scope.value === revision && expected.current();
    const assert = () => { if (!current()) throw new Error('账号状态已变化，请重试'); };
    return { current, assert, userId: expected.userId, kind: expected.kind, config: { sessionGuard: current, headers: expected.token ? { Authorization: `Bearer ${expected.token}` } : {} } };
  }
  function applyCart(data) {
    assertCart(data);
    items.value = data.items;
    totalPrice.value = data.total_price;
  }
  function enqueue(task) {
    const ctx = context();
    waiting += 1; loading.value = true;
    const promise = tail.catch(() => {}).then(async () => {
      ctx.assert();
      try { return await task(ctx); }
      catch (caught) {
        if (ctx.current()) error.value = message(caught);
        throw caught;
      }
    }).finally(() => {
      if (ctx.current()) { waiting -= 1; loading.value = waiting > 0; }
    });
    tail = promise.catch(() => {});
    return promise;
  }
  function reset() {
    scope.value += 1;
    items.value = []; totalPrice.value = 0; loading.value = false; error.value = ''; notice.value = ''; adjustments.value = [];
    phase.value = 'idle'; waiting = 0; tail = Promise.resolve(); initializing = null;
  }
  async function synchronize(ctx) {
    error.value = ''; phase.value = 'loading';
    try {
      if (ctx.kind !== 'server') return;
      // Migrate only carts saved before login became mandatory. Fresh accounts
      // read the server cart without creating a local batch or requiring a lock.
      const hasLegacyItems = storage.read().batches.some((batch) =>
        batch.merge?.target_user_id === ctx.userId || (!batch.merge && batch.items.length > 0));
      const batches = hasLegacyItems ? await storage.prepare(ctx.userId, ctx.current) : [];
      ctx.assert();
      if (!batches.length) {
        const data = await getCart(ctx.config); ctx.assert(); applyCart(data);
      }
      for (const batch of batches) {
        ctx.assert(); phase.value = 'merging';
        let data;
        try { data = await mergeCart(batch, ctx.config); }
        catch (caught) {
          ctx.assert();
          phase.value = caught.response?.status === 422 ? 'merge-rejected' : 'merge-error';
          // Read-only reconciliation: never retry an additive mutation with a new ID.
          try { const current = await getCart(ctx.config); ctx.assert(); applyCart(current); } catch { ctx.assert(); }
          throw caught;
        }
        ctx.assert(); assertCart(data);
        if (data.merge?.merge_id !== batch.batch_id || !Array.isArray(data.adjustments)) throw new Error('合并响应无法确认，本地批次已保留');
        applyCart(data);
        adjustments.value = [...adjustments.value, ...data.adjustments];
        notice.value = '旧版购物车已恢复到当前账号';
        try { await storage.acknowledge(batch, ctx.userId, ctx.current); }
        catch (caught) { ctx.assert(); throw new Error(`购物车已合并，本地清理待重试：${message(caught)}`); }
      }
      ctx.assert(); phase.value = 'ready';
    } catch (caught) {
      if (ctx.current() && !['merge-error', 'merge-rejected'].includes(phase.value)) phase.value = 'error';
      throw caught;
    }
  }
  function fetchCart() {
    if (initializing) return initializing;
    if (mode.value !== 'server') return Promise.resolve();
    const revision = scope.value;
    const promise = enqueue(synchronize).finally(() => { if (scope.value === revision && initializing === promise) initializing = null; });
    initializing = promise;
    return promise;
  }
  function setSession(next) {
    const key = `${next.kind}:${next.userId ?? ''}:${next.revision}:${next.token ?? ''}`;
    if (identity === key) return initializing || Promise.resolve();
    identity = key;
    reset(); session = next; mode.value = next.kind;
    if (next.kind === 'pending' || next.kind === 'guest') { phase.value = 'blocked'; return Promise.resolve(); }
    if (next.kind === 'admin') { phase.value = 'blocked'; notice.value = '管理员账号不使用购物车'; return Promise.resolve(); }
    return fetchCart();
  }
  function mutate(serverTask, { manage = false } = {}) {
    if (mode.value !== 'server') return Promise.reject(new Error('请先以普通用户身份登录后使用购物车'));
    const permitted = () => mode.value === 'server' && (phase.value === 'ready' || (manage && phase.value === 'merge-rejected'));
    if (!permitted()) return Promise.reject(new Error('请先完成购物车同步或重试'));
    return enqueue(async (ctx) => {
      if (!permitted()) throw new Error('购物车状态已变化，请先重新同步');
      error.value = '';
      if (ctx.kind === 'server') {
        try { const data = await serverTask(ctx.config); ctx.assert(); applyCart(data); }
        catch (caught) {
          if (ctx.current() && (!caught.response || caught.response.status >= 500)) {
            phase.value = 'uncertain';
            throw new Error('操作结果待核对，请刷新购物车；不要重复提交同一次加购');
          }
          throw caught;
        }
      }
    });
  }
  function addItem(equipmentId, quantity) {
    validateEquipmentId(equipmentId); validateGuestQuantity(quantity);
    return mutate((config) => addCartItem(equipmentId, quantity, config));
  }
  function updateItem(itemId, quantity) {
    validateGuestQuantity(quantity);
    return mutate((config) => updateCartItem(itemId, quantity, config), { manage: true });
  }
  function removeItems(ids) {
    if (!Array.isArray(ids) || !ids.length) return Promise.resolve();
    return mutate((config) => deleteCartItems(ids, config), { manage: true });
  }
  function removeItem(id) {
    return mutate((config) => deleteCartItem(id, config), { manage: true });
  }
  function submitCheckout(task) {
    if (mode.value !== 'server') return Promise.reject(new Error('请以普通用户身份登录'));
    return enqueue(async (ctx) => {
      if (phase.value !== 'ready') throw new Error('请先完成购物车同步');
      try {
        const result = await task(ctx.config);
        ctx.assert();
        applyCart(result.cart);
        return result;
      } catch (caught) {
        if (ctx.current() && (!caught.response || caught.response.status >= 500)) phase.value = 'uncertain';
        throw caught;
      }
    });
  }
  function clear() { return mutate(clearCart, { manage: true }); }
  return { items, totalPrice, loading, error, notice, adjustments, mode, phase, scope, itemCount, availableTotal, checkoutAllowed, canWrite, canManage,
    fetchCart, addItem, updateItem, removeItem, removeItems, clear, reset, setSession, configureStorage, submitCheckout };
});
