<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElSkeleton } from 'element-plus';
import 'element-plus/es/components/skeleton/style/css';
import EquipmentImage from '../components/EquipmentImage.vue';
import { getEquipment } from '../api/equipments.js';
import { createLatestRequest } from '../utils/latest-request.js';
import { formatMoney } from '../utils/format.js';
import { categoryLabel, rarityMeta } from '../utils/equipment-display.js';
import { safeCatalogReturn } from '../utils/equipment-query.js';
import { useAuthStore } from '../stores/auth.js';
import { useCartStore } from '../stores/cart.js';

const route = useRoute();
const auth = useAuthStore();
const cart = useCartStore();
const request = createLatestRequest();
const item = ref(null);
const loading = ref(true);
const failed = ref(false);
const unavailable = ref(false);
const quantity = ref(1);
const cartFeedback = ref('');
const adding = ref(false);

const backPath = computed(() => safeCatalogReturn(route.query.returnTo));
const rarity = computed(() => (item.value ? rarityMeta(item.value.rarity) : null));
const soldOut = computed(() => item.value?.stock === 0);
const stockText = computed(() => {
  if (!item.value) return '';
  if (soldOut.value) return '已售罄';
  if (item.value.stock <= 5) return `仅剩 ${item.value.stock} 件`;
  return `库存：${item.value.stock} 件`;
});
const coreAttributes = computed(() => {
  if (!item.value) return [];
  const result = [];
  if (item.value.attack) result.push({ label: '攻击力', value: item.value.attack, note: '基础攻击' });
  if (item.value.defense) result.push({ label: '防御力', value: item.value.defense, note: '基础防御' });
  return result;
});

const cartStatus = computed(() => {
  if (soldOut.value) return '已售罄，暂不可加入购物车';
  if (cartFeedback.value) return cartFeedback.value;
  if (cart.error) return `${cart.error}；可前往购物车重新同步`;
  if (cart.mode === 'guest') return cart.canWrite ? '游客购物车保存在本机，登录后自动合并' : '正在加载游客购物车，请稍候';
  if (!auth.isAuthenticated) return '请先完成身份验证';
  if (!cart.canWrite && cart.mode !== 'admin') return '购物车同步尚未完成，请前往购物车重试';
  if (auth.user?.role !== 'user') return '当前账号不能加入购物车';
  return '选择数量后加入购物车';
});

const detailStyle = computed(() => {
  const meta = rarity.value;
  if (!meta) return {};
  return {
    '--detail-rarity-rgb': meta.rgb,
    '--detail-rarity-color': meta.color,
    '--detail-rarity-border': `rgba(${meta.rgb}, 0.38)`,
    '--detail-rarity-badge-bg': `rgba(${meta.rgb}, 0.14)`,
  };
});

function clampQuantity(value) {
  if (!item.value) return 1;
  return Math.min(Math.max(Math.floor(Number(value)) || 1, 1), item.value.stock, 9999);
}

function decrease() {
  if (soldOut.value) return;
  quantity.value = Math.max(1, quantity.value - 1);
}

function increase() {
  if (soldOut.value) return;
  quantity.value = Math.min(item.value.stock, 9999, quantity.value + 1);
}

async function addToCart() {
  if (!item.value || soldOut.value || adding.value || !cart.canWrite) return;
  quantity.value = clampQuantity(quantity.value);
  const snapshot = { ...item.value };
  const count = quantity.value;
  const scope = cart.scope;
  const stillCurrent = () => item.value?.id === snapshot.id && cart.scope === scope;
  adding.value = true;
  try {
    await cart.addItem(snapshot.id, count, snapshot);
    if (stillCurrent()) cartFeedback.value = `已加入购物车：${snapshot.name} × ${count}`;
  } catch {
    if (stillCurrent()) cartFeedback.value = cart.error || '加入购物车失败，请稍后重试';
  } finally {
    adding.value = false;
  }
}

function load() {
  return request.run(
    (signal) => getEquipment(route.params.id, { signal }),
    {
      onStart: () => {
        loading.value = true;
        failed.value = false;
        unavailable.value = false;
        item.value = null;
        cartFeedback.value = '';
      },
      onSuccess: (value) => {
        item.value = value;
        quantity.value = 1;
      },
      onError: (error) => {
        unavailable.value = [404, 422].includes(error.response?.status);
        failed.value = !unavailable.value;
      },
      onFinish: () => { loading.value = false; },
    },
  );
}

watch(() => route.params.id, () => { void load(); }, { immediate: true });
watch(() => cart.scope, () => { cartFeedback.value = ''; });
onUnmounted(() => request.dispose());
</script>

<template>
  <section class="detail" :style="detailStyle" aria-labelledby="detail-heading">
    <nav class="detail-breadcrumb" aria-label="面包屑">
      <RouterLink :to="backPath" class="detail-back">
        <span class="detail-back-arrow" aria-hidden="true">←</span>
        返回装备商城
      </RouterLink>
      <div class="breadcrumb-path" aria-label="当前位置">
        <RouterLink :to="backPath" class="breadcrumb-link">装备商城</RouterLink>
        <template v-if="item">
          <span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-text">{{ categoryLabel(item.category) }}</span>
          <span class="breadcrumb-sep" aria-hidden="true">/</span>
          <span class="breadcrumb-current">{{ item.name }}</span>
        </template>
      </div>
    </nav>

    <div v-if="loading" class="catalog-panel loading-panel" role="status" aria-label="正在加载装备详情">
      <ElSkeleton :rows="7" animated />
    </div>

    <div v-else-if="unavailable" class="catalog-panel empty-panel" role="alert">
      <p class="empty-kicker">EQUIPMENT OFFLINE</p>
      <h1 id="detail-heading">装备不存在或已下架</h1>
      <p>可以返回商城查看其他装备。</p>
      <RouterLink :to="backPath" class="primary-button">返回装备商城</RouterLink>
    </div>

    <div v-else-if="failed" class="catalog-panel empty-panel" role="alert">
      <p class="empty-kicker">CONNECTION LOST</p>
      <h1 id="detail-heading">装备暂时无法加载</h1>
      <p>商城连接暂时不可用，请稍后重试。</p>
      <button type="button" class="primary-button" @click="load">重新加载</button>
    </div>

    <template v-else-if="item">
      <div class="detail-layout">
        <div class="detail-showcase">
          <div class="showcase-topbar">
            <span v-if="rarity" class="rarity-badge">
              <span class="rarity-dot" aria-hidden="true"></span>
              {{ item.rarity }} {{ rarity.label }}
            </span>
            <span class="category-badge">{{ categoryLabel(item.category) }}</span>
          </div>

          <div class="showcase-viewport">
            <svg class="showcase-grid" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              <defs>
                <pattern id="detail-tactical-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" stroke-width="0.5"></path>
                </pattern>
              </defs>
              <rect width="800" height="600" fill="url(#detail-tactical-grid)"></rect>
              <circle cx="400" cy="300" r="132" fill="none" stroke="currentColor" stroke-dasharray="4 5" stroke-width="1"></circle>
              <circle cx="400" cy="300" r="210" fill="none" stroke="currentColor" stroke-width="0.75"></circle>
            </svg>
            <EquipmentImage :src="item.image" :name="item.name" eager />
          </div>
        </div>

        <div class="detail-console">
          <div class="console-head">
            <span class="console-kicker">VANGUARD ARMORY // EQUIPMENT</span>
            <span class="console-stock" :class="{ 'is-low': item.stock > 0 && item.stock <= 5, 'is-sold-out': soldOut }">
              <span class="stock-dot" aria-hidden="true"></span>{{ stockText }}
            </span>
          </div>

          <h1 id="detail-heading">{{ item.name }}</h1>
          <p class="console-category">{{ categoryLabel(item.category) }}</p>

          <div class="price-panel">
            <span class="price-label">销售价格</span>
            <span class="detail-price">{{ formatMoney(item.price) }}</span>
          </div>

          <div class="attributes-heading">核心基础属性 // ATTRIBUTES</div>
          <div class="attributes-grid">
            <template v-if="coreAttributes.length">
              <div v-for="attribute in coreAttributes" :key="attribute.label" class="attribute-stat">
                <span class="attribute-stat-label">{{ attribute.label }}</span>
                <span class="attribute-stat-value">{{ attribute.value }} <small>{{ attribute.note }}</small></span>
              </div>
            </template>
            <div v-else class="attribute-stat">
              <span class="attribute-stat-label">攻击 / 防御</span>
              <span class="attribute-stat-value">未配置 <small>基础属性</small></span>
            </div>
          </div>

          <div class="purchase-row">
            <span class="purchase-label">购买数量</span>
            <div class="quantity-stepper" :class="{ 'is-sold-out': soldOut }">
              <button type="button" aria-label="减少数量" :disabled="soldOut || quantity <= 1" @click="decrease">−</button>
              <span class="quantity-value">{{ soldOut ? '—' : quantity }}</span>
              <button type="button" aria-label="增加数量" :disabled="soldOut || quantity >= Math.min(item.stock, 9999)" @click="increase">+</button>
            </div>
            <span class="purchase-stock">{{ stockText }}</span>
          </div>

          <button type="button" class="add-cart-button" :disabled="soldOut || adding || !cart.canWrite" @click="addToCart">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M3 4h2l2.2 9.3a1.6 1.6 0 0 0 1.6 1.2h7.6a1.6 1.6 0 0 0 1.6-1.2L20 8H6.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="9.5" cy="19.5" r="1.2" fill="currentColor"/>
              <circle cx="16.5" cy="19.5" r="1.2" fill="currentColor"/>
            </svg>
            {{ adding ? '正在加入…' : '加入购物车' }}
          </button>
          <p class="cart-status" :class="{ 'is-sold-out': soldOut }" role="status">{{ cartStatus }}</p>
        </div>
      </div>

      <section class="detail-dossier" aria-labelledby="dossier-heading">
        <div class="dossier-heading">
          <span class="dossier-accent" aria-hidden="true"></span>
          <h2 id="dossier-heading">装备档案与参数</h2>
          <span class="dossier-kicker">// DOSSIER &amp; PARAMETER MATRIX</span>
        </div>

        <div class="dossier-description">
          <span class="dossier-label">装备介绍</span>
          <p>{{ item.description || '暂无装备说明。' }}</p>
        </div>

        <div class="dossier-grid">
          <div class="dossier-item">
            <span>装备分类 // CATEGORY</span>
            <strong>{{ categoryLabel(item.category) }}</strong>
          </div>
          <div class="dossier-item">
            <span>稀有度评级 // RARITY</span>
            <strong v-if="rarity" :style="{ color: rarity.color }">{{ item.rarity }} {{ rarity.label }}</strong>
          </div>
          <div class="dossier-item">
            <span>基础攻击力 // ATTACK</span>
            <strong>{{ item.attack }} 点</strong>
          </div>
          <div class="dossier-item">
            <span>基础防御力 // DEFENSE</span>
            <strong>{{ item.defense }} 点</strong>
          </div>
          <div class="dossier-item">
            <span>当前可用库存 // STOCK</span>
            <strong>{{ item.stock }} 件</strong>
          </div>
          <div class="dossier-item">
            <span>销售价格 // PRICE</span>
            <strong>{{ formatMoney(item.price) }}</strong>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>
