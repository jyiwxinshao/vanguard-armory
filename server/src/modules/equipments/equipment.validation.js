import { validationError } from '../../utils/errors.js';
import { catalogMeta } from '../../config/catalog.js';

const rarityValues = new Set(catalogMeta.rarities.map(({ value }) => value));
const categoryValues = new Set(catalogMeta.categories.map(({ value }) => value));
export const equipmentSorts = Object.freeze({
  newest: 'created_at DESC, id DESC',
  price_asc: 'price ASC, id DESC',
  price_desc: 'price DESC, id DESC',
  rarity_desc: "CASE rarity WHEN 'SSR' THEN 4 WHEN 'SR' THEN 3 WHEN 'R' THEN 2 WHEN 'N' THEN 1 END DESC, id DESC",
});

function validateKeys(query, allowed) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw validationError('query', '查询参数格式无效');
  for (const key of Object.keys(query)) {
    if (!allowed.includes(key)) throw validationError(key, '不支持此查询条件');
  }
}

function readPositiveInteger(query, key, fallback) {
  if (query[key] === undefined) return fallback;
  if (typeof query[key] !== 'string' || !/^[1-9]\d*$/.test(query[key])) throw validationError(key, '必须是正整数');
  const value = Number(query[key]);
  if (!Number.isSafeInteger(value)) throw validationError(key, '数值超出范围');
  return value;
}

function readPagination(query) {
  const page = readPositiveInteger(query, 'page', 1);
  const pageSize = readPositiveInteger(query, 'page_size', 12);
  if (![8, 12, 16].includes(pageSize)) throw validationError('page_size', '每页条数只能是 8、12 或 16');
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw validationError('page', '页码超出范围');
  return { page, pageSize };
}

function readOptionalString(query, key) {
  if (query[key] === undefined) return '';
  if (typeof query[key] !== 'string') throw validationError(key, '只能提供一个字符串值');
  return query[key].trim();
}

export function parsePagination(query = {}) {
  validateKeys(query, ['page', 'page_size']);
  return readPagination(query);
}

export function parseEquipmentQuery(query = {}) {
  validateKeys(query, ['page', 'page_size', 'keyword', 'rarities', 'category', 'sort', 'in_stock', 'series']);
  const pagination = readPagination(query);
  const keyword = readOptionalString(query, 'keyword');
  if ([...keyword].length > 50) throw validationError('keyword', '关键词最多 50 个字符');
  const rarityInput = readOptionalString(query, 'rarities');
  const rarities = rarityInput ? [...new Set(rarityInput.split(',').map((value) => value.trim()))] : [];
  if (rarities.some((rarity) => !rarityValues.has(rarity))) throw validationError('rarities', '稀有度只能选择 SSR、SR、R、N');
  const category = readOptionalString(query, 'category');
  if (category && !categoryValues.has(category)) throw validationError('category', '装备分类无效');
  const sort = readOptionalString(query, 'sort') || 'newest';
  if (!Object.hasOwn(equipmentSorts, sort)) throw validationError('sort', '排序方式无效');
  const stockInput = query.in_stock === undefined ? '' : query.in_stock;
  if (typeof stockInput !== 'string' || !['', '0', '1'].includes(stockInput)) throw validationError('in_stock', '库存筛选只能是 1 或 0');
  const series = readOptionalString(query, 'series');
  if ([...series].length > 64) throw validationError('series', '系列标识最多 64 个字符');
  return { ...pagination, keyword, rarities, category, sort, inStock: stockInput === '1', series };
}

export function parseEquipmentId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw validationError('id', '装备 ID 必须是正整数');
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 4294967295) throw validationError('id', '装备 ID 超出范围');
  return id;
}
