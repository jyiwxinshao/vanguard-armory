<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElPagination } from 'element-plus';
import 'element-plus/es/components/pagination/style/css';
import EquipmentImage from '../../components/EquipmentImage.vue';
import { getAdminEquipments } from '../../api/admin/equipments.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { requestMessage } from '../../utils/auth.js';
import { formatMoney } from '../../utils/format.js';
import { CATEGORY_META, RARITY_META, categoryLabel, isNewItem } from '../../utils/equipment-display.js';
import { ADMIN_EQUIPMENT_STATUSES, ADMIN_PAGE_SIZES, adminEquipmentParams, adminEquipmentRoute, parseAdminEquipmentQuery } from '../../utils/admin/equipment-query.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const request = createLatestRequest();
const filters = computed(() => parseAdminEquipmentQuery(route.query));
const form = reactive(parseAdminEquipmentQuery(route.query));
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const navigationError = ref('');
const statusLabel = (status) => ADMIN_EQUIPMENT_STATUSES.find((option) => option.value === status)?.label || status;

async function navigate(next, replace = false) {
  navigationError.value = '';
  try {
    const location = { path: '/admin/equipments', query: adminEquipmentRoute(next) };
    if (replace) await router.replace(location);
    else if (JSON.stringify(location.query) === JSON.stringify(adminEquipmentRoute(filters.value))) await load();
    else await router.push(location);
  } catch { navigationError.value = '筛选条件暂时无法更新，请重试'; }
}

function load() {
  const token = auth.token;
  const revision = auth.revision;
  const current = () => canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
  if (!current()) { request.cancel(); items.value = []; total.value = 0; loading.value = false; return; }
  const submitted = filters.value;
  return request.run(
    (signal) => getAdminEquipments(adminEquipmentParams(submitted), { signal, sessionGuard: current }),
    {
      onStart: () => { loading.value = true; errorMessage.value = ''; items.value = []; total.value = 0; },
      onSuccess: (result) => {
        if (!current()) return;
        items.value = result.items;
        total.value = result.total;
        const lastPage = Math.max(1, Math.ceil(result.total / submitted.page_size));
        if (submitted.page > lastPage) void navigate({ ...submitted, page: lastPage }, true);
      },
      onError: (error) => { if (current()) errorMessage.value = requestMessage(error, '装备列表加载失败，请重试'); },
      onFinish: () => { if (current()) loading.value = false; },
    },
  );
}

function search() { void navigate({ ...form, page: 1 }); }
function reset() { Object.assign(form, parseAdminEquipmentQuery()); void navigate(form); }
watch(filters, (value) => { Object.assign(form, value); void load(); }, { immediate: true, flush: 'sync' });
onUnmounted(() => request.dispose());
</script>

<template>
  <section class="admin-module" aria-labelledby="equipment-admin-title">
    <header class="admin-module-heading"><h1 id="equipment-admin-title">装备管理</h1><p>查询装备资料、上架状态与可售库存。</p></header>
    <RouterLink class="admin-create-link" to="/admin/equipments/new">＋ 新增装备</RouterLink>
    <form class="admin-filter-form" @submit.prevent="search">
      <label>装备名称<input v-model="form.keyword" type="search" maxlength="50" placeholder="搜索装备名称"></label>
      <label>分类<select v-model="form.category"><option value="">全部分类</option><option v-for="item in CATEGORY_META" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
      <label>状态<select v-model="form.status"><option v-for="item in ADMIN_EQUIPMENT_STATUSES" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
      <label>系列标识<input v-model="form.series" maxlength="64" placeholder="例如 eclipse_relics"></label>
      <label>排序<select v-model="form.sort"><option value="newest">最新创建顺序</option><option value="price_asc">价格升序</option><option value="price_desc">价格降序</option><option value="rarity_desc">稀有度降序</option></select></label>
      <fieldset class="admin-rarity-filter"><legend>稀有度</legend><label v-for="item in RARITY_META" :key="item.value"><input v-model="form.rarities" type="checkbox" :value="item.value">{{ item.value }}</label></fieldset>
      <label class="admin-stock-filter"><input v-model="form.in_stock" type="checkbox">仅显示有库存</label>
      <div class="admin-filter-actions"><button type="submit" class="primary-button">查询</button><button type="button" @click="reset">重置</button></div>
    </form>
    <p v-if="navigationError" class="auth-error" role="alert">{{ navigationError }}</p>
    <div v-if="loading" class="admin-list-message" role="status">正在加载装备…</div>
    <div v-else-if="errorMessage" class="admin-list-message" role="alert"><p>{{ errorMessage }}</p><button type="button" class="primary-button" @click="load">重新加载</button></div>
    <template v-else>
      <p class="admin-result-count" role="status">共 {{ total }} 件装备</p>
      <div v-if="!items.length" class="admin-list-message"><p>没有符合条件的装备。</p><button type="button" @click="reset">清除筛选</button></div>
      <div v-else class="admin-table-scroll" tabindex="0" role="region" aria-label="装备查询结果">
        <table class="admin-equipment-table">
          <caption class="admin-table-caption">装备列表</caption>
          <thead><tr><th scope="col">装备</th><th scope="col">分类</th><th scope="col">稀有度</th><th scope="col">价格</th><th scope="col">库存</th><th scope="col">状态</th><th scope="col">系列</th></tr></thead>
          <tbody><tr v-for="item in items" :key="item.id">
            <td><div class="admin-equipment-cell"><EquipmentImage :src="item.image" :name="item.name" /><div><RouterLink class="admin-equipment-link" :to="{ path: `/admin/equipments/${item.id}`, query: { returnTo: route.fullPath } }"><strong>{{ item.name }}</strong></RouterLink><small>#{{ item.id }} <span v-if="isNewItem(item)" class="admin-new-label">新品</span></small></div></div></td>
            <td>{{ categoryLabel(item.category) }}</td><td>{{ item.rarity }}</td><td class="admin-money">{{ formatMoney(item.price) }}</td>
            <td :class="{ 'admin-stock-empty': item.stock === 0 }">{{ item.stock }} 件</td>
            <td><span class="admin-equipment-status" :class="`is-${item.status}`">{{ statusLabel(item.status) }}</span></td>
            <td>{{ item.series_code || '—' }}</td>
          </tr></tbody>
        </table>
      </div>
      <div class="admin-pagination">
        <label>每页<select :value="filters.page_size" @change="navigate({ ...filters, page_size: $event.target.value, page: 1 })"><option v-for="size in ADMIN_PAGE_SIZES" :key="size" :value="size">{{ size }} 条</option></select></label>
        <ElPagination :current-page="filters.page" :page-size="filters.page_size" :total="total" :pager-count="5" layout="prev, pager, next" background @update:current-page="navigate({ ...filters, page: $event })" />
      </div>
    </template>
  </section>
</template>
