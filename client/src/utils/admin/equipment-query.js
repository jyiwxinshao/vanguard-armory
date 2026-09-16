import { parseEquipmentQuery } from '../equipment-query.js';

export const ADMIN_EQUIPMENT_STATUSES = [
  { value: '', label: '全部（不含已删除）' },
  { value: 'on_sale', label: '在售' },
  { value: 'off_sale', label: '已下架' },
  { value: 'deleted', label: '已删除' },
];
export const ADMIN_PAGE_SIZES = [10, 20, 50];
const first = (value) => Array.isArray(value) ? value[0] : value;

export function parseAdminEquipmentQuery(query = {}) {
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  const value = first(source.page_size);
  const pageSize = ADMIN_PAGE_SIZES.includes(Number(value)) ? Number(value) : 10;
  const rawPage = first(source.page);
  const page = /^[1-9]\d*$/.test(String(rawPage)) && Number.isSafeInteger(Number(rawPage)) ? Number(rawPage) : 1;
  const status = first(source.status);
  return {
    ...parseEquipmentQuery(source),
    series: Array.from(typeof first(source.series) === 'string' ? first(source.series).trim() : '').slice(0, 64).join(''),
    page: Number.isSafeInteger((page - 1) * pageSize) ? page : 1,
    page_size: pageSize,
    status: ADMIN_EQUIPMENT_STATUSES.some((option) => option.value === status) ? status : '',
  };
}

export function adminEquipmentParams(input) {
  const filters = parseAdminEquipmentQuery(input);
  const params = { page: filters.page, page_size: filters.page_size, sort: filters.sort };
  for (const key of ['keyword', 'category', 'series', 'status']) if (filters[key]) params[key] = filters[key];
  if (filters.rarities.length) params.rarities = filters.rarities.join(',');
  if (filters.in_stock) params.in_stock = '1';
  return params;
}

export function adminEquipmentRoute(input) {
  const params = adminEquipmentParams(input);
  if (params.page === 1) delete params.page;
  if (params.page_size === 10) delete params.page_size;
  if (params.sort === 'newest') delete params.sort;
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
}
