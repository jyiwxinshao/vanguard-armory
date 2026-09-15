<script setup>
import { computed } from 'vue';
import { useAuthStore } from './stores/auth.js';
import { useCartStore } from './stores/cart.js';

const auth = useAuthStore();
const cart = useCartStore();
const userInitial = computed(() => auth.user?.username?.slice(0, 1).toUpperCase() || 'V');


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
        <span class="nav-link nav-link-placeholder" aria-disabled="true" title="订单功能即将上线">我的订单</span>
      </nav>

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
    <p v-if="auth.notice" class="auth-notice" role="status">{{ auth.notice }}</p>
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
