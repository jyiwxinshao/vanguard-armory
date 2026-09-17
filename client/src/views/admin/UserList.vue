<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElPagination } from 'element-plus';
import 'element-plus/es/components/pagination/style/css';
import { getAdminUsers } from '../../api/admin/users.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { requestMessage } from '../../utils/auth.js';
import { formatOrderDate } from '../../utils/orders.js';
import { ADMIN_PAGE_SIZES, ADMIN_USER_STATUSES, adminUserParams, adminUserRoute, parseAdminUserQuery } from '../../utils/admin/users-query.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const request = createLatestRequest();
const filters = computed(() => parseAdminUserQuery(route.query));
const form = reactive(parseAdminUserQuery(route.query));
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const navigationError = ref('');
const roleLabel = (role) => role === 'admin' ? '管理员' : '普通用户';
const statusLabel = (status) => ADMIN_USER_STATUSES.find((item) => item.value === status)?.label || status;

async function navigate(next, replace = false) {
  navigationError.value = '';
  try {
    const location = { path: '/admin/users', query: adminUserRoute(next) };
    if (replace) await router.replace(location);
    else if (JSON.stringify(location.query) === JSON.stringify(adminUserRoute(filters.value))) await load();
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
    (signal) => getAdminUsers(adminUserParams(submitted), { signal, sessionGuard: current }),
    {
      onStart: () => { loading.value = true; errorMessage.value = ''; items.value = []; total.value = 0; },
      onSuccess: (result) => {
        if (!current()) return;
        items.value = result.items;
        total.value = result.total;
        const lastPage = Math.max(1, Math.ceil(result.total / submitted.page_size));
        if (submitted.page > lastPage) void navigate({ ...submitted, page: lastPage }, true);
      },
      onError: (error) => { if (current()) errorMessage.value = requestMessage(error, '用户列表加载失败，请重试'); },
      onFinish: () => { if (current()) loading.value = false; },
    },
  );
}

function search() { void navigate({ ...form, page: 1 }); }
function reset() { Object.assign(form, parseAdminUserQuery()); void navigate(form); }
watch(filters, (value) => { Object.assign(form, value); void load(); }, { immediate: true, flush: 'sync' });
onUnmounted(() => request.dispose());
</script>

<template>
  <section class="admin-module" aria-labelledby="user-admin-title">
    <header class="admin-module-heading"><h1 id="user-admin-title">用户管理</h1><p>查询普通用户资料，管理账号使用状态。</p></header>
    <form class="admin-filter-form" @submit.prevent="search">
      <label>用户名 / 邮箱<input v-model="form.keyword" type="search" maxlength="50" placeholder="搜索用户名或邮箱"></label>
      <label>状态<select v-model="form.status"><option v-for="item in ADMIN_USER_STATUSES" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
      <div class="admin-filter-actions"><button type="submit" class="primary-button">查询</button><button type="button" @click="reset">重置</button></div>
    </form>
    <p v-if="navigationError" class="auth-error" role="alert">{{ navigationError }}</p>
    <div v-if="loading" class="admin-list-message" role="status">正在加载用户…</div>
    <div v-else-if="errorMessage" class="admin-list-message" role="alert"><p>{{ errorMessage }}</p><button type="button" class="primary-button" @click="load">重新加载</button></div>
    <template v-else>
      <p class="admin-result-count" role="status">共 {{ total }} 个账号</p>
      <div v-if="!items.length" class="admin-list-message"><p>没有符合条件的用户。</p><button type="button" @click="reset">清除筛选</button></div>
      <div v-else class="admin-table-scroll" tabindex="0" role="region" aria-label="用户查询结果">
        <table class="admin-equipment-table">
          <caption class="admin-table-caption">用户列表</caption>
          <thead><tr><th scope="col">用户</th><th scope="col">邮箱</th><th scope="col">角色</th><th scope="col">状态</th><th scope="col">注册时间</th><th scope="col"></th></tr></thead>
          <tbody><tr v-for="item in items" :key="item.id">
            <td><strong>#{{ item.id }} {{ item.username }}</strong></td>
            <td>{{ item.email }}</td>
            <td>{{ roleLabel(item.role) }}</td>
            <td><span class="admin-equipment-status" :class="`is-${item.status}`">{{ statusLabel(item.status) }}</span></td>
            <td>{{ formatOrderDate(item.created_at) }}</td>
            <td><RouterLink class="admin-equipment-link" :to="{ path: `/admin/users/${item.id}`, query: { returnTo: route.fullPath } }">查看详情</RouterLink></td>
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
