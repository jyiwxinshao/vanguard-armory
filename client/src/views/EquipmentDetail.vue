<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElDialog, ElSkeleton } from 'element-plus';
import 'element-plus/es/components/skeleton/style/css';
import 'element-plus/es/components/dialog/style/css';
import EquipmentImage from '../components/EquipmentImage.vue';
import { getEquipment } from '../api/equipments.js';
import { createLatestRequest } from '../utils/latest-request.js';
import { formatMoney } from '../utils/format.js';
import { categoryLabel, rarityMeta } from '../utils/equipment-display.js';
import { safeCatalogReturn } from '../utils/equipment-query.js';
import { loginLocation } from '../utils/auth.js';
import { useAuthStore } from '../stores/auth.js';
import { useCartStore } from '../stores/cart.js';
import { notify } from '../utils/notify.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const cart = useCartStore();
const request = createLatestRequest();
const item = ref(null);
const loading = ref(true);
const failed = ref(false);
const unavailable = ref(false);
const quantity = ref(1);
const adding = ref(false);
const imagePreviewOpen = ref(false);

const backPath = computed(() => safeCatalogReturn(route.query.returnTo));
const rarity = computed(() => (item.value ? rarityMeta(item.value.rarity) : null));
const soldOut = computed(() => item.value?.stock === 0);
const canAdd = computed(() => auth.status === 'anonymous' || cart.canWrite);
const stockText = computed(() => {
  if (!item.value) return '';
  if (soldOut.value) return '已售罄';
  if (item.value.stock <= 5) return `仅剩 ${item.value.stock} 件`;
  return `库存：${item.value.stock} 件`;
});
const coreAttributes = computed(() => {
  if (!item.value || (!item.value.attack && !item.value.defense)) return [];
  return [
    { key: 'attack', label: '攻击力', value: item.value.attack, note: item.value.attack ? '基础攻击' : '无攻击加成' },
    { key: 'defense', label: '防御力', value: item.value.defense, note: item.value.defense ? '基础防御' : '无防御加成' },
  ];
});
const rarityEnglish = computed(() => ({ SSR: 'LEGENDARY', SR: 'EPIC', R: 'RARE', N: 'COMMON' })[item.value?.rarity] || 'COMMON');

const detailStyle = computed(() => {
  const meta = rarity.value;
  if (!meta) return {};
  return {
    '--rarity-color': meta.color,
    '--rarity-border': `rgba(${meta.rgb}, 0.38)`,
    '--rarity-tint': `rgba(${meta.rgb}, 0.12)`,
    '--rarity-badge-bg': `rgba(${meta.rgb}, 0.14)`,
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
  if (!item.value || soldOut.value || adding.value || !canAdd.value) return;
  if (!auth.isAuthenticated) { await router.push(loginLocation(route.fullPath)); return; }
  quantity.value = clampQuantity(quantity.value);
  const snapshot = { ...item.value };
  const count = quantity.value;
  const scope = cart.scope;
  const stillCurrent = () => item.value?.id === snapshot.id && cart.scope === scope;
  adding.value = true;
  try {
    await cart.addItem(snapshot.id, count);
    if (stillCurrent()) {
      notify.success(`已加入购物车：${snapshot.name} × ${count}`);
    }
  } catch {
    if (stillCurrent()) {
      notify.error(cart.error || '加入购物车失败，请稍后重试');
    }
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
        imagePreviewOpen.value = false;
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
              {{ item.rarity }} {{ rarity.label }} <span class="rarity-english">// {{ rarityEnglish }}</span>
            </span>
            <span class="category-badge">{{ categoryLabel(item.category) }}</span>
            <button type="button" class="showcase-expand" aria-label="查看装备大图" title="查看装备大图" @click="imagePreviewOpen = true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" /></svg>
            </button>
          </div>

          <div class="showcase-viewport">
            <EquipmentImage :src="item.image" :name="item.name" eager />
          </div>
        </div>

        <div class="detail-console">
          <div class="console-head">
            <div class="console-head-left">
              <span class="console-kicker">VANGUARD ARMORY // EQUIPMENT</span>
              <span v-if="item.is_new" class="detail-new-badge">NEW</span>
            </div>
            <span class="console-stock" :class="{ 'is-low': item.stock > 0 && item.stock <= 5, 'is-sold-out': soldOut }">
              <span class="stock-dot" aria-hidden="true"></span>{{ stockText }}
            </span>
          </div>

          <h1 id="detail-heading">{{ item.name }}</h1>
          <p class="console-category">{{ categoryLabel(item.category) }} <span aria-hidden="true">/</span> {{ rarity.label }}品质</p>

          <div class="price-panel">
            <span class="price-label">销售价格 <span class="price-unit">CNY / 件</span></span>
            <span class="detail-price">{{ formatMoney(item.price) }}</span>
          </div>

          <div class="detail-attributes">
            <h2 class="attributes-heading">核心基础属性 <span>// ATTRIBUTES</span></h2>
            <div v-if="coreAttributes.length" class="attributes-grid">
              <div v-for="attribute in coreAttributes" :key="attribute.key" class="attribute-stat" :class="{ 'is-empty': !attribute.value }">
                <div class="attribute-stat-top"><span>{{ attribute.label }}</span>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                    <path v-if="attribute.key === 'attack'" d="m14 2-9 12h6l-1 8 9-13h-6l1-7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                    <path v-else d="m12 3 7 3v5c0 5-4 8-7 10-3-2-7-5-7-10V6l7-3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                  </svg>
                </div>
                <span class="attribute-stat-value">{{ attribute.value }} <small>{{ attribute.note }}</small></span>
              </div>
            </div>
            <div v-else class="attribute-effect"><span>装备效果</span><p>{{ item.description || '此装备不提供基础攻击或防御加成。' }}</p></div>
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

          <button type="button" class="add-cart-button" :disabled="soldOut || adding || !canAdd" @click="addToCart">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M3 4h2l2.2 9.3a1.6 1.6 0 0 0 1.6 1.2h7.6a1.6 1.6 0 0 0 1.6-1.2L20 8H6.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="9.5" cy="19.5" r="1.2" fill="currentColor"/>
              <circle cx="16.5" cy="19.5" r="1.2" fill="currentColor"/>
            </svg>
            {{ soldOut ? '已售罄' : adding ? '正在加入…' : '加入购物车' }}
          </button>
        </div>
      </div>

      <section class="detail-dossier" aria-labelledby="dossier-heading">
        <header class="dossier-heading"><h2 id="dossier-heading">装备档案与参数</h2><span>// DOSSIER &amp; PARAMETER MATRIX</span></header>
        <div class="dossier-description">
          <h3><svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>装备介绍</h3>
          <p>{{ item.description || '暂无装备说明。' }}</p>
        </div>
        <dl class="dossier-grid">
          <div class="dossier-item"><dt>装备分类 <span>// CATEGORY</span></dt><dd>{{ categoryLabel(item.category) }}</dd><small>游戏装备</small></div>
          <div class="dossier-item"><dt>稀有度评级 <span>// RARITY</span></dt><dd class="dossier-rarity">{{ item.rarity }} {{ rarity.label }}</dd><small class="dossier-rarity">{{ rarityEnglish }} TIER</small></div>
          <div class="dossier-item"><dt>基础攻击力 <span>// ATTACK</span></dt><dd>{{ item.attack }} 点</dd><small>{{ item.attack ? '基础攻击加成' : '无基础攻击加成' }}</small></div>
          <div class="dossier-item"><dt>基础防御力 <span>// DEFENSE</span></dt><dd>{{ item.defense }} 点</dd><small>{{ item.defense ? '基础防御加成' : '无基础防御加成' }}</small></div>
          <div class="dossier-item"><dt>当前可用库存 <span>// STOCK</span></dt><dd>{{ item.stock }} 件</dd><small :class="{ 'dossier-warning': soldOut || item.stock <= 5 }">{{ soldOut ? '暂时无货' : item.stock <= 5 ? '库存有限，请按需选购' : '下单时重新核验库存' }}</small></div>
          <div class="dossier-item"><dt>销售状态 <span>// STATUS</span></dt><dd>{{ soldOut ? '暂时售罄' : '正常在售' }}</dd><small>{{ soldOut ? '可继续浏览其他装备' : '加入购物车后确认下单' }}</small></div>
        </dl>
      </section>

      <ElDialog v-model="imagePreviewOpen" :title="item.name" class="equipment-preview" width="min(1000px, 92vw)" align-center destroy-on-close>
        <EquipmentImage :src="item.image" :name="item.name" eager />
      </ElDialog>
    </template>
  </section>
</template>
