<script setup>
import { onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { createAdminEquipment } from '../../api/admin/equipments.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { fieldErrorsFrom, requestMessage } from '../../utils/auth.js';
import { equipmentCreateBody, equipmentCreateFailure } from '../../utils/admin/equipment-form.js';
import { CATEGORY_META, RARITY_META } from '../../utils/equipment-display.js';
import EquipmentImage from '../../components/EquipmentImage.vue';

const router = useRouter();
const auth = useAuthStore();
const form = reactive({ name: '', price: '', rarity: 'N', category: 'weapon', image: '/images/equipments/placeholder.svg', attack: '0', defense: '0', stock: '0', status: 'off_sale', description: '', series_code: '', new_until: '' });
const errors = ref({});
const message = ref('');
const submitting = ref(false);
const uncertain = ref(false);
const createdId = ref(null);
const images = Object.keys(import.meta.glob('/public/images/equipments/*.{png,webp,jpg,jpeg,svg}')).map((path) => path.replace('/public', '')).sort();
const textFields = [{ key: 'name', label: '装备名称', type: 'text' }, { key: 'price', label: '价格（元）', type: 'text' }, { key: 'stock', label: '初始库存', type: 'text' }, { key: 'attack', label: '攻击力', type: 'text' }, { key: 'defense', label: '防御力', type: 'text' }, { key: 'series_code', label: '系列标识（选填）', type: 'text' }, { key: 'new_until', label: '新品截止时间（本地时间，选填）', type: 'datetime-local' }];
let active = true;
const controller = new AbortController();
onUnmounted(() => { active = false; controller.abort(); });

async function submit() {
  if (submitting.value || uncertain.value || createdId.value) return;
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
        <div class="admin-create-fields">
          <div v-for="field in textFields" :key="field.key" class="auth-field">
            <label :for="`create-${field.key}`">{{ field.label }}</label>
            <input :id="`create-${field.key}`" v-model="form[field.key]" :type="field.type" :aria-invalid="Boolean(errors[field.key])" :aria-describedby="errors[field.key] ? `error-${field.key}` : undefined">
            <p v-if="errors[field.key]" :id="`error-${field.key}`" class="auth-error">{{ errors[field.key] }}</p>
          </div>
          <div class="auth-field"><label for="create-category">分类</label><select id="create-category" v-model="form.category"><option v-for="item in CATEGORY_META" :key="item.value" :value="item.value">{{ item.label }}</option></select><p v-if="errors.category" class="auth-error">{{ errors.category }}</p></div>
          <div class="auth-field"><label for="create-rarity">稀有度</label><select id="create-rarity" v-model="form.rarity"><option v-for="item in RARITY_META" :key="item.value" :value="item.value">{{ item.value }}</option></select><p v-if="errors.rarity" class="auth-error">{{ errors.rarity }}</p></div>
          <div class="auth-field"><label for="create-status">销售状态</label><select id="create-status" v-model="form.status"><option value="off_sale">下架</option><option value="on_sale">在售（立即展示）</option></select><p v-if="errors.status" class="auth-error">{{ errors.status }}</p></div>
          <div class="auth-field"><label for="create-image">装备图片</label><select id="create-image" v-model="form.image"><option v-for="image in images" :key="image" :value="image">{{ image.split('/').pop() }}</option></select><p v-if="errors.image" class="auth-error">{{ errors.image }}</p><EquipmentImage class="admin-create-image" :src="form.image" :name="form.name || '装备预览'" /></div>
          <div class="auth-field"><label for="create-description">装备介绍（选填，最多 500 字）</label><textarea id="create-description" v-model="form.description" rows="5" /><p v-if="errors.description" class="auth-error">{{ errors.description }}</p></div>
        </div>
        <button class="auth-submit" type="submit">{{ submitting ? '正在保存…' : '创建装备' }}</button>
      </fieldset>
    </form>
  </section>
</template>
