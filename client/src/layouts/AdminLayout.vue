<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import SessionRecovery from '../components/SessionRecovery.vue';
import { canAccessAdmin } from '../router/guards.js';
import '../styles/admin.css';

const auth = useAuthStore();
const route = useRoute();
const authorized = computed(() => canAccessAdmin(auth));
const sections = [
  { path: '/admin/equipments', label: '装备管理', number: '01' },
  { path: '/admin/users', label: '用户管理', number: '02' },
  { path: '/admin/orders', label: '订单管理', number: '03' },
];
</script>

<template>
  <div v-if="authorized" class="admin-shell">
    <a class="skip-link" href="#admin-main">跳转到管理内容</a>
    <aside class="admin-sidebar" aria-label="管理中心导航">
      <RouterLink to="/admin" class="admin-brand">VANGUARD <span>先锋军械库 · 管理中心</span></RouterLink>
      <p class="admin-nav-label">工作空间</p>
      <nav class="admin-navigation">
        <RouterLink v-for="section in sections" :key="section.path" :to="section.path" :class="{ 'is-active': route.path === section.path || route.path.startsWith(`${section.path}/`) }">
          <span aria-hidden="true">{{ section.number }}</span>{{ section.label }}
        </RouterLink>
      </nav>
      <RouterLink to="/" class="admin-store-link">← 返回装备商城</RouterLink>
    </aside>
    <div class="admin-workspace">
      <header class="admin-header">
        <span>{{ route.meta.title || '管理中心' }}</span>
        <div class="admin-account"><span>{{ auth.user.username }}</span><span class="admin-role">管理员</span><button type="button" @click="auth.logout">退出</button></div>
      </header>
      <main id="admin-main" class="admin-main">
        <RouterView v-slot="{ Component }">
          <component :is="Component" :key="auth.revision" />
        </RouterView>
      </main>
    </div>
  </div>
  <main v-else class="page-shell admin-recovery">
    <h1>管理中心</h1>
    <SessionRecovery />
    <p v-if="auth.isAuthenticated">当前账号没有管理权限。</p>
    <RouterLink to="/">返回装备商城</RouterLink>
  </main>
</template>
