import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { useAuthStore } from './auth.js';
import { useCartStore } from './cart.js';
import { createOrder, getOrders, getOrder, getOrderByRequest, payOrder, cancelOrder } from '../api/orders.js';
import { createCheckoutStorage } from '../utils/checkout-storage.js';
import { confirmationItems } from '../utils/orders.js';

const failureMessage = (error) => error.response?.data?.message || error.message || '订单操作未成功，请重试';
function validOrder(order) {
  if (!order || !Number.isSafeInteger(order.id) || !['pending', 'paid', 'cancelled', 'completed'].includes(order.status) || !Array.isArray(order.items) || !order.items.length || !Number.isSafeInteger(order.actual_total)) throw new Error('订单响应无法确认，请恢复上一次提交');
  return order;
}
export const useOrdersStore = defineStore('orders', () => {
  const auth = useAuthStore(); const cart = useCartStore();
  const items = ref([]); const total = ref(0); const detail = ref(null);
  const listLoading = ref(false); const detailLoading = ref(false); const acting = ref(false);
  const listError = ref(''); const detailError = ref('');
  const confirmation = ref([]); const draft = ref(null); const checkoutLoading = ref(false); const checkoutError = ref(''); const checkoutNotice = ref('');
  const checkoutRecoveryAvailable = ref(false);
  const canUse = computed(() => auth.isAuthenticated && auth.user?.role === 'user');
  let generation = 0; let listRevision = 0; let detailRevision = 0; let checkoutRevision = 0;
  let storage = createCheckoutStorage(); let submitting = null; let initializing = null;
  function configureStorage(value) { storage = value; }
  function context() {
    const token = auth.token; const revision = auth.revision; const userId = auth.user?.id; const currentGeneration = generation;
    const current = () => canUse.value && generation === currentGeneration && auth.user?.id === userId && auth.isCurrentSession(token, revision);
    const assert = () => { if (!current()) throw new Error('登录状态已变化，请重新确认'); };
    assert();
    return { userId, current, assert, config: { headers: { Authorization: `Bearer ${token}` }, sessionGuard: current } };
  }
  watch(() => [auth.status, auth.user?.id, auth.user?.role, auth.revision, auth.token], () => {
    generation += 1; listRevision += 1; detailRevision += 1; checkoutRevision += 1;
    items.value = []; total.value = 0; detail.value = null; confirmation.value = []; draft.value = null;
    listLoading.value = detailLoading.value = acting.value = checkoutLoading.value = false;
    listError.value = detailError.value = checkoutError.value = checkoutNotice.value = '';
    submitting = initializing = null;
    checkoutRecoveryAvailable.value = false;
  }, { flush: 'sync' });
  async function loadList(params) {
    const ctx = context(); const revision = ++listRevision;
    // History remains available even if a local checkout record needs repair.
    try { checkoutRecoveryAvailable.value = Boolean(storage.read(ctx.userId)); }
    catch { checkoutRecoveryAvailable.value = true; }
    listLoading.value = true; listError.value = ''; items.value = [];
    try { const result = await getOrders(params, ctx.config); ctx.assert(); if (revision === listRevision) { items.value = result.items; total.value = result.total; } }
    catch (error) { if (ctx.current() && revision === listRevision) listError.value = failureMessage(error); throw error; }
    finally { if (ctx.current() && revision === listRevision) listLoading.value = false; }
  }
  async function loadDetail(id) {
    const ctx = context(); const revision = ++detailRevision;
    detail.value = null; detailLoading.value = true; detailError.value = '';
    try { const result = validOrder(await getOrder(id, ctx.config)); ctx.assert(); if (revision === detailRevision) detail.value = result; }
    catch (error) { if (ctx.current() && revision === detailRevision) detailError.value = failureMessage(error); throw error; }
    finally { if (ctx.current() && revision === detailRevision) detailLoading.value = false; }
  }
  async function action(name) {
    if (!['pay', 'cancel'].includes(name)) throw new Error('订单操作无效');
    if (acting.value || !detail.value) return;
    const ctx = context(); const id = detail.value.id; const revision = detailRevision;
    acting.value = true; detailError.value = '';
    try {
      const result = validOrder(await (name === 'pay' ? payOrder(id, ctx.config) : cancelOrder(id, ctx.config)));
      ctx.assert(); if (detailRevision === revision) detail.value = result;
    } catch (error) {
      if (ctx.current() && detailRevision === revision) detailError.value = `${failureMessage(error)}；请刷新订单核对后再操作`;
      throw error;
    } finally { if (ctx.current()) acting.value = false; }
  }
  function loadCheckout() {
    if (submitting) return submitting;
    if (initializing) return initializing;
    const ctx = context(); const revision = ++checkoutRevision;
    checkoutLoading.value = true; checkoutError.value = ''; confirmation.value = [];
    const promise = Promise.resolve().then(async () => {
      try {
        ctx.assert();
        draft.value = storage.read(ctx.userId);
        if (draft.value) { checkoutNotice.value = '已恢复上一次下单记录，请核对或恢复提交结果。'; return; }
        await cart.fetchCart(); ctx.assert();
        if (!cart.checkoutAllowed || cart.mode !== 'server') throw new Error(cart.error || '购物车为空、正在同步或存在失效装备，请返回购物车处理');
        confirmation.value = cart.items.map((item) => ({ ...item }));
      } catch (error) { if (ctx.current() && revision === checkoutRevision) checkoutError.value = failureMessage(error); throw error; }
      finally { if (ctx.current() && revision === checkoutRevision) { checkoutLoading.value = false; initializing = null; } }
    });
    initializing = promise;
    return promise;
  }
  async function finish(result, ctx) {
    validOrder(result.order);
    if (result.request_id !== draft.value?.payload.request_id) throw new Error('提交编号不匹配，请恢复原订单');
    const requestId = result.request_id;
    detail.value = result.order;
    try { await storage.complete(ctx.userId, requestId, ctx.current); ctx.assert(); draft.value = null; }
    catch (error) { ctx.assert(); checkoutNotice.value = `订单已创建，本地记录清理待重试：${failureMessage(error)}`; }
    return result.order;
  }
  function submit(values) {
    if (submitting) return submitting;
    const ctx = context(); checkoutLoading.value = true; checkoutError.value = '';
    let sent = false;
    const promise = Promise.resolve().then(async () => {
      try {
        ctx.assert();
        if (!draft.value) {
          if (!confirmation.value.length) throw new Error('请先确认购物车内容');
          const body = { character_name: values.character_name.trim(), server: values.server, remark: values.remark.trim(), items: confirmationItems(confirmation.value) };
          const prepared = await storage.prepare(ctx.userId, body, ctx.current); ctx.assert(); draft.value = prepared;
        }
        const pending = await storage.pending(ctx.userId, draft.value.payload.request_id, ctx.current); ctx.assert();
        if (!pending) throw new Error('下单记录已在其他页面处理，请重新核对');
        draft.value = pending;
        await cart.fetchCart(); ctx.assert();
        const saved = draft.value;
        const result = await cart.submitCheckout((config) => { sent = true; return createOrder(saved.payload, config); });
        ctx.assert();
        return await finish(result, ctx);
      } catch (error) {
        if (ctx.current()) {
          // Only a definite business rejection permits a new confirmation. Unknown
          // results always retain the same ID and immutable body across refreshes.
          if (sent && draft.value && (error.response?.status === 422 || (error.response?.status === 409 && [10005, 10007, 10009].includes(error.response.data?.code)))) {
            try { const rejected = await storage.rejected(ctx.userId, draft.value.payload.request_id, ctx.current); ctx.assert(); draft.value = rejected; } catch { /* Retain immutable pending data if writing fails. */ }
          }
          if (ctx.current()) checkoutError.value = failureMessage(error);
        }
        throw error;
      } finally { if (ctx.current()) { checkoutLoading.value = false; submitting = null; } }
    });
    submitting = promise;
    return promise;
  }
  async function recover() {
    if (checkoutLoading.value) return;
    const ctx = context();
    draft.value = storage.read(ctx.userId);
    if (!draft.value) return;
    checkoutLoading.value = true; checkoutError.value = '';
    try {
      const result = await getOrderByRequest(draft.value.payload.request_id, ctx.config); ctx.assert();
      const order = await finish(result, ctx);
      void cart.fetchCart().catch(() => {});
      return order;
    } catch (error) {
      if (ctx.current()) checkoutError.value = error.response?.status === 404 ? '尚未查到订单，原提交已保留；可使用同一记录重试下单。' : failureMessage(error);
      throw error;
    } finally { if (ctx.current()) checkoutLoading.value = false; }
  }
  async function reconfirm() {
    const ctx = context();
    await storage.discardRejected(ctx.userId, ctx.current); ctx.assert(); draft.value = null; checkoutNotice.value = '';
    return loadCheckout();
  }
  return { items, total, detail, listLoading, detailLoading, acting, listError, detailError, confirmation, draft, checkoutLoading, checkoutError, checkoutNotice, checkoutRecoveryAvailable, canUse,
    loadList, loadDetail, action, loadCheckout, submit, recover, reconfirm, configureStorage };
});
