<script setup>
import { useRoute } from 'vue-router';
import AdminPlaceholder from '../../components/admin/AdminPlaceholder.vue';
const route = useRoute();
</script>
<template><AdminPlaceholder :title="route.params.id ? '编辑装备' : '新增装备'" description="维护装备属性、图片、新品期限与系列归属。" back-to="/admin/equipments" /></template>
