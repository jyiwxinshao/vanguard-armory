<script setup>
import { computed } from 'vue';
import EquipmentImage from './EquipmentImage.vue';
import { formatMoney } from '../utils/format.js';
import { categoryLabel, rarityMeta } from '../utils/equipment-display.js';

const props = defineProps({
  item: { type: Object, required: true },
  returnTo: { type: String, default: '/' },
});

const rarity = computed(() => rarityMeta(props.item.rarity));
const detailPath = computed(() => `/equipments/${props.item.id}`);
const soldOut = computed(() => props.item.stock === 0);

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
        <RouterLink :to="{ path: detailPath, query: { returnTo } }" class="card-action">查看详情</RouterLink>
      </div>
    </div>
  </article>
</template>
