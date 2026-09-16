<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EquipmentFields from '../../components/admin/EquipmentFields.vue';
import { getAdminEquipment, updateAdminEquipment } from '../../api/admin/equipments.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { fieldErrorsFrom, requestMessage } from '../../utils/auth.js';
import { adminEquipmentIssue, safeAdminEquipmentReturn } from '../../utils/admin/equipment-detail.js';
import { equipmentEditForm, equipmentUpdateBody, equipmentCreateFailure } from '../../utils/admin/equipment-form.js';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const request = createLatestRequest();
const form = reactive({});
const item = ref(null);
const errors = ref({});
const issue = ref(null);
const message = ref('');
const loading = ref(false);
const submitting = ref(false);
const needsReload = ref(false);
const saved = ref(false);
const backTo = computed(() => safeAdminEquipmentReturn(route.query.returnTo));
const detailLocation = computed(() => ({ path: `/admin/equipments/${encodeURIComponent(route.params.id)}`, query: { returnTo: backTo.value } }));
let active = true;
let generation = 0;
let writeController;
function sessionGuard() {
  const token = auth.token;
  const revision = auth.revision;
  const version = generation;
  return () => active && generation === version && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
}
function load() {
  generation++;
  writeController?.abort();
  submitting.value = false;
  item.value = null;
  const current = sessionGuard();
  if (!current()) { request.cancel(); loading.value = false; return; }
  return request.run((signal) => getAdminEquipment(route.params.id, { signal, sessionGuard: current }), {
    onStart: () => { loading.value = true; issue.value = null; message.value = ''; errors.value = {}; saved.value = false; needsReload.value = false; },
    onSuccess: (result) => { if (current()) { item.value = result; Object.assign(form, equipmentEditForm(result)); } },
    onError: (error) => { if (current()) issue.value = adminEquipmentIssue(error); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}
async function submit() {
  if (submitting.value || loading.value || needsReload.value || saved.value || !item.value || item.value.status === 'deleted') return;
  const current = sessionGuard();
  if (!current()) return;
  const { body, errors: validation } = equipmentUpdateBody(form);
  errors.value = validation;
  message.value = '';
  if (Object.keys(validation).length) return;
  const id = item.value.id;
  const destination = detailLocation.value;
  submitting.value = true;
  writeController = new AbortController();
  try {
    await updateAdminEquipment(id, body, { signal: writeController.signal, sessionGuard: current });
    if (!current()) return;
    saved.value = true;
    message.value = '装备资料已保存';
    try { await router.replace(destination); }
    catch { message.value = '资料已保存，请点击返回装备详情查看。'; }
  } catch (error) {
    if (!current()) return;
    errors.value = fieldErrorsFrom(error);
    needsReload.value = equipmentCreateFailure(error) || [404, 409].includes(error.response?.status);
    message.value = equipmentCreateFailure(error) ? '暂时无法确认保存结果，请重新加载核对后再编辑。' : requestMessage(error, '保存失败，请检查输入');
  } finally { if (current()) submitting.value = false; }
}
watch(() => route.params.id, load, { immediate: true });
onUnmounted(() => { active = false; generation++; request.dispose(); writeController?.abort(); });
</script>

<template>
  <section class="admin-module" aria-labelledby="equipment-edit-title">
    <RouterLink class="admin-back" :to="detailLocation">← 返回装备详情</RouterLink>
    <header class="admin-module-heading"><h1 id="equipment-edit-title">编辑装备</h1><p>修改资料和销售状态，库存由独立流程管理。</p></header>
    <div v-if="loading" class="admin-list-message admin-detail-content" role="status">正在加载装备…</div>
    <div v-else-if="issue" class="admin-list-message admin-detail-content" role="alert"><p>{{ issue.message }}</p><button v-if="issue.retry" type="button" @click="load">重新加载</button></div>
    <p v-else-if="item?.status === 'deleted'" class="admin-list-message">此装备已删除，不能编辑或重新上架。</p>
    <template v-else-if="item">
      <p class="admin-result-count">装备 #{{ item.id }} · 加载时可售库存 {{ item.stock }} 件（仅供参考，不随表单保存）</p>
      <div v-if="message" class="admin-list-message" role="status"><p>{{ message }}</p><button v-if="needsReload" type="button" @click="load">重新加载最新资料（放弃未保存修改）</button></div>
      <form class="admin-create-form" novalidate @submit.prevent="submit">
        <fieldset :disabled="submitting || needsReload || saved">
          <EquipmentFields :form="form" :errors="errors" editing />
          <button class="auth-submit" type="submit">{{ submitting ? '正在保存…' : '保存修改' }}</button>
        </fieldset>
      </form>
    </template>
  </section>
</template>
