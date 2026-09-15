<script setup>
import { computed, ref } from 'vue';
import EquipmentImage from './EquipmentImage.vue';
import { formatMoney } from '../utils/format.js';
import { canQuickAdd, categoryLabel, isNewItem, rarityMeta } from '../utils/equipment-display.js';
import { useCartStore } from '../stores/cart.js';
import { notify } from '../utils/notify.js';

const props = defineProps({
  item: { type: Object, required: true },
  returnTo: { type: String, default: '/' },
});

const cart = useCartStore();
const adding = ref(false);
const rarity = computed(() => rarityMeta(props.item.rarity));
const detailPath = computed(() => `/equipments/${props.item.id}`);
const soldOut = computed(() => props.item.stock === 0);
const isNew = computed(() => isNewItem(props.item));
const cartQuantity = computed(() => cart.items.reduce((total, row) => (row.equipment_id === props.item.id ? total + row.quantity : total), 0));
const fullyAdded = computed(() => props.item.stock > 0 && cartQuantity.value >= props.item.stock);
const quickAddDisabled = computed(() => !canQuickAdd(props.item, cart.canWrite) || adding.value || fullyAdded.value);

const attributes = computed(() => {
  const result = [];
  if (props.item.attack) result.push({ label: '攻击', value: props.item.attack });
  if (props.item.defense) result.push({ label: '防御', value: props.item.defense });
  return result;
});

const stockText = computed(() => {
  if (soldOut.value) return '已售罄';
  if (props.item.stock <= 5) return `仅剩 ${props.item.stock} 件`;
  return `库存：${props.item.stock} 件`;
});

const stockClass = computed(() => {
  if (soldOut.value) return 'is-sold-out';
  if (props.item.stock <= 5) return 'is-low';
  return 'is-available';
});

const style = computed(() => ({
  '--rarity-color': rarity.value.color,
  '--rarity-border': `rgba(${rarity.value.rgb}, 0.38)`,
  '--rarity-tint': `rgba(${rarity.value.rgb}, 0.10)`,
  '--rarity-badge-bg': `rgba(${rarity.value.rgb}, 0.14)`,
}));

async function quickAdd() {
  if (quickAddDisabled.value) return;
  adding.value = true;
  try {
    await cart.addItem(props.item.id, 1, props.item);
    notify.success('已加入购物车');
  } catch {
    notify.error(cart.error || '加入购物车失败，请稍后重试');
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <article class="equipment-card" :class="{ 'is-sold-out': soldOut }" :style="style">
    <div class="card-meta">
      <span class="rarity-badge">
        <span class="rarity-dot" aria-hidden="true"></span>
        {{ item.rarity }} {{ rarity.label }}
      </span>
      <span class="category-badge">{{ categoryLabel(item.category) }}</span>
    </div>

    <RouterLink :to="{ path: detailPath, query: { returnTo } }" class="card-image" :aria-label="`查看 ${item.name} 详情`">
      <EquipmentImage :src="item.image" :name="item.name" />
      <span v-if="isNew" class="card-new-badge">NEW</span>
      <span v-if="soldOut" class="sold-out-stamp">已售罄</span>
    </RouterLink>

    <div class="card-body">
      <RouterLink :to="{ path: detailPath, query: { returnTo } }" class="card-name">{{ item.name }}</RouterLink>

      <div v-if="attributes.length" class="card-attributes">
        <span v-for="attribute in attributes" :key="attribute.label" class="attribute-chip">
          {{ attribute.label }} <b>{{ attribute.value }}</b>
        </span>
      </div>

      <p class="card-stock" :class="stockClass">
        <span class="stock-dot" aria-hidden="true"></span>{{ stockText }}
      </p>

      <div class="card-footer">
        <span class="card-price">{{ formatMoney(item.price) }}</span>
        <div class="card-actions">
          <button
            type="button"
            class="card-add-icon"
            :class="{ 'is-sold-out': soldOut, 'is-full': fullyAdded, 'is-busy': adding }"
            :disabled="quickAddDisabled"
            :aria-label="soldOut ? '已售罄' : '加入购物车'"
            @click="quickAdd"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M3 4h2l2.2 9.3a1.6 1.6 0 0 0 1.6 1.2h7.6a1.6 1.6 0 0 0 1.6-1.2L20 8H6.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="9.5" cy="19.5" r="1.2" fill="currentColor"/>
              <circle cx="16.5" cy="19.5" r="1.2" fill="currentColor"/>
            </svg>
            <span v-if="cartQuantity > 0" class="card-add-count">{{ cartQuantity }}</span>
          </button>
          <RouterLink :to="{ path: detailPath, query: { returnTo } }" class="card-action">查看详情</RouterLink>
        </div>
      </div>
    </div>
  </article>
</template>
