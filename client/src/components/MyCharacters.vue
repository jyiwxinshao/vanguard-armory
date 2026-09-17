<script setup>
import { onUnmounted, ref, watch } from 'vue';
import { useAuthStore } from '../stores/auth.js';
import { getMyCharacters } from '../api/auth.js';
import { createLatestRequest } from '../utils/latest-request.js';
import { requestMessage } from '../utils/auth.js';
const auth = useAuthStore();
const data = ref(null), loading = ref(false), error = ref('');
const request = createLatestRequest();
let active = true;
function load() {
  const token = auth.token, revision = auth.revision;
  const current = () => active && auth.isAuthenticated && auth.user?.role === 'user' && auth.isCurrentSession(token, revision);
  data.value = null; error.value = '';
  if (!current()) { request.cancel(); loading.value = false; return; }
  return request.run((signal) => getMyCharacters({ signal, sessionGuard: current }), {
    onStart: () => { loading.value = true; },
    onSuccess: (result) => { if (current()) data.value = result; },
    onError: (caught) => { if (current()) error.value = requestMessage(caught, '角色信息加载失败，请重试'); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}
watch(() => [auth.status, auth.user?.id, auth.revision], load, { immediate: true, flush: 'sync' });
onUnmounted(() => { active = false; request.dispose(); });
</script>
<template>
  <section class="account-characters" aria-labelledby="my-characters-heading">
    <div class="order-heading"><h2 id="my-characters-heading">我的游戏角色</h2><button type="button" class="cart-toolbar-button" :disabled="loading" @click="load">{{ loading ? '正在刷新…' : '刷新角色' }}</button></div>
    <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">正在读取角色信息…</p>
    <template v-else-if="data">
      <dl class="account-details"><template v-for="server in data.servers" :key="server.value"><dt>{{ server.label }}</dt><dd>{{ data.items.find(item => item.server === server.value)?.character_name || '暂无角色' }}</dd></template></dl>
      <p class="checkout-note">角色由管理员配置；尚无角色时，请联系管理员分配课程演示角色。结算时选服即可自动读取，无需手填。</p>
    </template>
  </section>
</template>
