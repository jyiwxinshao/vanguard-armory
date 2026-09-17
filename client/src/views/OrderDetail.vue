<script setup>
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useOrdersStore } from '../stores/orders.js';
import { useCatalogStore } from '../stores/catalog.js';
import SessionRecovery from '../components/SessionRecovery.vue';
import OrderItems from '../components/OrderItems.vue';
import { formatMoney } from '../utils/format.js';
import { orderStatusLabel, orderAmountLabel, formatOrderDate } from '../utils/orders.js';
const route = useRoute(); const auth = useAuthStore(); const orders = useOrdersStore(); const catalog = useCatalogStore();
const confirmCancel = ref(false);
async function load() { if (orders.canUse) { await orders.loadDetail(route.params.id).catch(() => {}); void catalog.load().catch(() => {}); } }
async function action(name) { confirmCancel.value = false; await orders.action(name).catch(() => {}); }
watch(() => [route.params.id, auth.status, auth.user?.id, auth.revision], () => { confirmCancel.value = false; void load(); }, { immediate: true });
</script>
<template>
  <section class="order-page" aria-labelledby="order-detail-heading">
    <header class="order-heading"><div><p class="catalog-kicker">ARMORY REQUISITION // ORDER</p><h1 id="order-detail-heading">订单详情</h1></div><RouterLink to="/orders" class="back-link">返回我的订单</RouterLink></header>
    <SessionRecovery v-if="!auth.isAuthenticated" />
    <p v-else-if="!orders.canUse" class="order-panel">管理员账号不能访问普通用户订单。</p>
    <template v-else>
      <div v-if="orders.detailError" class="order-alert" role="alert"><p>{{ orders.detailError }}</p><button class="cart-toolbar-button" :disabled="orders.acting" @click="load">刷新订单状态</button></div>
      <p v-if="orders.detailLoading" class="order-panel" role="status">正在加载订单…</p>
      <template v-else-if="orders.detail">
        <div class="order-panel order-status-panel"><div><span class="order-status" :class="`status-${orders.detail.status}`">{{ orderStatusLabel(orders.detail.status) }}</span><p class="order-number">{{ orders.detail.order_no }}</p></div><div class="order-amount"><small>{{ orderAmountLabel(orders.detail.status) }}</small><strong>{{ formatMoney(orders.detail.actual_total) }}</strong></div></div>
        <div class="order-layout">
          <div class="order-panel"><h2>装备快照</h2><OrderItems :items="orders.detail.items" snapshot /><p class="checkout-note">装备名称、图片、稀有度与单价记录下单时的信息。</p></div>
          <div class="order-panel"><h2>订单信息</h2><dl class="order-info">
            <dt>游戏角色</dt><dd>{{ orders.detail.character_name }}</dd><dt>游戏服务器</dt><dd>{{ catalog.meta.servers.find(s => s.value === orders.detail.server)?.label || orders.detail.server }}</dd>
            <dt>商品总额</dt><dd>{{ formatMoney(orders.detail.total) }}</dd><dt>优惠</dt><dd>{{ formatMoney(orders.detail.discount) }}</dd><dt>创建时间</dt><dd>{{ formatOrderDate(orders.detail.created_at) }}</dd>
            <template v-if="orders.detail.payment_time"><dt>支付时间</dt><dd>{{ formatOrderDate(orders.detail.payment_time) }}</dd></template><template v-if="orders.detail.cancelled_at"><dt>取消时间</dt><dd>{{ formatOrderDate(orders.detail.cancelled_at) }}</dd></template><template v-if="orders.detail.completed_at"><dt>完成时间</dt><dd>{{ formatOrderDate(orders.detail.completed_at) }}</dd></template>
          </dl>
            <template v-if="orders.detail.status === 'pending'">
              <p class="checkout-note">此订单已占用库存。可模拟支付，或取消并返还库存；不会发起真实扣款。</p>
              <div class="order-actions"><button class="primary-button" :disabled="orders.acting || Boolean(orders.detailError)" @click="action('pay')">{{ orders.acting ? '正在处理…' : '模拟支付' }}</button><button class="cart-toolbar-button" :disabled="orders.acting || Boolean(orders.detailError)" @click="confirmCancel = true">取消订单</button></div>
              <div v-if="confirmCancel" class="order-alert" role="alert"><p>确认取消此订单？取消后库存会返还，装备不会自动回到购物车。</p><button class="cart-toolbar-button" :disabled="orders.acting" @click="action('cancel')">确认取消</button><button class="cart-toolbar-button" @click="confirmCancel = false">保留订单</button></div>
            </template>
            <p v-else-if="orders.detail.status === 'paid'" class="checkout-hint">模拟支付成功，等待装备交付。</p>
            <p v-else-if="orders.detail.status === 'cancelled'" class="checkout-note">订单已取消，库存已返还。</p>
            <p v-else class="checkout-hint">订单已完成。</p>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
