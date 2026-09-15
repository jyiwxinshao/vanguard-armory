<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import SessionRecovery from '../components/SessionRecovery.vue';
import { ElSkeleton } from 'element-plus';
import 'element-plus/es/components/skeleton/style/css';
import EquipmentImage from '../components/EquipmentImage.vue';
import { useCartStore } from '../stores/cart.js';
import { formatMoney } from '../utils/format.js';
import { categoryLabel, rarityMeta } from '../utils/equipment-display.js';
import { cartItemIssue, mergeAdjustmentMessage } from '../utils/cart.js';

const cart = useCartStore();
const router = useRouter();
const selectedIds = ref([]);
const checkoutHint = ref('');

const selectedItems = computed(() => cart.items.filter((item) => selectedIds.value.includes(item.id)));
const allSelected = computed(() => cart.items.length > 0 && selectedItems.value.length === cart.items.length);
const availableItems = computed(() => cart.items.filter((item) => item.available));
const availableQuantity = computed(() => availableItems.value.reduce((sum, item) => sum + item.quantity, 0));
const canChangeQuantity = (item) => item.status === 'on_sale' && item.stock > 0 && cart.canManage;
const refresh = () => cart.fetchCart().catch(() => {});

const loadingEmpty = computed(() => cart.loading && cart.items.length === 0);
const empty = computed(() => !cart.loading && !cart.error && cart.items.length === 0);
const errorEmpty = computed(() => !cart.loading && Boolean(cart.error) && cart.items.length === 0);

function rarityStyle(value) {
  const meta = rarityMeta(value);
  return {
    '--rarity-color': meta.color,
    '--rarity-border': `rgba(${meta.rgb}, 0.38)`,
    '--rarity-badge-bg': `rgba(${meta.rgb}, 0.14)`,
  };
}

function stockLabel(item) {
  if (!item.available) return cartItemIssue(item);
  if (item.stock <= 5) return `仅剩 ${item.stock} 件`;
  return `库存：${item.stock} 件`;
}

function isSelected(id) {
  return selectedIds.value.includes(id);
}

function toggleItem(id) {
  const index = selectedIds.value.indexOf(id);
  if (index >= 0) selectedIds.value.splice(index, 1);
  else if (cart.items.some((item) => item.id === id)) selectedIds.value.push(id);
}

function toggleAll() {
  if (allSelected.value) selectedIds.value = [];
  else selectedIds.value = cart.items.map((item) => item.id);
}

function pruneSelection() {
  const selectable = new Set(cart.items.map((item) => item.id));
  selectedIds.value = selectedIds.value.filter((id) => selectable.has(id));
}

async function changeQuantity(item, delta) {
  if (!canChangeQuantity(item)) return;
  const next = Math.min(item.quantity + delta, item.stock, 9999);
  if (next < 1 || next === item.quantity) return;
  checkoutHint.value = '';
  try { await cart.updateItem(item.id, next); } catch { /* cart.error is shown above */ }
}

async function removeOne(item) {
  checkoutHint.value = '';
  try { await cart.removeItem(item.id); } catch { /* cart.error is shown above */ }
}

async function removeSelected() {
  const ids = selectedItems.value.map((item) => item.id);
  if (!ids.length) return;
  checkoutHint.value = '';
  try {
    await cart.removeItems(ids);
    selectedIds.value = [];
  } catch { /* cart.error is shown above */ }
}

async function clearAll() {
  checkoutHint.value = '';
  try {
    await cart.clear();
    selectedIds.value = [];
  } catch { /* cart.error is shown above */ }
}

function checkout() {
  if (!cart.checkoutAllowed) return;
  if (cart.mode === 'guest') { void router.push({ path: '/login', query: { returnTo: '/cart' } }); return; }
  void router.push('/checkout');
}

onMounted(refresh);
watch(() => cart.scope, () => { selectedIds.value = []; checkoutHint.value = ''; });

watch(() => cart.items, pruneSelection, { immediate: true });
</script>

<template>
  <section class="cart" aria-labelledby="cart-heading">
    <header class="cart-heading">
      <div>
        <p class="cart-kicker">ARMORY REQUISITION // EQUIPMENT LOADOUT</p>
        <h1 id="cart-heading">购物车</h1>
        <p class="cart-subtitle">{{ cart.mode === 'guest' ? '游客购物车保存在本机，登录后合并到账号。' : '检查你的装备配置并准备提交订单。' }}</p>
      </div>

      <div class="cart-toolbar">
        <label class="cart-select-all">
          <input type="checkbox" :checked="allSelected" :disabled="!cart.canManage || cart.items.length === 0" @change="toggleAll">
          <span>全选（已选 {{ selectedItems.length }} / 共 {{ cart.items.length }} 款）</span>
        </label>
        <button type="button" class="cart-toolbar-button cart-toolbar-danger" :disabled="!cart.canManage || selectedItems.length === 0" @click="removeSelected">批量删除已选</button>
        <button type="button" class="cart-toolbar-button" :disabled="!cart.canManage || cart.items.length === 0" @click="clearAll">清空购物车</button>
      </div>
    </header>

    <SessionRecovery v-if="cart.mode === 'pending'" />
    <p v-if="cart.notice" class="checkout-hint" role="status">{{ cart.notice }}</p>
    <p v-if="cart.phase === 'merging'" class="checkout-hint" role="status">正在合并游客购物车，请稍候…</p>
    <div v-if="cart.error" class="cart-error" role="alert">
      <p>{{ cart.error }}</p>
      <p v-if="cart.phase === 'merge-error'">原游客批次已保留，重试会核对同一批次，不会重复增加数量。</p>
      <p v-if="cart.phase === 'merge-rejected'">可以先删除服务器购物车中的装备，再重试合并；游客批次仍保留在本机。</p>
      <button type="button" class="cart-toolbar-button" :disabled="cart.loading" @click="refresh">重新同步购物车</button>
    </div>
    <ul v-if="cart.adjustments.length" class="checkout-hint" aria-label="合并调整说明">
      <li v-for="(adjustment, index) in cart.adjustments" :key="index">{{ mergeAdjustmentMessage(adjustment) }}</li>
    </ul>

    <div v-if="cart.mode === 'pending' || cart.mode === 'admin'" />
    <div v-else-if="loadingEmpty" class="catalog-panel loading-panel" role="status" aria-label="正在加载购物车">
      <ElSkeleton :rows="6" animated />
    </div>

    <div v-else-if="empty" class="cart-empty">
      <p class="cart-empty-kicker">ARMORY REQUISITION // EMPTY</p>
      <h2>购物车还是空的</h2>
      <p>前往先锋军械库挑选武器、护甲与战术装备。</p>
      <RouterLink to="/" class="primary-button">前往装备商城</RouterLink>
    </div>

    <div v-else-if="errorEmpty" class="cart-empty" role="alert">
      <p class="cart-empty-kicker">CONNECTION LOST</p>
      <h2>购物车暂时无法加载</h2>
      <p>{{ cart.error }}</p>
      <button type="button" class="primary-button" @click="refresh">重新加载</button>
    </div>

    <div v-else class="cart-layout">
      <div class="cart-list">
        <div class="cart-list-head" aria-hidden="true">
          <span class="cart-col-identity">装备</span>
          <span class="cart-col-price">单价</span>
          <span class="cart-col-quantity">数量</span>
          <span class="cart-col-subtotal">小计</span>
          <span class="cart-col-delete">操作</span>
        </div>

        <article v-for="item in cart.items" :key="`${cart.scope}:${item.id}`" class="cart-item" :class="{ 'is-unavailable': !item.available }">
          <div class="cart-item-identity">
            <input type="checkbox" class="cart-checkbox" :checked="isSelected(item.id)" :disabled="!cart.canManage" @change="toggleItem(item.id)">
            <div class="cart-item-thumb" :class="{ 'is-unavailable': !item.available }">
              <EquipmentImage :src="item.image" :name="item.name" eager />
            </div>
            <div class="cart-item-info">
              <div class="cart-item-badges">
                <span class="rarity-badge" :style="rarityStyle(item.rarity)">
                  <span class="rarity-dot" aria-hidden="true"></span>{{ item.rarity }} {{ rarityMeta(item.rarity).label }}
                </span>
                <span class="category-badge">{{ categoryLabel(item.category) }}</span>
              </div>
              <h2 class="cart-item-title">{{ item.name }}</h2>
              <p class="cart-item-stock" :class="{ 'is-unavailable': !item.available }">{{ stockLabel(item) }}</p>
            </div>
          </div>

          <div class="cart-item-price">{{ item.status === 'unknown' ? '待核验' : formatMoney(item.price) }}</div>

          <div class="cart-item-quantity">
            <div class="cart-stepper">
              <button type="button" aria-label="减少数量" :disabled="!canChangeQuantity(item) || item.quantity <= 1" @click="changeQuantity(item, -1)">−</button>
              <span>{{ item.quantity }}</span>
              <button type="button" aria-label="增加数量" :disabled="!canChangeQuantity(item) || item.quantity >= Math.min(item.stock, 9999)" @click="changeQuantity(item, 1)">+</button>
            </div>
          </div>

          <div class="cart-item-subtotal">{{ item.status === 'unknown' ? '待核验' : formatMoney(item.subtotal) }}</div>

          <div class="cart-item-delete">
            <button type="button" aria-label="移除装备" :disabled="!cart.canManage" @click="removeOne(item)">×</button>
          </div>
        </article>
      </div>

      <aside class="cart-summary">
        <div class="cart-summary-head">
          <h2>订单摘要</h2>
          <p>EQUIPMENT REQUISITION PROTOCOL</p>
        </div>

        <div class="cart-summary-lines">
          <div class="cart-summary-row">
            <span>可购买装备数量</span>
            <span>{{ availableQuantity }} 件（{{ availableItems.length }} 款装备）</span>
          </div>
          <div class="cart-summary-row">
            <span>可购买商品合计</span>
            <span>{{ formatMoney(cart.availableTotal) }}</span>
          </div>
          <div class="cart-summary-divider" aria-hidden="true"></div>
          <div class="cart-summary-total">
            <div>
              <span>预计商品金额</span>
              <small>ESTIMATED REQUISITION COST</small>
            </div>
            <span class="cart-summary-price">{{ formatMoney(cart.availableTotal) }}</span>
          </div>
        </div>

        <button type="button" class="checkout-button" :disabled="!cart.checkoutAllowed" @click="checkout">{{ cart.mode === 'guest' ? '登录并结算' : '去结算' }}</button>
        <p v-if="checkoutHint" class="checkout-hint" role="status">{{ checkoutHint }}</p>
        <p class="checkout-note">勾选仅用于批量删除。整车装备均可购买后才能结算，价格与库存以服务端最终校验为准。</p>
      </aside>
    </div>
  </section>
</template>
