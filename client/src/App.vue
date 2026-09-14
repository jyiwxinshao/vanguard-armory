<script setup>
import { useAuthStore } from './stores/auth.js';
const auth = useAuthStore();
</script>

<template>
  <a class="skip-link" href="#main">跳转到主要内容</a>
  <header class="site-header">
    <div class="header-inner">
      <RouterLink to="/" class="brand" aria-label="游戏装备商城首页">
        <span class="brand-mark" aria-hidden="true">星</span>
        <span>游戏装备商城<small>星海远征</small></span>
      </RouterLink>
      <nav aria-label="主导航" class="auth-navigation">
        <RouterLink to="/" class="nav-link">装备目录</RouterLink>
        <template v-if="auth.token">
          <RouterLink to="/account" class="auth-nav-link">{{ auth.isAuthenticated ? auth.user.username : '验证登录' }}</RouterLink>
          <button type="button" class="auth-nav-button" @click="auth.logout">退出</button>
        </template>
        <template v-else>
          <RouterLink to="/login" class="auth-nav-link">登录</RouterLink>
          <RouterLink to="/register" class="auth-nav-link">注册</RouterLink>
        </template>
      </nav>
    </div>
  </header>
  <main id="main" class="page-shell">
    <p v-if="auth.notice" class="auth-notice" role="status">{{ auth.notice }}</p>
    <RouterView />
  </main>
  <footer class="site-footer">星海远征 · 虚拟游戏装备</footer>
</template>
