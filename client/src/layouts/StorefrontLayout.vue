<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import { useCartStore } from '../stores/cart.js';
import { equipmentQueryToRoute, keywordIssue, parseEquipmentQuery, updateEquipmentQuery } from '../utils/equipment-query.js';

const auth = useAuthStore();
const cart = useCartStore();
const route = useRoute();
const router = useRouter();
const userInitial = computed(() => auth.user?.username?.slice(0, 1).toUpperCase() || 'V');
const keywordInput = ref('');
const searchError = ref('');
const composing = ref(false);
const searchPages = ['/', '/cart', '/checkout', '/orders', '/account'];
const showSearch = computed(() => searchPages.includes(route.path) || route.path.startsWith('/equipments/') || route.path.startsWith('/orders/'));
let searchTimer;



watch(() => parseEquipmentQuery(route.query).keyword, (value) => {
  if (value !== keywordInput.value) keywordInput.value = value;
}, { immediate: true });

watch(showSearch, (visible) => {
  if (visible) return;
  window.clearTimeout(searchTimer);
  searchError.value = '';
});

function scheduleSearch() {
  window.clearTimeout(searchTimer);
  if (composing.value) return;
  if (route.path !== '/') return;
  searchTimer = window.setTimeout(() => searchQuery(), 300);
}

function validateKeyword() {
  searchError.value = keywordIssue(keywordInput.value);
  return !searchError.value;
}

function searchQuery() {
  if (route.path !== '/') return;
  if (!validateKeyword()) return;
  const next = updateEquipmentQuery(parseEquipmentQuery(route.query), { keyword: keywordInput.value });
  const query = equipmentQueryToRoute(next);
  if (JSON.stringify(query) === JSON.stringify(equipmentQueryToRoute(parseEquipmentQuery(route.query)))) return;
  router.push({ path: '/', query }).catch(() => {});
}

function updateKeyword(value) {
  keywordInput.value = value;
  searchError.value = keywordIssue(value);
  scheduleSearch();
}

function submitKeyword() {
  if (composing.value) return;
  window.clearTimeout(searchTimer);
  if (!validateKeyword()) return;
  if (route.path === '/') { searchQuery(); return; }
  const keyword = keywordInput.value.trim();
  router.push({ path: '/', query: keyword ? { keyword } : {} }).catch(() => {});
}

function changeComposition(value) {
  composing.value = value;
  window.clearTimeout(searchTimer);
  if (!value) scheduleSearch();
}

onUnmounted(() => window.clearTimeout(searchTimer));
</script>

<template>
  <a class="skip-link" href="#main">跳转到主要内容</a>

  <header class="site-header">
    <div class="header-inner">
      <RouterLink to="/" class="brand" aria-label="先锋军械库首页">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
            <path d="M12 2.6 20 5.8v5.1c0 4.5-3.2 7.8-8 10.5-4.8-2.7-8-6-8-10.5V5.8L12 2.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="m8.7 12 2.1 2.1 4.6-4.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="brand-name">
          VANGUARD ARMORY
          <small>先锋军械库</small>
        </span>
      </RouterLink>

      <nav class="main-navigation" aria-label="主导航">
        <RouterLink to="/" class="nav-link">商城</RouterLink>
        <RouterLink v-if="auth.user?.role === 'admin'" to="/admin" class="nav-link">管理中心</RouterLink>
        <RouterLink v-else to="/orders" class="nav-link">我的订单</RouterLink>
      </nav>

      <label v-if="showSearch" class="header-search" for="header-equipment-search">
        <span class="header-search-icon" aria-hidden="true">⌕</span>
        <input
          id="header-equipment-search"
          type="search"
          :value="keywordInput"
          placeholder="搜索装备名称…"
          autocomplete="off"
          aria-label="搜索装备名称"
          :aria-invalid="Boolean(searchError)"
          :aria-describedby="searchError ? 'header-equipment-search-error' : undefined"
          @input="updateKeyword($event.target.value)"
          @compositionstart="changeComposition(true)"
          @compositionend="changeComposition(false)"
          @keydown.enter="submitKeyword"
        >
        <span v-if="searchError" id="header-equipment-search-error" class="header-search-error" role="alert">{{ searchError }}</span>
      </label>

      <div class="header-actions">
        <RouterLink to="/cart" class="icon-button" aria-label="购物车" title="购物车">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
            <path d="M3 4h2l2.2 9.3a1.6 1.6 0 0 0 1.6 1.2h7.6a1.6 1.6 0 0 0 1.6-1.2L20 8H6.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="9.5" cy="19.5" r="1.2" fill="currentColor"/>
            <circle cx="16.5" cy="19.5" r="1.2" fill="currentColor"/>
          </svg>
          <span class="cart-count">{{ cart.itemCount }}</span>
        </RouterLink>

        <template v-if="auth.isAuthenticated">
          <div class="user-menu">
            <RouterLink to="/account" class="user-chip">
              <span class="user-avatar" aria-hidden="true">{{ userInitial }}</span>
              <span class="user-name">{{ auth.user.username }}</span>
            </RouterLink>
            <button type="button" class="auth-nav-button" @click="auth.logout">退出</button>
          </div>
        </template>
        <template v-else>
          <RouterLink to="/login" class="auth-nav-link auth-nav-link-primary">登录</RouterLink>
          <RouterLink to="/register" class="auth-nav-link">注册</RouterLink>
        </template>
      </div>
    </div>
  </header>

  <main id="main" class="page-shell">
    <RouterView />
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <span class="footer-brand-name">VANGUARD ARMORY 先锋军械库</span>
        <span class="footer-muted">Vanguard Protocol</span>
      </div>
      <span class="footer-muted">课程项目 · 游戏装备商城界面演示</span>
    </div>
  </footer>
</template>
