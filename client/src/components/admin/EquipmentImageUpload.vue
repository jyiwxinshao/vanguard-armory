<script setup>
import { onUnmounted, ref, watch } from 'vue';
import EquipmentImage from '../EquipmentImage.vue';
import { uploadAdminEquipmentImage } from '../../api/admin/equipments.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { requestMessage } from '../../utils/auth.js';
const props = defineProps({ modelValue: String, name: String, error: String });
const emit = defineEmits(['update:modelValue', 'busy']);
const auth = useAuthStore();
const uploading = ref(false), message = ref('');
let active = true, generation = 0, controller;
function cancel() { generation++; controller?.abort(); uploading.value = false; emit('busy', false); }
async function choose(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || uploading.value || !canAccessAdmin(auth)) return;
  message.value = '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { message.value = '请选择 JPG、PNG 或 WebP 图片'; return; }
  if (!file.size || file.size > 5 * 1024 * 1024) { message.value = '请选择不超过 5 MB 的非空图片'; return; }
  const version = ++generation, token = auth.token, revision = auth.revision;
  const current = () => active && version === generation && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
  uploading.value = true; emit('busy', true); controller = new AbortController();
  try {
    const result = await uploadAdminEquipmentImage(file, { signal: controller.signal, sessionGuard: current });
    if (!current()) return;
    emit('update:modelValue', result.image);
    message.value = '上传成功，保存装备后生效。';
  } catch (error) {
    if (current()) message.value = requestMessage(error, '图片上传失败，可重新选择；原图片已保留');
  } finally { if (current()) { uploading.value = false; emit('busy', false); } }
}
watch(() => [auth.status, auth.revision], () => { cancel(); message.value = ''; });
onUnmounted(() => { active = false; cancel(); });
</script>
<template>
  <div class="auth-field admin-image-upload">
    <label for="equipment-image-upload">装备图片</label>
    <input id="equipment-image-upload" type="file" accept="image/jpeg,image/png,image/webp" :disabled="uploading" @change="choose" aria-describedby="equipment-image-help">
    <p id="equipment-image-help" class="admin-detail-note">上传 JPG、PNG 或 WebP，最大 5 MB、1600 万像素；仅支持静态图片，不支持 GIF/APNG 等动画格式。未更换时保留当前图片。</p>
    <p v-if="uploading" role="status">正在上传图片…</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
    <EquipmentImage class="admin-create-image" :src="modelValue" :name="name || '装备预览'" />
  </div>
</template>
