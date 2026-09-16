<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, required: true },
  backTo: { type: String, default: '' },
});
</script>

<template>
  <section class="admin-module">
    <RouterLink v-if="backTo" :to="backTo" class="admin-back">← 返回列表</RouterLink>
    <header class="admin-module-heading"><h1>{{ title }}</h1><p>{{ description }}</p></header>
    <div class="admin-placeholder" role="status">
      <span class="admin-stage-label">准备中</span>
      <h2>此功能尚未开放</h2>
      <p>管理中心正在建设，功能开放后可在此查看和处理。</p>
    </div>
  </section>
</template>
