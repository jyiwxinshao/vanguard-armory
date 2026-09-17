<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import EquipmentImage from '../../components/EquipmentImage.vue';
import { getAdminOrder, updateAdminOrderStatus } from '../../api/admin/orders.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { isUncertainRequest } from '../../utils/request-state.js';
import { requestMessage } from '../../utils/auth.js';
import { formatMoney } from '../../utils/format.js';
import { formatOrderDate, orderAmountLabel, orderStatusLabel } from '../../utils/orders.js';
import { safeAdminOrderReturn } from '../../utils/admin/navigation.js';

const route = useRoute();
const auth = useAuthStore();
const order = ref(null);
const loading = ref(false);
const issue = ref(null);
const acting = ref(false);
const actionError = ref('');
const uncertain = ref(false);
const needsReload = ref(false);
const confirmAction = ref('');
const backTo = computed(() => safeAdminOrderReturn(route.query.returnTo));

const request = createLatestRequest();
let active = true;
let generation = 0;
let writeController;

function sessionGuard() {
  const token = auth.token;
  const revision = auth.revision;
  const version = generation;
  const routeId = route.params.id;
  return () => active && generation === version && route.params.id === routeId
    && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
}

function orderIssue(error) {
  const status = error.response?.status;
  if (status === 404) return { message: '订单不存在，请返回列表重新选择。', retry: false };
  if (status === 422) return { message: '订单地址无效，请返回列表重新选择。', retry: false };
  return { message: requestMessage(error, '订单详情加载失败，请重试'), retry: ![401, 403].includes(status) };
}

function load() {
  generation++;
  writeController?.abort();
  acting.value = false;
  order.value = null;
  const current = sessionGuard();
  if (!current()) { request.cancel(); loading.value = false; return; }
  return request.run((signal) => getAdminOrder(route.params.id, { signal, sessionGuard: current }), {
    onStart: () => { issue.value = null; actionError.value = ''; confirmAction.value = ''; loading.value = true; },
    onSuccess: (result) => { if (current()) { order.value = result; uncertain.value = false; needsReload.value = false; } },
    onError: (error) => { if (current()) issue.value = orderIssue(error); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}

async function changeStatus(target) {
  if (acting.value || uncertain.value || needsReload.value || !order.value) return;
  const id = order.value.id;
  const currentWrite = sessionGuard();
  // Route params are strings; MySQL may return a numeric ID.
  if (!currentWrite() || String(route.params.id) !== String(id)) return;
  const previous = order.value;
  confirmAction.value = '';
  acting.value = true;
  actionError.value = '';
  uncertain.value = false;
  writeController = new AbortController();
  try {
    const updated = await updateAdminOrderStatus(id, { status: target }, { signal: writeController.signal, sessionGuard: currentWrite });
    if (!currentWrite()) return;
    order.value = updated;
  } catch (error) {
    if (!currentWrite()) return;
    if (isUncertainRequest(error)) uncertain.value = true;
    else {
      order.value = previous;
      needsReload.value = [404, 409].includes(error.response?.status);
      actionError.value = requestMessage(error, '订单状态更新失败，请重试');
    }
  } finally { if (currentWrite()) acting.value = false; }
}

watch(() => route.params.id, load, { immediate: true });
onUnmounted(() => { active = false; generation++; request.dispose(); writeController?.abort(); });
</script>

<template>
  <section class="admin-module" aria-labelledby="admin-order-detail-title">
    <RouterLink class="admin-back" :to="backTo">← 返回订单列表</RouterLink>
    <header class="admin-module-heading"><h1 id="admin-order-detail-title">订单详情</h1><p>查看订单快照与交易状态，处理取消或完成交付。</p></header>
    <div v-if="loading" class="admin-list-message admin-detail-content" role="status">正在加载订单…</div>
    <div v-else-if="issue" class="admin-list-message admin-detail-content" role="alert"><p>{{ issue.message }}</p><button v-if="issue.retry" type="button" class="primary-button" @click="load">重新加载</button></div>
    <article v-else-if="order" class="admin-detail-content">
      <div class="admin-detail-summary">
        <div>
          <p class="admin-detail-id">订单 #{{ order.id }} · {{ order.order_no }}</p>
          <h2>{{ order.character_name || '未绑定角色' }}</h2>
          <p class="admin-detail-note">用户 #{{ order.user_id }} · {{ order.server || '—' }}</p>
          <span class="admin-equipment-status" :class="`is-${order.status}`">{{ orderStatusLabel(order.status) }}</span>
          <p class="admin-money">{{ orderAmountLabel(order.status) }} {{ formatMoney(order.actual_total) }}</p>
        </div>
      </div>
      <dl class="admin-detail-fields">
        <div><dt>订单编号</dt><dd>{{ order.order_no }}</dd></div>
        <div><dt>订单状态</dt><dd>{{ orderStatusLabel(order.status) }}</dd></div>
        <div><dt>订单总额</dt><dd>{{ formatMoney(order.total) }}</dd></div>
        <div><dt>{{ orderAmountLabel(order.status) }}</dt><dd>{{ formatMoney(order.actual_total) }}</dd></div>
        <div><dt>创建时间</dt><dd>{{ formatOrderDate(order.created_at) }}</dd></div>
        <div><dt>支付时间</dt><dd>{{ formatOrderDate(order.payment_time) }}</dd></div>
        <div><dt>取消时间</dt><dd>{{ formatOrderDate(order.cancelled_at) }}</dd></div>
        <div><dt>完成时间</dt><dd>{{ formatOrderDate(order.completed_at) }}</dd></div>
      </dl>
      <section class="admin-detail-description">
        <h2>商品快照</h2>
        <div v-if="!order.items.length" class="admin-detail-note">该订单没有商品明细。</div>
        <div v-else class="admin-table-scroll">
          <table class="admin-equipment-table">
            <thead><tr><th scope="col">装备</th><th scope="col">稀有度</th><th scope="col">单价</th><th scope="col">数量</th><th scope="col">小计</th></tr></thead>
            <tbody><tr v-for="item in order.items" :key="item.id">
              <td><div class="admin-equipment-cell"><EquipmentImage :src="item.equipment_image" :name="item.equipment_name" /><strong>{{ item.equipment_name }}</strong></div></td>
              <td>{{ item.rarity }}</td>
              <td class="admin-money">{{ formatMoney(item.price) }}</td>
              <td>{{ item.quantity }} 件</td>
              <td class="admin-money">{{ formatMoney(item.subtotal) }}</td>
            </tr></tbody>
          </table>
        </div>
      </section>
      <section class="admin-detail-description admin-detail-content">
        <h2>订单处理</h2>
        <template v-if="uncertain || needsReload">
          <p class="admin-detail-note">{{ uncertain ? '操作结果待确认，请重新获取最新状态。' : '资料可能已发生变化，请重新获取最新状态后再操作。' }}</p>
          <button type="button" class="primary-button" :disabled="loading" @click="load">重新获取最新状态</button>
        </template>
        <template v-else-if="order.status === 'pending'">
          <p class="admin-detail-note">待支付订单可以取消，取消后库存会返还。</p>
          <button v-if="confirmAction !== 'cancelled'" type="button" class="cart-toolbar-button" :disabled="acting || uncertain || needsReload" @click="confirmAction = 'cancelled'">取消订单</button>
          <template v-else>
            <p class="auth-error" role="alert">确认取消此订单？库存会返还，装备不会自动回到购物车。</p>
            <button type="button" class="primary-button" :disabled="acting || uncertain || needsReload" @click="changeStatus('cancelled')">{{ acting ? '正在处理…' : '确认取消' }}</button>
            <button type="button" class="cart-toolbar-button" :disabled="acting || uncertain || needsReload" @click="confirmAction = ''">保留订单</button>
          </template>
        </template>
        <template v-else-if="order.status === 'paid'">
          <p class="admin-detail-note">已支付订单可以确认交付。</p>
          <button v-if="confirmAction !== 'completed'" type="button" class="primary-button" :disabled="acting || uncertain || needsReload" @click="confirmAction = 'completed'">确认交付</button>
          <template v-else>
            <p class="auth-error" role="alert">确认此订单已完成交付？</p>
            <button type="button" class="primary-button" :disabled="acting || uncertain || needsReload" @click="changeStatus('completed')">{{ acting ? '正在处理…' : '确认完成' }}</button>
            <button type="button" class="cart-toolbar-button" :disabled="acting || uncertain || needsReload" @click="confirmAction = ''">返回</button>
          </template>
        </template>
        <p v-else class="admin-detail-note">此订单已处于终态，无需进一步处理。</p>
        <p v-if="actionError" class="auth-error" role="alert">{{ actionError }}</p>
      </section>
    </article>
  </section>
</template>
