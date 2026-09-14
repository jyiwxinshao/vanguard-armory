<script setup>
import { useAuthStore } from '../stores/auth.js';
const auth = useAuthStore();
</script>

<template>
  <div v-if="auth.status === 'unavailable'" class="auth-recovery" role="alert">
    <p>登录状态暂时无法确认</p>
    <p>{{ auth.initializationError }}</p>
    <button type="button" class="auth-submit" @click="auth.ensureSession({ retry: true })">重新验证</button>
    <button type="button" class="auth-secondary" @click="auth.logout">退出此登录状态</button>
  </div>
  <p v-else-if="auth.status === 'checking' || auth.status === 'uninitialized'" role="status">正在验证登录状态…</p>
</template>
