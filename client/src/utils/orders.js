export const orderStatuses = [
  { value: 'pending', label: '待支付' }, { value: 'paid', label: '已支付，待交付' },
  { value: 'cancelled', label: '已取消' }, { value: 'completed', label: '已完成' },
];
export const orderStatusLabel = (value) => orderStatuses.find((item) => item.value === value)?.label || '未知状态';
export const orderAmountLabel = (status) => ['paid', 'completed'].includes(status) ? '实付金额' : status === 'cancelled' ? '订单金额' : '应付金额';
export function formatOrderDate(value) { return value ? new Date(value).toLocaleString('zh-CN') : '—'; }
export function checkoutErrors(values, servers) {
  const errors = {};
  if (!servers.some((server) => server.value === values.server)) errors.server = '请选择游戏服务器';
  if (!Number.isSafeInteger(values.character_id) || values.character_id < 1) errors.character_id = '请先选择服务器并确认账号角色';
  return errors;
}
export function confirmationItems(items) {
  return items.map((item) => ({ cart_item_id: item.id, equipment_id: item.equipment_id, quantity: item.quantity, expected_price: item.price })).sort((a, b) => a.equipment_id - b.equipment_id);
}
export function orderQueryFromRoute(query) {
  const scalar = (key) => typeof query[key] === 'string' ? query[key] : '';
  const page = /^[1-9]\d*$/.test(scalar('page')) ? Math.min(Number(scalar('page')), 1000000) : 1;
  const pageSize = [10, 20, 50].includes(Number(scalar('page_size'))) ? Number(scalar('page_size')) : 10;
  return { status: orderStatuses.some((item) => item.value === scalar('status')) ? scalar('status') : '', from: /^\d{4}-\d{2}-\d{2}$/.test(scalar('from')) ? scalar('from') : '', to: /^\d{4}-\d{2}-\d{2}$/.test(scalar('to')) ? scalar('to') : '', page, page_size: pageSize };
}
export function orderQueryToApi(values) {
  const params = { page: values.page, page_size: values.page_size };
  if (values.status) params.status = values.status;
  if (values.from && values.to && values.from > values.to) throw new Error('结束日期不能早于开始日期');
  for (const [field, value] of [['created_from', values.from], ['created_to', values.to]]) {
    if (!value) continue;
    const date = new Date(`${value}T00:00:00.000`);
    if (!Number.isFinite(date.getTime()) || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` !== value) throw new Error('请输入有效日期');
    // The UI includes the chosen end date; the API uses an exclusive upper bound.
    if (field === 'created_to') date.setDate(date.getDate() + 1);
    params[field] = date.toISOString();
  }
  return params;
}
