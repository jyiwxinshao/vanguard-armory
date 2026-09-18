<script setup>
import { onUnmounted, reactive, ref } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import { createAdminEquipment } from '../../api/admin/equipments.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { fieldErrorsFrom, requestMessage } from '../../utils/auth.js';
import { equipmentCreateBody, equipmentCreateFailure } from '../../utils/admin/equipment-form.js';
import { useEquipmentUnsavedGuard } from '../../utils/admin/equipment-unsaved.js';
import { confirmEquipmentLeave } from '../../utils/admin/equipment-confirm.js';
import EquipmentFields from '../../components/admin/EquipmentFields.vue';

const router = useRouter();
const auth = useAuthStore();
const form = reactive({ name: '', price: '', rarity: 'N', category: 'weapon', image: '/images/equipments/placeholder.svg', attack: '0', defense: '0', stock: '0', status: 'off_sale', description: '', series_code: '', new_until: '' });
const errors = ref({});
const message = ref('');
const submitting = ref(false);
const imageUploading = ref(false);
const uncertain = ref(false);
const createdId = ref(null);
const { dirty, markBaseline, markSaved } = useEquipmentUnsavedGuard(form);
markBaseline();
onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return await confirmEquipmentLeave();
});

let active = true;
const controller = new AbortController();
onUnmounted(() => { active = false; controller.abort(); });

async function submit() {
  if (submitting.value || imageUploading.value || uncertain.value || createdId.value) return;
  const token = auth.token;
  const revision = auth.revision;
  const current = () => active && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
  if (!current()) return;
  const parsed = equipmentCreateBody(form);
  errors.value = parsed.errors;
  message.value = '';
  if (Object.keys(parsed.errors).length) return;
  submitting.value = true;
  try {
    const result = await createAdminEquipment(parsed.body, { signal: controller.signal, sessionGuard: current });
    if (!current()) return;
    createdId.value = result.id;
    message.value = '装备创建成功';
    markSaved();
    try { await router.replace(`/admin/equipments/${result.id}`); }
    catch { message.value = '装备已创建，可点击下方链接查看详情。'; }
  } catch (error) {
    if (!current()) return;
    uncertain.value = equipmentCreateFailure(error);
    errors.value = fieldErrorsFrom(error);
    message.value = uncertain.value ? '暂时无法确认是否保存成功。请先返回装备列表核对，避免重复创建。' : requestMessage(error, '保存失败，请检查输入');
  } finally { if (current()) submitting.value = false; }
}
</script>

<template>
  <section class="admin-module" aria-labelledby="equipment-create-title">
    <RouterLink class="admin-back" to="/admin/equipments">← 返回装备列表</RouterLink>
    <header class="admin-module-heading"><h1 id="equipment-create-title">新增装备</h1><p>默认保存为下架；选择在售后将立即展示在商城。</p></header>
    <p v-if="message" class="admin-list-message" role="status">{{ message }}</p>
    <RouterLink v-if="createdId" class="admin-back" :to="`/admin/equipments/${createdId}`">查看已创建装备</RouterLink>
    <form class="admin-create-form" novalidate @submit.prevent="submit">
      <fieldset :disabled="submitting || uncertain || Boolean(createdId)">
        <EquipmentFields :form="form" :errors="errors" @image-busy="imageUploading = $event" />
        <button class="auth-submit" type="submit" :disabled="imageUploading">{{ imageUploading ? '请等待图片上传…' : submitting ? '正在保存…' : '创建装备' }}</button>
      </fieldset>
    </form>
  </section>
</template>
