export function cartItemIssue(item) {
  if (!item || item.available) return '';
  if (item.reason === 'checking') return '正在核验装备';
  if (item.reason === 'unverified') return '暂无法核验，请刷新重试';
  if (item.reason === 'unavailable') return '装备不可用';
  if (item.status === 'deleted') return '已删除';
  if (item.status === 'off_sale') return '已下架';
  if (item.stock === 0) return '已售罄';
  return '库存不足';
}

export function selectedCartItems(items, selectedIds) {
  const ids = new Set(selectedIds);
  return items.filter((item) => item.available && ids.has(item.id));
}

export function selectedCartQuantity(items, selectedIds) {
  return selectedCartItems(items, selectedIds).reduce((total, item) => total + item.quantity, 0);
}

export function selectedCartTotal(items, selectedIds) {
  return selectedCartItems(items, selectedIds).reduce((total, item) => total + item.subtotal, 0);
}

export function mergeAdjustmentMessage(item) {
  const reasons = { stock_limit: '库存不足', quantity_limit: '数量达到上限', off_sale: '已下架', deleted: '已删除', sold_out: '已售罄', not_found: '装备不存在' };
  return `装备 #${item.equipment_id}：${reasons[item.reason] || '数量已调整'}，期望 ${item.requested_quantity} 件，服务器保留 ${item.accepted_quantity} 件`;
}
