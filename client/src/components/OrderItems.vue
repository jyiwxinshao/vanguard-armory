<script setup>
import EquipmentImage from './EquipmentImage.vue';
import { formatMoney } from '../utils/format.js';
defineProps({ items: { type: Array, required: true }, snapshot: Boolean });
</script>
<template>
  <ul class="order-items" aria-label="订单装备明细">
    <li v-for="item in items" :key="item.equipment_id">
      <EquipmentImage :src="snapshot ? item.equipment_image : item.image" :name="snapshot ? item.equipment_name : item.name" eager />
      <div class="order-item-name"><strong>{{ snapshot ? item.equipment_name : item.name }}</strong><small>{{ item.rarity }} · {{ formatMoney(item.price) }} / 件</small></div>
      <span>× {{ item.quantity }}</span><strong>{{ formatMoney(item.price * item.quantity) }}</strong>
    </li>
  </ul>
</template>
