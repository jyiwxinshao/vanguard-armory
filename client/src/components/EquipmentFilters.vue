<script setup>
import { CATEGORY_META, RARITY_META } from '../utils/equipment-display.js';

const props = defineProps({
  keyword: { type: String, default: '' },
  category: { type: String, default: '' },
  rarities: { type: Array, default: () => [] },
  sort: { type: String, default: 'newest' },
  inStockOnly: { type: Boolean, default: false },
  searchError: { type: String, default: '' },
  canClear: { type: Boolean, default: false },
});

const emit = defineEmits(['update:keyword', 'submit', 'composition', 'clear', 'update:category', 'update:rarities', 'update:sort', 'update:inStockOnly']);
let composing = false;
function startComposition() { composing = true; emit('composition', true); }
function endComposition(event) {
  composing = false;
  emit('update:keyword', event.target.value);
  emit('composition', false);
}
function submit(event) {
  if (!composing && !event.isComposing && event.keyCode !== 229) emit('submit');
}

const categories = [{ value: '', label: '全部' }, ...CATEGORY_META];
const sorts = [
  { value: 'newest', label: '默认排序' },
  { value: 'price_asc', label: '价格升序' },
  { value: 'price_desc', label: '价格降序' },
  { value: 'rarity_desc', label: '稀有度排序' },
];

function toggleRarity(value) {
  const next = new Set(props.rarities);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  emit('update:rarities', RARITY_META.map((item) => item.value).filter((item) => next.has(item)));
}
</script>

<template>
  <section class="filter-panel" aria-label="装备搜索与筛选">
    <div class="filter-row filter-row-main">
      <label class="search-field" for="equipment-search">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          id="equipment-search"
          type="search"
          :value="keyword"
          placeholder="搜索装备名称…"
          autocomplete="off"
          aria-label="搜索装备名称"
          :aria-invalid="Boolean(searchError)"
          :aria-describedby="searchError ? 'equipment-search-error' : undefined"
          @input="emit('update:keyword', $event.target.value)"
          @compositionstart="startComposition"
          @compositionend="endComposition"
          @keydown.enter="submit"
        >
      </label>

      <div class="category-tabs" role="group" aria-label="装备分类">
        <button
          v-for="option in categories"
          :key="option.value"
          type="button"
          class="category-tab"
          :class="{ 'is-active': category === option.value }"
          :aria-pressed="category === option.value"
          @click="emit('update:category', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="filter-row filter-row-sub">
      <div class="rarity-group">
        <span class="filter-label">稀有度</span>
        <div class="rarity-chips">
          <button
            v-for="rarity in RARITY_META"
            :key="rarity.value"
            type="button"
            class="rarity-chip"
            :class="{ 'is-active': rarities.includes(rarity.value) }"
            :style="{ '--rarity-color': rarity.color, '--rarity-rgb': rarity.rgb }"
            :aria-pressed="rarities.includes(rarity.value)"
            @click="toggleRarity(rarity.value)"
          >
            <span class="rarity-dot" aria-hidden="true"></span>
            {{ rarity.value }} {{ rarity.label }}
          </button>
        </div>
      </div>

      <div class="filter-controls">
        <button v-if="canClear" type="button" class="category-tab" @click="emit('clear')">清除筛选</button>
        <label class="stock-toggle">
          <input
            type="checkbox"
            :checked="inStockOnly"
            @change="emit('update:inStockOnly', $event.target.checked)"
          >
          <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
          <span class="toggle-label">仅显示有库存</span>
        </label>

        <label class="sort-field">
          <span class="sort-icon" aria-hidden="true">↕</span>
          <select :value="sort" @change="emit('update:sort', $event.target.value)">
            <option v-for="option in sorts" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
      </div>
    </div>
    <p v-if="searchError" id="equipment-search-error" class="auth-error" role="alert">{{ searchError }}</p>
  </section>
</template>
