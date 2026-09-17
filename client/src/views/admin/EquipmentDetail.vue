<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import EquipmentImage from '../../components/EquipmentImage.vue';
import { getAdminEquipment, removeAdminEquipment } from '../../api/admin/equipments.js';
import { useAuthStore } from '../../stores/auth.js';
import { canAccessAdmin } from '../../router/guards.js';
import { createLatestRequest } from '../../utils/latest-request.js';
import { isUncertainRequest } from '../../utils/request-state.js';
import { requestMessage } from '../../utils/auth.js';
import { formatMoney } from '../../utils/format.js';
import { categoryLabel, isNewItem } from '../../utils/equipment-display.js';
import { ADMIN_EQUIPMENT_STATUSES } from '../../utils/admin/equipment-query.js';
import { adminEquipmentIssue, formatEquipmentDate, safeAdminEquipmentReturn } from '../../utils/admin/equipment-detail.js';

const route = useRoute();
const auth = useAuthStore();
const equipment = ref(null);
const loading = ref(false);
const issue = ref(null);
const deleting = ref(false);
const uncertain = ref(false);
const needsReload = ref(false);
const confirmDelete = ref(false);
const deleteMessage = ref('');
const deleteError = ref('');
const backTo = computed(() => safeAdminEquipmentReturn(route.query.returnTo));
const statusLabel = computed(() => ADMIN_EQUIPMENT_STATUSES.find(({ value }) => value === equipment.value?.status)?.label || '未知状态');

const request = createLatestRequest();
let active = true;
let generation = 0;
let writeController;

function sessionGuard() {
  const token = auth.token;
  const revision = auth.revision;
  const version = generation;
  const routeId = route.params.id;
  return () => active && generation === version && route.params.id === routeId
    && canAccessAdmin(auth) && auth.isCurrentSession(token, revision);
}

function load() {
  generation++;
  writeController?.abort();
  deleting.value = false;
  equipment.value = null;
  const current = sessionGuard();
  if (!current()) { request.cancel(); loading.value = false; return; }
  return request.run((signal) => getAdminEquipment(route.params.id, { signal, sessionGuard: current }), {
    onStart: () => { issue.value = null; deleteError.value = ''; deleteMessage.value = ''; confirmDelete.value = false; loading.value = true; },
    onSuccess: (result) => { if (current()) { equipment.value = result; uncertain.value = false; needsReload.value = false; } },
    onError: (error) => { if (current()) issue.value = adminEquipmentIssue(error); },
    onFinish: () => { if (current()) loading.value = false; },
  });
}

async function removeEquipment() {
  if (deleting.value || uncertain.value || needsReload.value || !equipment.value || equipment.value.status === 'deleted') return;
  const id = equipment.value.id;
  const currentWrite = sessionGuard();
  // Route params are strings; MySQL may return a numeric ID.
  if (!currentWrite() || String(route.params.id) !== String(id)) return;
  const previous = equipment.value;
  confirmDelete.value = false;
  deleting.value = true;
  deleteError.value = '';
  deleteMessage.value = '';
  uncertain.value = false;
  writeController = new AbortController();
  try {
    const deleted = await removeAdminEquipment(id, { signal: writeController.signal, sessionGuard: currentWrite });
    if (!currentWrite()) return;
    equipment.value = deleted;
    deleteMessage.value = '装备已删除，商城不再展示，历史订单快照仍保留。';
  } catch (error) {
    if (!currentWrite()) return;
    if (isUncertainRequest(error)) uncertain.value = true;
    else {
      equipment.value = previous;
      needsReload.value = [404, 409].includes(error.response?.status);
      deleteError.value = requestMessage(error, '装备删除失败，请重试');
    }
  } finally { if (currentWrite()) deleting.value = false; }
}
watch(() => route.params.id, load, { immediate: true });
onUnmounted(() => { active = false; generation++; request.dispose(); writeController?.abort(); });
</script>

<template>
  <section class="admin-module" aria-labelledby="admin-equipment-detail-title">
    <RouterLink class="admin-back" :to="backTo">← 返回装备列表</RouterLink>
    <header class="admin-module-heading"><h1 id="admin-equipment-detail-title">装备详情</h1><p>查看装备完整资料与当前销售状态。</p></header>
    <div v-if="loading" class="admin-list-message admin-detail-content" role="status">正在加载装备…</div>
    <div v-else-if="issue" class="admin-list-message admin-detail-content" role="alert"><p>{{ issue.message }}</p><button v-if="issue.retry" type="button" class="primary-button" @click="load">重新加载</button></div>
    <article v-else-if="equipment" class="admin-detail-content">
      <RouterLink v-if="equipment.status !== 'deleted'" class="admin-back" :to="{ path: `/admin/equipments/${equipment.id}/edit`, query: { returnTo: backTo } }">编辑资料与上下架</RouterLink>
      <RouterLink class="admin-back admin-stock-link" :to="{ path: `/admin/equipments/${equipment.id}/stock`, query: { returnTo: backTo } }">{{ equipment.status === 'deleted' ? '核对历史库存操作' : '调整库存' }}</RouterLink>
      <div class="admin-detail-summary">
        <EquipmentImage :src="equipment.image" :name="equipment.name" />
        <div><p class="admin-detail-id">装备 #{{ equipment.id }} <span v-if="isNewItem(equipment)" class="admin-new-label">新品</span></p><h2>{{ equipment.name }}</h2><p class="admin-money">{{ formatMoney(equipment.price) }}</p><span class="admin-equipment-status" :class="`is-${equipment.status}`">{{ statusLabel }}</span>
          <p v-if="equipment.status === 'deleted'" class="admin-detail-note">此装备已删除，商城不再展示，历史订单快照仍保留。</p>
          <p v-else-if="equipment.status === 'off_sale'" class="admin-detail-note">此装备已下架，商城不再展示。</p>
          <p v-else-if="equipment.stock === 0" class="admin-detail-note">此装备已售罄，商城可查看但不能购买。</p>
        </div>
      </div>
      <dl class="admin-detail-fields">
        <div><dt>分类</dt><dd>{{ categoryLabel(equipment.category) }}</dd></div>
        <div><dt>稀有度</dt><dd>{{ equipment.rarity }}</dd></div>
        <div><dt>可售库存</dt><dd>{{ equipment.stock }} 件</dd></div>
        <div><dt>攻击力</dt><dd>{{ equipment.attack }}</dd></div>
        <div><dt>防御力</dt><dd>{{ equipment.defense }}</dd></div>
        <div><dt>系列标识</dt><dd>{{ equipment.series_code || '未归属系列' }}</dd></div>
        <div><dt>新品截止时间</dt><dd>{{ formatEquipmentDate(equipment.new_until) }}</dd></div>
        <div><dt>创建时间</dt><dd>{{ formatEquipmentDate(equipment.created_at) }}</dd></div>
        <div><dt>更新时间</dt><dd>{{ formatEquipmentDate(equipment.updated_at) }}</dd></div>
      </dl>
      <section class="admin-detail-description"><h2>装备介绍</h2><p>{{ equipment.description || '暂无介绍' }}</p></section>
      <section v-if="equipment.status !== 'deleted'" class="admin-detail-description admin-detail-content">
        <h2>删除装备</h2>
        <p class="admin-detail-note">删除采用软删除；关联未完成订单时会被拒绝，历史订单快照不受影响。</p>
        <p v-if="deleteMessage" class="admin-result-count" role="status">{{ deleteMessage }}</p>
        <p v-if="deleteError" class="auth-error" role="alert">{{ deleteError }}</p>
        <div v-if="uncertain || needsReload" class="admin-list-message" role="alert">
          <p>{{ uncertain ? '操作结果待确认，请重新获取最新状态。' : '资料可能已发生变化，请重新获取最新状态后再操作。' }}</p>
          <button type="button" class="primary-button" :disabled="loading" @click="load">重新获取最新状态</button>
        </div>
        <button v-else-if="!confirmDelete" type="button" class="cart-toolbar-button" :disabled="deleting || uncertain || needsReload" @click="confirmDelete = true">删除装备</button>
        <template v-else>
          <p class="auth-error" role="alert">确认删除此装备？</p>
          <button type="button" class="primary-button" :disabled="deleting || uncertain || needsReload" @click="removeEquipment">{{ deleting ? '正在处理…' : '确认删除' }}</button>
          <button type="button" class="cart-toolbar-button" :disabled="deleting || uncertain || needsReload" @click="confirmDelete = false">保留装备</button>
        </template>
      </section>
    </article>
  </section>
</template>
