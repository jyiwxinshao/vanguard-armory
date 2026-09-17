<script setup>
import { onUnmounted, ref, watch } from 'vue';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { getAdminOverview } from '../../api/admin/overview.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { requestMessage } from '../../utils/auth.js';
import { formatMoney } from '../../utils/format.js';
import { formatOrderDate } from '../../utils/orders.js';
const auth = useAuthStore();
const data = ref(null), loading = ref(false), error = ref('');
const request = createLatestRequest();
let active = true;
function load() {
  const token = auth.token, revision = auth.revision;
  const current = () => active && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
  data.value = null; error.value = '';
  if (!current()) { request.cancel(); loading.value = false; return; }
  return request.run((signal) => getAdminOverview({ signal, sessionGuard: current }), {
    onStart: () => { loading.value = true; },
    onSuccess: (result) => { if (current()) data.value = result; },
    onError: (caught) => { if (current()) error.value = requestMessage(caught, '概览加载失败，请重试'); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}
watch(() => [auth.status, auth.revision], load, { immediate: true, flush: 'sync' });
onUnmounted(() => { active = false; request.dispose(); });
</script>
<template>
  <section class="admin-module" aria-labelledby="admin-overview-title">
    <header class="admin-module-heading"><h1 id="admin-overview-title">管理概览</h1><p>查看交易进度与库存，快速进入待处理事项。</p></header>
    <div class="admin-overview-toolbar"><span v-if="data">更新于 {{ formatOrderDate(data.updated_at) }}</span><button type="button" class="primary-button" :disabled="loading" @click="load">{{ loading ? '正在刷新…' : '刷新概览' }}</button></div>
    <p v-if="loading" class="admin-list-message" role="status">正在读取最新统计…</p>
    <p v-else-if="error" class="admin-list-message" role="alert">{{ error }}</p>
    <div v-else-if="data" class="admin-overview-grid">
      <RouterLink class="admin-overview-card" :to="{ path: '/admin/orders', query: { status: 'pending' } }"><span>待支付订单</span><strong>{{ data.pending_orders }}</strong><small>查看待支付订单 →</small></RouterLink>
      <RouterLink class="admin-overview-card" :to="{ path: '/admin/orders', query: { status: 'paid' } }"><span>待交付订单</span><strong>{{ data.awaiting_delivery_orders }}</strong><small>处理已支付订单 →</small></RouterLink>
      <div class="admin-overview-card"><span>累计已支付金额</span><strong>{{ formatMoney(data.paid_amount) }}</strong><small>仅统计已支付、已完成订单 · 模拟支付</small></div>
      <RouterLink class="admin-overview-card" :to="{ path: '/admin/equipments', query: { status: 'on_sale', low_stock: '1' } }"><span>低库存装备</span><strong>{{ data.low_stock_count }}</strong><small>在售库存 ≤ {{ data.low_stock_threshold }} 件，含售罄 →</small></RouterLink>
    </div>
  </section>
</template>
