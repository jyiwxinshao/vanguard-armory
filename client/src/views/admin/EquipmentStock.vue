<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getAdminEquipment, adjustAdminStock } from '../../api/admin/equipments.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { requestMessage } from '../../utils/auth.js';
import { safeAdminEquipmentReturn } from '../../utils/admin/equipment-detail.js';
import { createStockStorage, parseStockDelta, stockRejection } from '../../utils/admin/stock-storage.js';

const route = useRoute();
const auth = useAuthStore();
const storage = createStockStorage();
const reads = createLatestRequest();
const item = ref(null);
const pending = ref(null);
const result = ref(null);
const delta = ref('');
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const readError = ref('');
const storageError = ref('');
const id = computed(() => Number(route.params.id));
const backTo = computed(() => ({ path: `/admin/equipments/${encodeURIComponent(route.params.id)}`, query: { returnTo: safeAdminEquipmentReturn(route.query.returnTo) } }));
let active = true;
let generation = 0;
let controller;
function guard() {
  const token = auth.token, revision = auth.revision, version = generation;
  return () => active && generation === version && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
}
function restore() {
  if (!canAccessAdmin(auth)) return;
  try { pending.value = storage.read(auth.user.id, id.value); storageError.value = ''; }
  catch (cause) { storageError.value = cause.message; }
}
function refresh() {
  const current = guard();
  if (!current()) return;
  return reads.run((signal) => getAdminEquipment(route.params.id, { signal, sessionGuard: current }), {
    onStart: () => { loading.value = true; readError.value = ''; },
    onSuccess: (value) => { if (current()) item.value = value; },
    onError: (cause) => { if (current()) readError.value = requestMessage(cause); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}
async function submit() {
  if (busy.value || storageError.value || (!pending.value && (!item.value || item.value.status === 'deleted' || loading.value || readError.value))) return;
  const current = guard();
  if (!current()) return;
  const userId = auth.user.id, equipmentId = id.value;
  busy.value = true; error.value = ''; result.value = null;
  controller = new AbortController();
  try {
    const operation = await storage.prepare(userId, equipmentId, pending.value?.payload.delta ?? parseStockDelta(delta.value), current);
    if (!current()) return;
    pending.value = operation;
    const response = await adjustAdminStock(equipmentId, operation.payload, { signal: controller.signal, sessionGuard: current });
    if (!current()) return;
    if (!['applied', 'rejected'].includes(response.outcome) || response.request_id !== operation.payload.request_id || response.actor_id !== userId || response.equipment_id !== equipmentId || response.delta !== operation.payload.delta) throw new Error('库存回执格式异常');
    result.value = response;
    await storage.complete(userId, equipmentId, operation.payload.request_id, current);
    if (!current()) return;
    delta.value = ''; restore(); await refresh();
  } catch (cause) {
    if (!current()) return;
    restore();
    error.value = pending.value ? `${requestMessage(cause, '暂时无法确认库存结果')}。待处理操作已保留，请使用原编号再次确认。` : cause.message;
  } finally { if (current()) busy.value = false; }
}
watch(() => route.params.id, () => { generation++; controller?.abort(); item.value = null; result.value = null; pending.value = null; delta.value = ''; error.value = ''; busy.value = false; restore(); void refresh(); }, { immediate: true });
function onStorage() { if (!busy.value) restore(); }
window.addEventListener('storage', onStorage);
onUnmounted(() => { active = false; generation++; controller?.abort(); reads.dispose(); window.removeEventListener('storage', onStorage); });
</script>

<template>
  <section class="admin-module" aria-labelledby="stock-title">
    <RouterLink class="admin-back" :to="backTo">← 返回装备详情</RouterLink>
    <header class="admin-module-heading"><h1 id="stock-title">调整库存</h1><p>仅调整可售库存，不改变已下单占用的库存和订单状态。</p></header>
    <div class="admin-list-message admin-detail-content">
      <p v-if="item">{{ item.name }} · 最近读取的可售库存：{{ item.stock }} 件</p>
      <p v-if="loading" role="status">正在读取最新库存…</p>
      <p v-if="readError" role="alert">{{ readError }}</p>
      <button type="button" :disabled="busy || loading" @click="refresh">刷新库存</button>
    </div>
    <p v-if="storageError" class="admin-list-message" role="alert">{{ storageError }}</p>
    <p v-if="error" class="admin-list-message" role="alert">{{ error }}</p>
    <div v-if="result" class="admin-list-message" role="status">
      <p>{{ result.outcome === 'applied' ? '库存调整已完成' : stockRejection(result.rejection_reason) }}{{ result.replayed ? '（已确认原操作结果）' : '' }}</p>
      <p>本次{{ result.delta > 0 ? '增加' : '减少' }} {{ Math.abs(result.delta) }} 件；该次操作库存：{{ result.stock_before }} → {{ result.stock_after }}</p>
    </div>
    <div v-if="pending" class="admin-list-message">
      <p>待确认：{{ pending.payload.delta > 0 ? '增加' : '减少' }} {{ Math.abs(pending.payload.delta) }} 件。刷新或重试均沿用原操作编号。</p>
      <button type="button" :disabled="busy || Boolean(storageError)" @click="submit">{{ busy ? '正在确认…' : '确认上次调整结果' }}</button>
    </div>
    <p v-else-if="item?.status === 'deleted'" class="admin-list-message">装备已删除，不能新增库存操作。</p>
    <form v-else-if="item" class="admin-create-form" novalidate @submit.prevent="submit">
      <div class="auth-field"><label for="stock-delta">增减数量（例如 +10 或 -2）</label><input id="stock-delta" v-model="delta" inputmode="text" :disabled="busy" /></div>
      <button class="auth-submit" type="submit" :disabled="busy || loading || Boolean(storageError) || Boolean(readError)">{{ busy ? '正在提交…' : '确认调整库存' }}</button>
    </form>
  </section>
</template>
