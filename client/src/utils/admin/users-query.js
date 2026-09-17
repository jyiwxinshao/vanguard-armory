export const ADMIN_USER_STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '正常' },
  { value: 'frozen', label: '已冻结' },
];
export const ADMIN_PAGE_SIZES = [10, 20, 50];
const first = (value) => (Array.isArray(value) ? value[0] : value);

export function parseAdminUserQuery(query = {}) {
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  const pageSizeValue = first(source.page_size);
  const pageSize = ADMIN_PAGE_SIZES.includes(Number(pageSizeValue)) ? Number(pageSizeValue) : 10;
  const rawPage = first(source.page);
  const page = /^[1-9]\d*$/.test(String(rawPage)) && Number.isSafeInteger(Number(rawPage)) ? Number(rawPage) : 1;
  const keyword = Array.from(typeof first(source.keyword) === 'string' ? first(source.keyword).trim() : '').slice(0, 50).join('');
  const status = ADMIN_USER_STATUSES.some((item) => item.value === first(source.status)) ? first(source.status) : '';
  return { keyword, status, page: Number.isSafeInteger((page - 1) * pageSize) ? page : 1, page_size: pageSize };
}

export function adminUserParams(input) {
  const values = parseAdminUserQuery(input);
  const params = { page: values.page, page_size: values.page_size };
  if (values.keyword) params.keyword = values.keyword;
  if (values.status) params.status = values.status;
  return params;
}

export function adminUserRoute(input) {
  const values = parseAdminUserQuery(input);
  const query = {};
  if (values.keyword) query.keyword = values.keyword;
  if (values.status) query.status = values.status;
  if (values.page !== 1) query.page = String(values.page);
  if (values.page_size !== 10) query.page_size = String(values.page_size);
  return query;
}
