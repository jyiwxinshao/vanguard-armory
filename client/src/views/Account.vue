<script setup>
import SessionRecovery from '../components/SessionRecovery.vue';
import { useAuthStore } from '../stores/auth.js';
const auth = useAuthStore();
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN');
}
</script>

<template>
  <section class="catalog-panel auth-panel" aria-labelledby="account-heading">
    <h1 id="account-heading">我的账号</h1>
    <SessionRecovery v-if="!auth.isAuthenticated" />
    <dl v-else class="account-details">
      <dt>用户名</dt><dd>{{ auth.user.username }}</dd>
      <dt>邮箱</dt><dd>{{ auth.user.email }}</dd>
      <dt>角色</dt><dd>{{ auth.user.role === 'admin' ? '管理员' : '普通用户' }}</dd>
      <dt>账号状态</dt><dd>{{ auth.user.status === 'active' ? '正常' : '冻结' }}</dd>
      <dt>注册时间</dt><dd>{{ formatDate(auth.user.created_at) }}</dd>
    </dl>
    <RouterLink to="/" class="back-link">返回装备目录</RouterLink>
  </section>
</template>
