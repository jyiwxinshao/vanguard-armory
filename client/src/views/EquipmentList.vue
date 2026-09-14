<script setup>
import { onMounted, ref } from 'vue';
import { ElButton, ElPagination, ElSkeleton } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/pagination/style/css';
import 'element-plus/es/components/skeleton/style/css';
import { getEquipments, getHealth } from '../api/equipments.js';
import { useCatalogStore } from '../stores/catalog.js';
import { formatMoney } from '../utils/format.js';

const catalog = useCatalogStore();
const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(12);
const loading = ref(true);
const failed = ref(false);
let requestId = 0;

async function loadItems() {
  const current = ++requestId;
  loading.value = true;
  failed.value = false;
  try {
    await Promise.all([getHealth(), catalog.load()]);
    const result = await getEquipments(page.value, pageSize.value);
    if (current !== requestId) return;
    items.value = result.items;
    total.value = result.total;
  } catch {
    if (current !== requestId) return;
    failed.value = true;
  } finally {
    if (current === requestId) loading.value = false;
  }
}

function changePage(value) { page.value = value; void loadItems(); }
function changeSize(value) { pageSize.value = value; page.value = 1; void loadItems(); }
onMounted(loadItems);
</script>

<template>
  <section aria-labelledby="catalog-heading">
    <div class="catalog-heading">
      <div><p class="eyebrow">远征物资</p><h1 id="catalog-heading">装备目录</h1></div>
      <p v-if="!loading && !failed" class="item-count">{{ total }} 件装备</p>
    </div>

    <div v-if="loading" class="catalog-panel loading-panel" role="status" aria-label="正在加载装备">
      <ElSkeleton :rows="6" animated />
    </div>
    <div v-else-if="failed" class="catalog-panel empty-panel" role="alert">
      <h2>装备暂时无法加载</h2>
      <p>请稍后再试，或重新连接商城。</p>
      <ElButton type="primary" @click="loadItems">重新加载</ElButton>
    </div>
    <div v-else-if="total === 0" class="catalog-panel empty-panel">
      <h2>暂无在售装备</h2><p>新的远征物资准备好后，会在这里展示。</p>
      <ElButton @click="loadItems">刷新目录</ElButton>
    </div>
    <template v-else>
      <div class="catalog-panel">
        <div class="list-heading" aria-hidden="true"><span>装备与属性</span><span>价格</span><span>可售库存</span></div>
        <ul class="equipment-list">
          <li v-for="item in items" :key="item.id" class="equipment-row" :class="{ 'sold-out': item.stock === 0 }">
            <div class="equipment-info">
              <div class="equipment-title">
                <span class="rarity-tag" :style="{ '--rarity-color': catalog.rarity(item.rarity)?.color || '#FFFFFF' }">
                  {{ item.rarity }} · {{ catalog.rarity(item.rarity)?.label }}
                </span>
                <span class="category-label">{{ catalog.category(item.category) }}</span>
              </div>
              <h2>{{ item.name }}</h2>
              <p class="equipment-description">{{ item.description }}</p>
              <div v-if="item.attack || item.defense" class="attributes">
                <span v-if="item.attack">攻击 <b>{{ item.attack }}</b></span>
                <span v-if="item.defense">防御 <b>{{ item.defense }}</b></span>
              </div>
            </div>
            <p class="price"><span class="mobile-label">价格</span>{{ formatMoney(item.price) }}</p>
            <p class="stock"><span class="mobile-label">库存</span>{{ item.stock === 0 ? '暂时售罄' : `${item.stock} 件` }}</p>
          </li>
        </ul>
      </div>
      <div class="pagination-wrap">
        <ElPagination
          :current-page="page" :page-size="pageSize" :page-sizes="[8, 12, 16]" :total="total" :pager-count="5"
          layout="prev, pager, next, sizes" background
          @update:current-page="changePage" @update:page-size="changeSize"
        />
      </div>
    </template>
  </section>
</template>
