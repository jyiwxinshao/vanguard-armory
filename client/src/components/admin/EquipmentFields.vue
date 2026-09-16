<script setup>
import { computed } from 'vue';
import { CATEGORY_META, RARITY_META } from '../../utils/equipment-display.js';
import EquipmentImage from '../EquipmentImage.vue';
const props = defineProps({ form: { type: Object, required: true }, errors: { type: Object, default: () => ({}) }, editing: Boolean });
// Parent owns the form and submit lifecycle; this component only edits its fields.
const availableImages = Object.keys(import.meta.glob('/public/images/equipments/*.{png,webp,jpg,jpeg,svg}')).map((path) => path.replace('/public', '')).sort();
const images = computed(() => [...new Set([...availableImages, props.form.image].filter(Boolean))]);
const textFields = computed(() => [{ key: 'name', label: '装备名称', type: 'text' }, { key: 'price', label: '价格（元）', type: 'text' }, { key: 'stock', label: '初始库存', type: 'text' }, { key: 'attack', label: '攻击力', type: 'text' }, { key: 'defense', label: '防御力', type: 'text' }, { key: 'series_code', label: '系列标识（选填）', type: 'text' }, { key: 'new_until', label: '新品截止时间（本地时间，选填）', type: 'datetime-local' }].filter((field) => !props.editing || field.key !== 'stock'));
</script>

<template>
<div class="admin-create-fields">
          <div v-for="field in textFields" :key="field.key" class="auth-field">
            <label :for="`create-${field.key}`">{{ field.label }}</label>
            <input :id="`create-${field.key}`" v-model="form[field.key]" :type="field.type" :step="field.type === 'datetime-local' ? 1 : undefined" :aria-invalid="Boolean(errors[field.key])" :aria-describedby="errors[field.key] ? `error-${field.key}` : undefined">
            <p v-if="errors[field.key]" :id="`error-${field.key}`" class="auth-error">{{ errors[field.key] }}</p>
          </div>
          <div class="auth-field"><label for="create-category">分类</label><select id="create-category" v-model="form.category"><option v-for="item in CATEGORY_META" :key="item.value" :value="item.value">{{ item.label }}</option></select><p v-if="errors.category" class="auth-error">{{ errors.category }}</p></div>
          <div class="auth-field"><label for="create-rarity">稀有度</label><select id="create-rarity" v-model="form.rarity"><option v-for="item in RARITY_META" :key="item.value" :value="item.value">{{ item.value }}</option></select><p v-if="errors.rarity" class="auth-error">{{ errors.rarity }}</p></div>
          <div class="auth-field"><label for="create-status">销售状态</label><select id="create-status" v-model="form.status"><option value="off_sale">下架</option><option value="on_sale">在售（立即展示）</option></select><p v-if="errors.status" class="auth-error">{{ errors.status }}</p></div>
          <div class="auth-field"><label for="create-image">装备图片</label><select id="create-image" v-model="form.image"><option v-for="image in images" :key="image" :value="image">{{ image.split('/').pop() }}</option></select><p v-if="errors.image" class="auth-error">{{ errors.image }}</p><EquipmentImage class="admin-create-image" :src="form.image" :name="form.name || '装备预览'" /></div>
          <div class="auth-field"><label for="create-description">装备介绍（选填，最多 500 字）</label><textarea id="create-description" v-model="form.description" rows="5" /><p v-if="errors.description" class="auth-error">{{ errors.description }}</p></div>
        </div>
</template>
