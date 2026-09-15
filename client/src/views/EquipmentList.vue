<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElPagination, ElSkeleton } from 'element-plus';
import 'element-plus/es/components/pagination/style/css';
import 'element-plus/es/components/skeleton/style/css';
import EquipmentCard from '../components/EquipmentCard.vue';
import EquipmentFilters from '../components/EquipmentFilters.vue';
import { getEquipments } from '../api/equipments.js';
import { createLatestRequest } from '../utils/latest-request.js';
import { equipmentQueryToParams, equipmentQueryToRoute, keywordIssue, lastEquipmentPage, parseEquipmentQuery, updateEquipmentQuery } from '../utils/equipment-query.js';

const route = useRoute();
const router = useRouter();
const request = createLatestRequest();

const items = ref([]);
const total = ref(0);
const loading = ref(true);
const failed = ref(false);
const keywordInput = ref('');
const searchError = ref('');
const navigationError = ref('');
const composing = ref(false);
let keywordTimer;

const filters = computed(() => parseEquipmentQuery(route.query));
const returnTo = computed(() => route.fullPath);
const hasFilters = computed(() => Boolean(filters.value.keyword || filters.value.category || filters.value.rarities.length || filters.value.in_stock || filters.value.sort !== 'newest'));
let desiredFilters = filters.value;

function sameQuery(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushQuery(overrides = {}) {
  window.clearTimeout(keywordTimer);
  searchError.value = keywordIssue(overrides.keyword ?? keywordInput.value);
  if (searchError.value) return;
  desiredFilters = updateEquipmentQuery(desiredFilters, { keyword: keywordInput.value, ...overrides });
  const next = equipmentQueryToRoute(desiredFilters);
  if (sameQuery(next, equipmentQueryToRoute(filters.value))) return;
  navigationError.value = '';
  router.push({ path: '/', query: next }).catch(() => {
    desiredFilters = filters.value;
    navigationError.value = '筛选条件暂时无法更新，请重试';
  });
}

function scheduleKeyword() {
  window.clearTimeout(keywordTimer);
  if (composing.value) return;
  keywordTimer = window.setTimeout(() => pushQuery(), 300);
}

function load() {
  const currentFilters = filters.value;
  return request.run(
    (signal) => getEquipments(equipmentQueryToParams(currentFilters), { signal }),
    {
      onStart: () => {
        loading.value = true;
        failed.value = false;
      },
      onSuccess: (result) => {
        items.value = result.items;
        total.value = result.total;
        const lastPage = lastEquipmentPage(result.total, currentFilters.page_size);
        if (currentFilters.page > lastPage) {
          void router.replace({ path: '/', query: equipmentQueryToRoute({ ...currentFilters, page: lastPage }) }).catch(() => {
            navigationError.value = '页码暂时无法更新，请重新筛选';
          });
        }
      },
      onError: () => { failed.value = true; },
      onFinish: () => { loading.value = false; },
    },
  );
}

function updateKeyword(value) {
  keywordInput.value = value;
  searchError.value = keywordIssue(value);
  scheduleKeyword();
}

function submitKeyword() {
  if (composing.value) return;
  window.clearTimeout(keywordTimer);
  pushQuery();
}

function changeComposition(value) {
  composing.value = value;
  window.clearTimeout(keywordTimer);
  if (!value) scheduleKeyword();
}

function changeCategory(value) {
  window.clearTimeout(keywordTimer);
  pushQuery({ category: value, page: 1 });
}

function changeRarities(value) {
  window.clearTimeout(keywordTimer);
  pushQuery({ rarities: value, page: 1 });
}

function changeSort(value) {
  window.clearTimeout(keywordTimer);
  pushQuery({ sort: value, page: 1 });
}

function changePage(value) { pushQuery({ page: value }); }
function changePageSize(value) { pushQuery({ page_size: value, page: 1 }); }
function clearFilters() {
  keywordInput.value = '';
  searchError.value = '';
  pushQuery({ keyword: '', category: '', rarities: [], sort: 'newest', in_stock: false, page: 1 });
}

watch(filters, () => {
  window.clearTimeout(keywordTimer);
  desiredFilters = filters.value;
  keywordInput.value = filters.value.keyword;
  searchError.value = '';
  void load();
}, { immediate: true });

onUnmounted(() => {
  window.clearTimeout(keywordTimer);
  request.dispose();
});
</script>

<template>
  <section class="catalog" aria-labelledby="catalog-heading">
    <header class="catalog-heading">
      <div>
        <p class="catalog-kicker">VANGUARD ARMORY</p>
        <h1 id="catalog-heading">装备商城</h1>
        <p class="catalog-subtitle">探索稀有武器、护甲与战术装备，打造你的专属配置</p>
      </div>
      <p v-if="!loading && !failed" class="item-count">
        <template v-if="filters.in_stock">共 {{ total }} 件有库存装备</template>
        <template v-else>共 {{ total }} 件装备</template>
      </p>
    </header>

    <EquipmentFilters
      :keyword="keywordInput"
      :category="filters.category"
      :rarities="filters.rarities"
      :sort="filters.sort"
      :in-stock-only="filters.in_stock"
      :search-error="searchError"
      :can-clear="hasFilters || Boolean(keywordInput)"
      @update:keyword="updateKeyword"
      @submit="submitKeyword"
      @composition="changeComposition"
      @update:category="changeCategory"
      @update:rarities="changeRarities"
      @update:sort="changeSort"
      @update:in-stock-only="pushQuery({ in_stock: $event, page: 1 })"
      @clear="clearFilters"
    />
    <p v-if="navigationError" class="auth-error" role="alert">{{ navigationError }}</p>

    <div v-if="loading" class="catalog-panel loading-panel" role="status" aria-label="正在加载装备">
      <ElSkeleton :rows="6" animated />
    </div>

    <div v-else-if="failed" class="catalog-panel empty-panel" role="alert">
      <p class="empty-kicker">CONNECTION LOST</p>
      <h2>装备暂时无法加载</h2>
      <p>请稍后再试，或重新连接商城。</p>
      <button type="button" class="primary-button" @click="load">重新加载</button>
    </div>

    <div v-else-if="total === 0" class="catalog-panel empty-panel">
      <p class="empty-kicker">NO RESULTS</p>
      <h2>{{ hasFilters ? '没有符合条件的装备' : '暂无在售装备' }}</h2>
      <p>{{ hasFilters ? '可以尝试其他名称，或清除筛选重新查找。' : '新的战术装备准备好后，会在这里展示。' }}</p>
      <button v-if="hasFilters" type="button" class="primary-button" @click="clearFilters">清除筛选</button>
      <button v-else type="button" class="primary-button" @click="load">刷新目录</button>
    </div>

    <div v-else-if="items.length === 0" class="catalog-panel empty-panel">
      <h2>该页暂无装备</h2>
      <p>装备数量可能发生了变化，请返回第一页查看。</p>
      <button type="button" class="primary-button" @click="pushQuery({ page: 1 })">返回第一页</button>
    </div>

    <template v-else>
      <div class="equipment-grid">
        <EquipmentCard v-for="item in items" :key="item.id" :item="item" :return-to="returnTo" />
      </div>

      <div class="pagination-wrap">
        <ElPagination
          :current-page="filters.page"
          :page-size="filters.page_size"
          :page-sizes="[8, 12, 16]"
          :total="total"
          :pager-count="5"
          layout="prev, pager, next, sizes"
          background
          @update:current-page="changePage"
          @update:page-size="changePageSize"
        />
      </div>
    </template>
  </section>
</template>
