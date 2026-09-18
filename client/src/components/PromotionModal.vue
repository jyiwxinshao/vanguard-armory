<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { createPromotionCarousel, promotionActionClass } from '../utils/promotion-carousel.js';
import { installModalFocusTrap } from '../utils/focus-trap.js';

const props = defineProps({
  promotions: { type: Array, required: true },
});

const emit = defineEmits(['close', 'browse']);

const currentIndex = ref(0);
const failed = ref([]);
const hovering = ref(false);
const panelRef = ref(null);
let carousel = null;
let stopFocusTrap = null;

const slides = computed(() => props.promotions.filter((promotion) => promotion?.active));
const current = computed(() => slides.value[currentIndex.value] || null);
const multiple = computed(() => slides.value.length > 1);
const theme = computed(() => current.value?.theme || 'eclipse');
const actionClass = computed(() => promotionActionClass(theme.value));

function rebuild() {
  failed.value = slides.value.map(() => false);
  currentIndex.value = 0;
  carousel?.dispose();
  carousel = createPromotionCarousel({
    count: slides.value.length,
    onChange: (index) => { currentIndex.value = index; },
  });
  if (hovering.value) carousel.setHover(true);
}

function goTo(index) { carousel?.goTo(index); }
function next() { carousel?.next(); }
function previous() { carousel?.previous(); }
function setHover(value) {
  hovering.value = Boolean(value);
  carousel?.setHover(value);
}
function markFailed(index) { failed.value[index] = true; }
function browse() { if (current.value) emit('browse', current.value); }
function close() { emit('close'); }

watch(slides, rebuild, { immediate: true });
onMounted(() => {
  stopFocusTrap = installModalFocusTrap({ container: panelRef.value, onClose: close });
});
onBeforeUnmount(() => {
  stopFocusTrap?.();
  carousel?.dispose();
});
</script>

<template>
  <div class="promotion-overlay" role="presentation" @click.self="close">
    <section
      ref="panelRef"
      class="promotion-panel"
      role="dialog"
      aria-modal="true"
      aria-label="新系列宣传"
      @mouseenter="setHover(true)"
      @mouseleave="setHover(false)"
    >
      <button type="button" class="promotion-close" aria-label="关闭" @click="close">×</button>

      <button v-if="multiple" type="button" class="promotion-arrow promotion-arrow--prev" aria-label="上一张" @click="previous">‹</button>
      <button v-if="multiple" type="button" class="promotion-arrow promotion-arrow--next" aria-label="下一张" @click="next">›</button>

      <div class="promotion-poster">
        <div
          v-for="(slide, index) in slides"
          :key="slide.id"
          class="promotion-slide"
          :class="{ 'is-active': index === currentIndex, 'is-fallback': failed[index] }"
          :aria-hidden="index !== currentIndex"
        >
          <img v-if="!failed[index]" :src="slide.image" :alt="slide.series || '新系列宣传'" @error="markFailed(index)">
          <span v-else class="promotion-fallback-mark" aria-hidden="true">{{ (slide.theme || 'eclipse').toUpperCase() }}</span>
        </div>
      </div>

      <button type="button" class="promotion-browse" :class="actionClass" @click="browse">浏览系列</button>

      <div v-if="multiple" class="promotion-dots">
        <button
          v-for="(slide, index) in slides"
          :key="slide.id"
          type="button"
          class="promotion-dot"
          :class="index === currentIndex ? ['is-active', `theme-${theme}`] : []"
          :aria-label="`第 ${index + 1} 张`"
          :aria-current="index === currentIndex"
          @click="goTo(index)"
        ></button>
      </div>
    </section>
  </div>
</template>
