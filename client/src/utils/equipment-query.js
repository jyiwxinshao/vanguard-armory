export const EQUIPMENT_RARITIES = ['SSR', 'SR', 'R', 'N'];
export const EQUIPMENT_CATEGORIES = ['weapon', 'armor', 'accessory', 'consumable'];
export const EQUIPMENT_SORTS = ['newest', 'price_asc', 'price_desc', 'rarity_desc'];

const PAGE_SIZES = [8, 12, 16];
const firstValue = (value) => Array.isArray(value) ? value[0] : value;
const textValue = (value) => typeof firstValue(value) === 'string' ? firstValue(value).trim() : '';

function positiveInteger(value, fallback) {
  const candidate = firstValue(value);
  if (typeof candidate !== 'number' && (typeof candidate !== 'string' || !/^\d+$/u.test(candidate))) return fallback;
  const number = Number(candidate);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function parseEquipmentQuery(query = {}) {
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  const rarityValues = (Array.isArray(source.rarities) ? source.rarities : [source.rarities])
    .flatMap((value) => typeof value === 'string' ? value.split(',').map((rarity) => rarity.trim()) : []);
  const category = textValue(source.category);
  const sort = textValue(source.sort);
  const pageSize = positiveInteger(source.page_size, 12);

  return {
    keyword: Array.from(textValue(source.keyword)).slice(0, 50).join(''),
    rarities: EQUIPMENT_RARITIES.filter((rarity) => rarityValues.includes(rarity)),
    category: EQUIPMENT_CATEGORIES.includes(category) ? category : '',
    sort: EQUIPMENT_SORTS.includes(sort) ? sort : 'newest',
    page: positiveInteger(source.page, 1),
    page_size: PAGE_SIZES.includes(pageSize) ? pageSize : 12,
  };
}

export function equipmentQueryToRoute(filters) {
  const normalized = parseEquipmentQuery(filters);
  const query = {};
  if (normalized.keyword) query.keyword = normalized.keyword;
  if (normalized.rarities.length) query.rarities = normalized.rarities.join(',');
  if (normalized.category) query.category = normalized.category;
  if (normalized.sort !== 'newest') query.sort = normalized.sort;
  if (normalized.page !== 1) query.page = String(normalized.page);
  if (normalized.page_size !== 12) query.page_size = String(normalized.page_size);
  return query;
}

export function equipmentQueryToParams(filters) {
  const normalized = parseEquipmentQuery(filters);
  const params = { sort: normalized.sort, page: normalized.page, page_size: normalized.page_size };
  if (normalized.keyword) params.keyword = normalized.keyword;
  if (normalized.rarities.length) params.rarities = normalized.rarities.join(',');
  if (normalized.category) params.category = normalized.category;
  return params;
}

export function safeCatalogReturn(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  const forbidden = /[\\\u0000-\u001f\u007f-\u009f]/u;
  try {
    if (forbidden.test(value) || forbidden.test(decodeURIComponent(value))) return '/';
    // Check the supplied path before URL normalizes dot segments such as /account/../.
    if (value.split(/[?#]/u, 1)[0] !== '/') return '/';
    const url = new URL(value, 'https://game-store.invalid');
    if (url.origin !== 'https://game-store.invalid' || url.pathname !== '/') return '/';
    const query = {};
    for (const key of ['keyword', 'rarities', 'category', 'sort', 'page', 'page_size']) {
      const values = url.searchParams.getAll(key);
      if (values.length) query[key] = values;
    }
    const search = new URLSearchParams(equipmentQueryToRoute(query)).toString();
    return search ? `/?${search}` : '/';
  } catch {
    return '/';
  }
}

export function keywordIssue(value) {
  return Array.from(textValue(value)).length > 50 ? '搜索关键词最多 50 个字符' : '';
}
