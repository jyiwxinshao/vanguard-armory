<script setup>
import { ref } from 'vue';

defineProps({
  promotion: { type: Object, required: true },
});

const emit = defineEmits(['close', 'browse']);
const imageFailed = ref(false);
</script>

<template>
  <div class="promotion-overlay" role="presentation" @click.self="emit('close')">
    <section class="promotion-panel" role="dialog" aria-modal="true" aria-label="新系列宣传">
      <button type="button" class="promotion-close" aria-label="关闭" @click="emit('close')">×</button>

      <div class="promotion-poster" :class="{ 'is-fallback': imageFailed }">
        <img v-if="!imageFailed" :src="promotion.image" :alt="promotion.keyword || '新系列宣传'" @error="imageFailed = true">
        <span v-else class="promotion-fallback-mark" aria-hidden="true">ECLIPSE</span>
      </div>

      <button type="button" class="promotion-browse" @click="emit('browse', promotion)">浏览系列</button>
    </section>
  </div>
</template>
