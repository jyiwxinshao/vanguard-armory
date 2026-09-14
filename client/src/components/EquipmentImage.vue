<script setup>
import { ref, watch } from 'vue';
import { equipmentImageSource, EQUIPMENT_PLACEHOLDER, nextEquipmentImage } from '../utils/equipment-image.js';

const props = defineProps({ src: String, name: { type: String, default: '装备' }, eager: Boolean });
const source = ref(EQUIPMENT_PLACEHOLDER);
watch(() => props.src, (value) => { source.value = equipmentImageSource(value); }, { immediate: true });
function handleError() { source.value = nextEquipmentImage(source.value); }
</script>

<template>
  <img v-if="source" :src="source" :alt="source === EQUIPMENT_PLACEHOLDER ? `${name}图片占位` : name" :loading="eager ? 'eager' : 'lazy'" decoding="async" @error="handleError">
  <span v-else class="equipment-image-unavailable" role="img" :aria-label="`${name}图片暂不可用`">暂无图片</span>
</template>
