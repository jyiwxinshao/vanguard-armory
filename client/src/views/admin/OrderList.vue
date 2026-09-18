<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElPagination } from 'element-plus';
import 'element-plus/es/components/pagination/style/css';
import { getAdminOrders } from '../../api/admin/orders.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { requestMessage } from '../../utils/auth.js';
import { formatMoney } from '../../utils/format.js';
import { formatOrderDate, orderAmountLabel, orderStatusLabel } from '../../utils/orders.js';
import { ADMIN_ORDER_STATUSES, ADMIN_PAGE_SIZES, adminOrderParams, adminOrderRoute, parseAdminOrderQuery } from '../../utils/admin/orders-query.js';
import { notify } from '../../utils/notify.js';
import { copyOrderNumber } from '../../utils/order-copy.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const request = createLatestRequest();
const filters = computed(() => parseAdminOrderQuery(route.query));
const form = reactive(parseAdminOrderQuery(route.query));
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const navigationError = ref('');

async function navigate(next, replace = false) {
  navigationError.value = '';
  try {
    const location = { path: '/admin/orders', query: adminOrderRoute(next) };
    if (replace) await router.replace(location);
    else if (JSON.stringify(location.query) === JSON.stringify(adminOrderRoute(filters.value))) await load();
    else await router.push(location);
  } catch { navigationError.value = '筛选条件暂时无法更新，请重试'; }
}

function load() {
  const token = auth.token;
  const revision = auth.revision;
  const current = () => canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
  if (!current()) { request.cancel(); items.value = []; total.value = 0; loading.value = false; return; }
  const submitted = filters.value;
  let params;
  try { params = adminOrderParams(submitted); }
  catch (error) { errorMessage.value = error.message; return; }
  return request.run(
    (signal) => getAdminOrders(params, { signal, sessionGuard: current }),
    {
      onStart: () => { loading.value = true; errorMessage.value = ''; items.value = []; total.value = 0; },
      onSuccess: (result) => {
        if (!current()) return;
        items.value = result.items;
        total.value = result.total;
        const lastPage = Math.max(1, Math.ceil(result.total / submitted.page_size));
        if (submitted.page > lastPage) void navigate({ ...submitted, page: lastPage }, true);
      },
      onError: (error) => { if (current()) errorMessage.value = requestMessage(error, '订单列表加载失败，请重试'); },
      onFinish: () => { if (current()) loading.value = false; },
    },
  );
}

function search() { void navigate({ ...form, page: 1 }); }
function reset() { Object.assign(form, parseAdminOrderQuery()); void navigate(form); }
function copyOrder(orderNo) { void copyOrderNumber(orderNo, { notify }); }
watch(filters, (value) => { Object.assign(form, value); void load(); }, { immediate: true, flush: 'sync' });
onUnmounted(() => request.dispose());
</script>

<template>
  <section class="admin-module" aria-labelledby="order-admin-title">
    <header class="admin-module-heading"><h1 id="order-admin-title">订单管理</h1><p>查询交易记录，处理待支付订单与装备交付。</p></header>
    <form class="admin-filter-form" @submit.prevent="search">
      <label>订单号<input v-model="form.order_no" type="search" maxlength="24" placeholder="输入订单号"></label>
      <label>用户 ID<input v-model="form.user_id" type="search" inputmode="numeric" placeholder="例如 12"></label>
      <label>订单状态<select v-model="form.status"><option v-for="item in ADMIN_ORDER_STATUSES" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
      <label>开始日期<input v-model="form.from" type="date"></label>
      <label>结束日期<input v-model="form.to" type="date"></label>
      <div class="admin-filter-actions"><button type="submit" class="primary-button">查询</button><button type="button" @click="reset">重置</button></div>
    </form>
    <p v-if="navigationError" class="auth-error" role="alert">{{ navigationError }}</p>
    <div v-if="loading" class="admin-list-message" role="status">正在加载订单…</div>
    <div v-else-if="errorMessage" class="admin-list-message" role="alert"><p>{{ errorMessage }}</p><button type="button" class="primary-button" @click="load">重新加载</button></div>
    <template v-else>
      <p class="admin-result-count" role="status">共 {{ total }} 笔订单</p>
      <div v-if="!items.length" class="admin-list-message"><p>没有符合条件的订单。</p><button type="button" @click="reset">清除筛选</button></div>
      <div v-else class="admin-table-scroll" tabindex="0" role="region" aria-label="订单查询结果">
        <table class="admin-equipment-table">
          <caption class="admin-table-caption">订单列表</caption>
          <thead><tr><th scope="col">订单号</th><th scope="col">用户</th><th scope="col">角色 / 服务器</th><th scope="col">状态</th><th scope="col">金额</th><th scope="col">创建时间</th><th scope="col"></th></tr></thead>
          <tbody><tr v-for="item in items" :key="item.id">
            <td><strong>#{{ item.id }}</strong> <small class="admin-detail-id">{{ item.order_no }}</small> <button type="button" class="copy-button" aria-label="复制订单号" @click.stop="copyOrder(item.order_no)">复制</button></td>
            <td>#{{ item.user_id }}</td>
            <td>{{ item.character_name || '—' }} / {{ item.server || '—' }}</td>
            <td><span class="admin-equipment-status" :class="`is-${item.status}`">{{ orderStatusLabel(item.status) }}</span></td>
            <td class="admin-money"><small>{{ orderAmountLabel(item.status) }}</small> {{ formatMoney(item.actual_total) }}</td>
            <td>{{ formatOrderDate(item.created_at) }}</td>
            <td><RouterLink class="admin-equipment-link" :to="{ path: `/admin/orders/${item.id}`, query: { returnTo: route.fullPath } }">查看详情</RouterLink></td>
          </tr></tbody>
        </table>
      </div>
      <div class="admin-pagination">
        <label>每页<select :value="filters.page_size" @change="navigate({ ...filters, page_size: $event.target.value, page: 1 })"><option v-for="size in ADMIN_PAGE_SIZES" :key="size" :value="size">{{ size }} 条</option></select></label>
        <ElPagination :current-page="filters.page" :page-size="filters.page_size" :total="total" :pager-count="5" layout="prev, pager, next" background @update:current-page="navigate({ ...filters, page: $event })" />
      </div>
    </template>
  </section>
</template>
