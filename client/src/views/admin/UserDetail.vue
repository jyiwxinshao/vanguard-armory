<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import UserCharacters from '../../components/admin/UserCharacters.vue';
import { getAdminUser, updateAdminUserStatus } from '../../api/admin/users.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { isUncertainRequest } from '../../utils/request-state.js';
import { requestMessage } from '../../utils/auth.js';
import { formatOrderDate } from '../../utils/orders.js';
import { safeAdminUserReturn } from '../../utils/admin/navigation.js';

const route = useRoute();
const auth = useAuthStore();
const user = ref(null);
const loading = ref(false);
const issue = ref(null);
const acting = ref(false);
const actionError = ref('');
const uncertain = ref(false);
const needsReload = ref(false);
const backTo = computed(() => safeAdminUserReturn(route.query.returnTo));
const roleLabel = (role) => role === 'admin' ? '管理员' : '普通用户';

const request = createLatestRequest();
let active = true;
let generation = 0;
let writeController;

function sessionGuard() {
  const token = auth.token;
  const revision = auth.revision;
  const version = generation;
  const routeId = route.params.id;
  return () => active && generation === version && route.params.id === routeId
    && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
}

function userIssue(error) {
  const status = error.response?.status;
  if (status === 404) return { message: '用户不存在，请返回列表重新选择。', retry: false };
  if (status === 422) return { message: '用户地址无效，请返回列表重新选择。', retry: false };
  return { message: requestMessage(error, '用户详情加载失败，请重试'), retry: ![401, 403].includes(status) };
}

function load() {
  generation++;
  writeController?.abort();
  acting.value = false;
  user.value = null;
  const current = sessionGuard();
  if (!current()) { request.cancel(); loading.value = false; return; }
  return request.run((signal) => getAdminUser(route.params.id, { signal, sessionGuard: current }), {
    onStart: () => { issue.value = null; actionError.value = ''; loading.value = true; },
    onSuccess: (result) => { if (current()) { user.value = result; uncertain.value = false; needsReload.value = false; } },
    onError: (error) => { if (current()) issue.value = userIssue(error); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}

async function changeStatus() {
  if (acting.value || uncertain.value || needsReload.value || !user.value || user.value.role !== 'user') return;
  const id = user.value.id;
  const currentWrite = sessionGuard();
  // Route params are strings; MySQL may return a numeric ID.
  if (!currentWrite() || String(route.params.id) !== String(id)) return;
  const target = user.value.status === 'frozen' ? 'active' : 'frozen';
  const previous = user.value;
  acting.value = true;
  actionError.value = '';
  uncertain.value = false;
  writeController = new AbortController();
  try {
    const updated = await updateAdminUserStatus(id, { status: target }, { signal: writeController.signal, sessionGuard: currentWrite });
    if (!currentWrite()) return;
    user.value = updated;
  } catch (error) {
    if (!currentWrite()) return;
    if (isUncertainRequest(error)) uncertain.value = true;
    else {
      user.value = previous;
      needsReload.value = [404, 409].includes(error.response?.status);
      actionError.value = requestMessage(error, '账号状态更新失败，请重试');
    }
  } finally { if (currentWrite()) acting.value = false; }
}

watch(() => route.params.id, load, { immediate: true });
onUnmounted(() => { active = false; generation++; request.dispose(); writeController?.abort(); });
</script>

<template>
  <section class="admin-module" aria-labelledby="admin-user-detail-title">
    <RouterLink class="admin-back" :to="backTo">← 返回用户列表</RouterLink>
    <header class="admin-module-heading"><h1 id="admin-user-detail-title">用户详情</h1><p>查看用户基本资料并管理普通账号状态。</p></header>
    <div v-if="loading" class="admin-list-message admin-detail-content" role="status">正在加载用户…</div>
    <div v-else-if="issue" class="admin-list-message admin-detail-content" role="alert"><p>{{ issue.message }}</p><button v-if="issue.retry" type="button" class="primary-button" @click="load">重新加载</button></div>
    <article v-else-if="user" class="admin-detail-content">
      <div class="admin-detail-summary">
        <div>
          <p class="admin-detail-id">用户 #{{ user.id }}</p>
          <h2>{{ user.username }}</h2>
          <p class="admin-detail-note">{{ user.email }}</p>
          <span class="admin-role">{{ roleLabel(user.role) }}</span>
          <span class="admin-equipment-status" :class="`is-${user.status}`">{{ user.status === 'frozen' ? '已冻结' : '正常' }}</span>
        </div>
      </div>
      <dl class="admin-detail-fields">
        <div><dt>用户 ID</dt><dd>{{ user.id }}</dd></div>
        <div><dt>账号角色</dt><dd>{{ roleLabel(user.role) }}</dd></div>
        <div><dt>账号状态</dt><dd>{{ user.status === 'frozen' ? '已冻结' : '正常' }}</dd></div>
        <div><dt>注册时间</dt><dd>{{ formatOrderDate(user.created_at) }}</dd></div>
        <div><dt>更新时间</dt><dd>{{ formatOrderDate(user.updated_at) }}</dd></div>
      </dl>
      <section class="admin-detail-description">
        <h2>账号操作</h2>
        <p v-if="user.role !== 'user'" class="admin-detail-note">管理员账号不能通过此入口冻结或恢复。</p>
        <template v-else>
          <p class="admin-detail-note">{{ user.status === 'frozen' ? '冻结后该账号的旧登录状态也会失效，无法继续购物或下单。' : '该账号当前可正常登录和使用商城。' }}</p>
          <button type="button" class="primary-button" :disabled="acting || uncertain || needsReload" @click="changeStatus">{{ acting ? '正在处理…' : user.status === 'frozen' ? '恢复账号' : '冻结账号' }}</button>
          <p v-if="actionError" class="auth-error" role="alert">{{ actionError }}</p>
          <div v-if="uncertain || needsReload" class="admin-list-message" role="alert">
            <p>{{ uncertain ? '操作结果待确认，请重新获取最新状态。' : '资料可能已发生变化，请重新获取最新状态后再操作。' }}</p>
            <button type="button" class="primary-button" :disabled="loading" @click="load">重新获取最新状态</button>
          </div>
        </template>
      </section>
      <UserCharacters v-if="user.role === 'user'" :key="user.id" :user-id="user.id" />
      <p class="admin-result-count admin-detail-content"><RouterLink class="admin-equipment-link" :to="{ path: '/admin/orders', query: { user_id: String(user.id) } }">查看该用户历史订单 →</RouterLink></p>
    </article>
  </section>
</template>
