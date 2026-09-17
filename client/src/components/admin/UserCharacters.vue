<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { getAdminUserCharacters, saveAdminUserCharacter } from '../../api/admin/users.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { requestMessage } from '../../utils/auth.js';
import { isUncertainRequest } from '../../utils/request-state.js';

const props = defineProps({ userId: { type: Number, required: true } });
const auth = useAuthStore();
const data = ref(null);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const message = ref('');
const needsReload = ref(false);
const form = reactive({ server: '', name: '' });
const existing = computed(() => data.value?.items.find((item) => item.server === form.server));
const request = createLatestRequest();
let active = true, generation = 0, writeController;
function guard() {
  const id = props.userId, token = auth.token, revision = auth.revision, version = generation;
  return () => active && generation === version && props.userId === id && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
}
function load() {
  generation++;
  writeController?.abort();
  saving.value = false; data.value = null; error.value = ''; message.value = '';
  const current = guard();
  if (!current()) { request.cancel(); loading.value = false; return; }
  return request.run((signal) => getAdminUserCharacters(props.userId, { signal, sessionGuard: current }), {
    onStart: () => { loading.value = true; },
    onSuccess: (result) => {
      if (!current()) return;
      data.value = result; needsReload.value = false;
      if (!result.servers.some((server) => server.value === form.server)) form.server = result.servers[0]?.value || '';
    },
    onError: (caught) => { if (current()) error.value = requestMessage(caught, '角色加载失败，请重试'); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}
async function save() {
  if (!data.value || loading.value || saving.value || needsReload.value) return;
  const current = guard();
  if (!current()) return;
  const name = form.name.trim();
  error.value = ''; message.value = '';
  if (!form.server || [...name].length < 2 || [...name].length > 10 || /[\u0000-\u001f\u007f]/u.test(name)) { error.value = '请选择服务器并填写 2–10 个字符的角色名'; return; }
  const body = { character_name: name, expected_name: existing.value?.character_name ?? null };
  saving.value = true; writeController = new AbortController();
  try {
    const result = await saveAdminUserCharacter(props.userId, form.server, body, { signal: writeController.signal, sessionGuard: current });
    if (!current()) return;
    data.value = result; message.value = '角色已保存，用户可选服后自动读取。';
  } catch (caught) {
    if (!current()) return;
    needsReload.value = isUncertainRequest(caught) || [404, 409].includes(caught.response?.status);
    error.value = isUncertainRequest(caught) ? '保存结果待确认，请重新加载核对后再操作。' : requestMessage(caught, '角色保存失败，请重试');
  } finally { if (current()) saving.value = false; }
}
watch(() => [form.server, data.value], () => { form.name = existing.value?.character_name || ''; }, { flush: 'sync' });
watch(() => [props.userId, auth.status, auth.revision], load, { immediate: true, flush: 'sync' });
onUnmounted(() => { active = false; generation++; request.dispose(); writeController?.abort(); });
</script>
<template>
  <section class="admin-detail-description admin-detail-content" aria-labelledby="user-characters-heading">
    <h2 id="user-characters-heading">游戏角色</h2>
    <p class="admin-detail-note">课程演示角色由管理员配置。每个账号在同一服务器只有一个角色；修改角色名不会改变历史订单快照。</p>
    <p v-if="loading" role="status">正在加载角色…</p>
    <div v-if="error" class="order-alert" role="alert"><p>{{ error }}</p><button v-if="needsReload || !data" type="button" class="cart-toolbar-button" :disabled="loading" @click="load">重新加载角色</button></div>
    <p v-if="message" class="auth-notice" role="status">{{ message }}</p>
    <template v-if="data && !loading">
      <dl class="admin-detail-fields"><div v-for="server in data.servers" :key="server.value"><dt>{{ server.label }}</dt><dd>{{ data.items.find(item => item.server === server.value)?.character_name || '尚未配置' }}</dd></div></dl>
      <form class="admin-character-form" @submit.prevent="save">
        <fieldset :disabled="saving || needsReload">
          <label>游戏服务器<select v-model="form.server"><option v-for="server in data.servers" :key="server.value" :value="server.value">{{ server.label }}</option></select></label>
          <label>游戏角色名<input v-model="form.name" placeholder="2–10 个字符" autocomplete="off"></label>
          <button type="submit" class="primary-button">{{ saving ? '正在保存…' : existing ? '保存角色名' : '分配角色' }}</button>
        </fieldset>
      </form>
    </template>
  </section>
</template>
