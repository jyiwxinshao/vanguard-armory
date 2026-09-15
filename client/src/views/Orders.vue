<script setup>
import { computed, reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useOrdersStore } from '../stores/orders.js';
import SessionRecovery from '../components/SessionRecovery.vue';
import { formatMoney } from '../utils/format.js';
import { orderStatuses, orderStatusLabel, orderAmountLabel, formatOrderDate, orderQueryFromRoute, orderQueryToApi } from '../utils/orders.js';
const auth = useAuthStore(); const orders = useOrdersStore(); const route = useRoute(); const router = useRouter();
const filters = reactive(orderQueryFromRoute(route.query));
const lastPage = computed(() => Math.max(1, Math.ceil(orders.total / filters.page_size)));
async function load() {
  if (!orders.canUse) return;
  let params;
  try { params = orderQueryToApi(filters); } catch (error) { orders.listError = error.message; return; }
  await orders.loadList(params).catch(() => {});
}
function navigate(page = 1) {
  try {
    orderQueryToApi(filters);
    const query = { page: String(page), page_size: String(filters.page_size) };
    for (const key of ['status', 'from', 'to']) if (filters[key]) query[key] = filters[key];
    const location = { path: '/orders', query };
    if (router.resolve(location).fullPath === route.fullPath) void load();
    else void router.push(location).catch(() => { orders.listError = '页面暂时无法切换，请重试'; });
  } catch (error) { orders.listError = error.message; }
}
watch(() => [route.fullPath, auth.status, auth.user?.id, auth.revision], () => { Object.assign(filters, orderQueryFromRoute(route.query)); void load(); }, { immediate: true });
</script>
<template>
  <section class="order-page" aria-labelledby="orders-heading">
    <header class="order-heading"><div><p class="catalog-kicker">ARMORY REQUISITION // HISTORY</p><h1 id="orders-heading">我的订单</h1><p>查看订单进度、继续支付或取消待支付订单。</p></div><RouterLink to="/" class="back-link">继续挑选装备</RouterLink></header>
    <SessionRecovery v-if="!auth.isAuthenticated" />
    <p v-else-if="!orders.canUse" class="order-panel">管理员账号不使用普通用户订单页面。</p>
    <template v-else>
      <form class="order-panel order-filters" @submit.prevent="navigate(1)">
        <label>订单状态<select v-model="filters.status"><option value="">全部状态</option><option v-for="status in orderStatuses" :key="status.value" :value="status.value">{{ status.label }}</option></select></label>
        <label>开始日期<input v-model="filters.from" type="date"></label><label>结束日期<input v-model="filters.to" type="date"></label>
        <label>每页<select v-model.number="filters.page_size"><option :value="10">10 条</option><option :value="20">20 条</option><option :value="50">50 条</option></select></label>
        <button class="primary-button" type="submit">查询</button>
      </form>
      <div v-if="orders.listError" class="order-alert" role="alert"><p>{{ orders.listError }}</p><button class="cart-toolbar-button" @click="load">重试</button></div>
      <p v-if="orders.listLoading" class="order-panel" role="status">正在加载订单…</p>
      <p v-else-if="!orders.listError && !orders.items.length" class="order-panel">当前条件下没有订单。</p>
      <div v-else class="order-list">
        <article v-for="order in orders.items" :key="order.id" class="order-panel order-card">
          <div><p class="order-number">{{ order.order_no }}</p><p class="order-muted">{{ formatOrderDate(order.created_at) }} · {{ order.character_name }}</p></div>
          <span class="order-status" :class="`status-${order.status}`">{{ orderStatusLabel(order.status) }}</span>
          <div class="order-amount"><small>{{ orderAmountLabel(order.status) }}</small><strong>{{ formatMoney(order.actual_total) }}</strong></div>
          <RouterLink :to="`/orders/${order.id}`" class="cart-toolbar-button">查看详情</RouterLink>
        </article>
      </div>
      <nav class="order-pagination" aria-label="订单分页"><span>共 {{ orders.total }} 笔 · 第 {{ filters.page }} / {{ lastPage }} 页</span><button class="cart-toolbar-button" :disabled="orders.listLoading || filters.page <= 1" @click="navigate(filters.page - 1)">上一页</button><button class="cart-toolbar-button" :disabled="orders.listLoading || filters.page >= lastPage" @click="navigate(filters.page + 1)">下一页</button></nav>
    </template>
  </section>
</template>
