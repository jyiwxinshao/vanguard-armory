<script setup>
import { computed, reactive, ref, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useOrdersStore } from '../stores/orders.js';
import { useCatalogStore } from '../stores/catalog.js';
import SessionRecovery from '../components/SessionRecovery.vue';
import OrderItems from '../components/OrderItems.vue';
import { checkoutErrors } from '../utils/orders.js';
import { formatMoney } from '../utils/format.js';
import { fieldErrorsFrom } from '../utils/auth.js';
const auth = useAuthStore(); const orders = useOrdersStore(); const catalog = useCatalogStore(); const router = useRouter();
const form = reactive({ character_name: '', server: '', remark: '' });
const errors = ref({}); const metaError = ref('');
let active = true; onUnmounted(() => { active = false; });
const total = computed(() => orders.confirmation.reduce((sum, item) => sum + item.price * item.quantity, 0));
async function load() {
  if (!orders.canUse) return;
  metaError.value = '';
  await Promise.all([orders.loadCheckout().catch(() => {}), catalog.load().catch(() => { metaError.value = '游戏服务器选项暂时无法加载，请重试'; })]);
}
async function submit() {
  if (orders.checkoutLoading) return;
  errors.value = orders.draft ? {} : checkoutErrors(form, catalog.meta.servers);
  if (Object.keys(errors.value).length) return;
  const revision = auth.revision; const userId = auth.user?.id;
  try {
    const order = await orders.submit(form);
    if (active && auth.revision === revision && auth.user?.id === userId) await router.replace(`/orders/${order.id}`);
  } catch (error) { if (active && auth.revision === revision && auth.user?.id === userId) errors.value = fieldErrorsFrom(error); }
}
async function recover() {
  const revision = auth.revision; const userId = auth.user?.id;
  try { const order = await orders.recover(); if (order && active && auth.revision === revision && auth.user?.id === userId) await router.replace(`/orders/${order.id}`); } catch { /* Store presents recovery instructions. */ }
}
async function reconfirm() { errors.value = {}; try { await orders.reconfirm(); } catch (error) { metaError.value = error.message; } }
watch(() => [auth.status, auth.user?.id, auth.revision], () => { form.character_name = ''; form.server = ''; form.remark = ''; errors.value = {}; void load(); }, { immediate: true });
</script>
<template>
  <section class="order-page" aria-labelledby="checkout-heading">
    <header class="order-heading"><div><p class="catalog-kicker">ARMORY REQUISITION // CONFIRMATION</p><h1 id="checkout-heading">确认订单</h1><p>核对装备与游戏角色信息，创建订单后将为你保留库存。</p></div><RouterLink to="/cart" class="back-link">返回购物车</RouterLink></header>
    <SessionRecovery v-if="!auth.isAuthenticated" />
    <p v-else-if="!orders.canUse" class="order-panel">管理员账号不能创建订单。</p>
    <template v-else>
      <p v-if="orders.checkoutNotice" class="auth-notice" role="status">{{ orders.checkoutNotice }}</p>
      <div v-if="orders.checkoutError || metaError" class="order-alert" role="alert"><p>{{ orders.checkoutError || metaError }}</p><button v-if="!orders.draft" class="cart-toolbar-button" :disabled="orders.checkoutLoading" @click="load">重新加载</button></div>
      <div v-if="orders.draft" class="order-panel order-recovery">
        <h2>恢复上一次提交</h2>
        <p>角色：{{ orders.draft.payload.character_name }} · {{ catalog.meta.servers.find(s => s.value === orders.draft.payload.server)?.label || orders.draft.payload.server }}</p>
        <p>已保留 {{ orders.draft.payload.items.length }} 种装备的原始提交。核对或重试会沿用同一提交编号。</p>
        <div class="order-actions">
          <button class="primary-button" :disabled="orders.checkoutLoading" @click="recover">查询提交结果</button>
          <button class="cart-toolbar-button" :disabled="orders.checkoutLoading" @click="submit">重试原订单</button>
          <button v-if="orders.draft.state === 'rejected'" class="cart-toolbar-button" :disabled="orders.checkoutLoading" @click="reconfirm">重新确认购物车</button>
        </div>
      </div>
      <p v-else-if="orders.checkoutLoading" class="order-panel" role="status">正在核验购物车…</p>
      <div v-else-if="orders.confirmation.length" class="order-layout">
        <div class="order-panel"><h2>装备清单</h2><OrderItems :items="orders.confirmation" /><p class="checkout-note">整车结算。库存、价格或购物车内容有变化时，会请你重新确认。</p></div>
        <form class="order-panel auth-form" novalidate @submit.prevent="submit">
          <h2>兑换信息</h2>
          <div class="auth-field"><label for="character-name">游戏角色名</label><input id="character-name" v-model="form.character_name" maxlength="20" autocomplete="off" :disabled="orders.checkoutLoading" :aria-invalid="Boolean(errors.character_name)"><p v-if="errors.character_name" class="auth-error">{{ errors.character_name }}</p></div>
          <div class="auth-field"><label for="game-server">游戏服务器</label><select id="game-server" v-model="form.server" :disabled="orders.checkoutLoading || !catalog.loaded" :aria-invalid="Boolean(errors.server)"><option value="">请选择服务器</option><option v-for="server in catalog.meta.servers" :key="server.value" :value="server.value">{{ server.label }}</option></select><p v-if="errors.server" class="auth-error">{{ errors.server }}</p></div>
          <div class="auth-field"><label for="order-remark">备注（选填）</label><input id="order-remark" v-model="form.remark" maxlength="400" :disabled="orders.checkoutLoading"><p v-if="errors.remark" class="auth-error">{{ errors.remark }}</p></div>
          <p v-if="errors.items" class="auth-error">{{ errors.items }}</p>
          <div class="cart-summary-row"><span>商品总额</span><strong>{{ formatMoney(total) }}</strong></div><div class="cart-summary-row"><span>优惠</span><strong>{{ formatMoney(0) }}</strong></div>
          <div class="cart-summary-total"><span>应付金额</span><strong class="cart-summary-price">{{ formatMoney(total) }}</strong></div>
          <button class="checkout-button" type="submit" :disabled="orders.checkoutLoading || !catalog.loaded">{{ orders.checkoutLoading ? '正在创建订单…' : '提交订单' }}</button>
          <p class="checkout-note">课程项目采用模拟支付。创建订单会占用库存，待支付订单可取消。</p>
        </form>
      </div>
    </template>
  </section>
</template>
