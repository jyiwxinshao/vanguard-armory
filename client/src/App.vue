<script setup>
import { watch } from 'vue';
import { useAuthStore } from './stores/auth.js';
import { notify } from './utils/notify.js';

const auth = useAuthStore();
watch(() => auth.notice, (message) => {
  if (!message) return;
  if (message === '已退出登录' || message.startsWith('注册成功')) notify.success(message);
  else if (message.includes('未能清除')) notify.error(message);
  else notify.info(message);
  auth.notice = '';
});
</script>

<template>
  <RouterView />
</template>
