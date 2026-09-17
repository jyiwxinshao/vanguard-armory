import { orderStatuses } from '../orders.js';

export const ADMIN_ORDER_STATUSES = [{ value: '', label: '全部状态' }, ...orderStatuses];
export const ADMIN_PAGE_SIZES = [10, 20, 50];
const first = (value) => (Array.isArray(value) ? value[0] : value);

export function parseAdminOrderQuery(query = {}) {
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  const pageSizeValue = first(source.page_size);
  const pageSize = ADMIN_PAGE_SIZES.includes(Number(pageSizeValue)) ? Number(pageSizeValue) : 10;
  const rawPage = first(source.page);
  const page = /^[1-9]\d*$/.test(String(rawPage)) && Number.isSafeInteger(Number(rawPage)) ? Number(rawPage) : 1;
  const status = orderStatuses.some((item) => item.value === first(source.status)) ? first(source.status) : '';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(first(source.from))) ? String(first(source.from)) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(first(source.to))) ? String(first(source.to)) : '';
  const rawUserId = first(source.user_id);
  const user_id = /^[1-9]\d*$/.test(String(rawUserId)) && Number.isSafeInteger(Number(rawUserId)) ? String(rawUserId) : '';
  return { status, from, to, user_id, page: Number.isSafeInteger((page - 1) * pageSize) ? page : 1, page_size: pageSize };
}

export function adminOrderParams(input) {
  const values = parseAdminOrderQuery(input);
  if (values.from && values.to && values.from > values.to) throw new Error('结束日期不能早于开始日期');
  const params = { page: values.page, page_size: values.page_size };
  if (values.status) params.status = values.status;
  if (values.user_id) params.user_id = values.user_id;
  for (const [field, value] of [['created_from', values.from], ['created_to', values.to]]) {
    if (!value) continue;
    const date = new Date(`${value}T00:00:00.000`);
    if (!Number.isFinite(date.getTime())) throw new Error('请输入有效日期');
    // The chosen end date is inclusive; the API uses an exclusive upper bound.
    if (field === 'created_to') date.setDate(date.getDate() + 1);
    params[field] = date.toISOString();
  }
  return params;
}

export function adminOrderRoute(input) {
  const values = parseAdminOrderQuery(input);
  const query = {};
  if (values.status) query.status = values.status;
  if (values.from) query.from = values.from;
  if (values.to) query.to = values.to;
  if (values.user_id) query.user_id = values.user_id;
  if (values.page !== 1) query.page = String(values.page);
  if (values.page_size !== 10) query.page_size = String(values.page_size);
  return query;
}
