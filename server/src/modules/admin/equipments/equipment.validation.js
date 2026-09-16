import { parseEquipmentQuery } from '../../equipments/equipment.validation.js';
import { validationError } from '../../../utils/errors.js';
import { catalogMeta } from '../../../config/catalog.js';

export function parseEquipmentCreate(body) {
  const fields = ['name', 'price', 'rarity', 'category', 'image', 'attack', 'defense', 'stock', 'status', 'description', 'series_code', 'new_until'];
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('body', '装备资料格式无效');
  for (const key of Object.keys(body)) if (!fields.includes(key)) throw validationError(key, '不支持此字段');
  const text = (key, max, required = false) => {
    if (!required && (body[key] === undefined || body[key] === null)) return null;
    if (typeof body[key] !== 'string') throw validationError(key, '必须为文字');
    const value = body[key].trim();
    if ((required && !value) || [...value].length > max) throw validationError(key, `请填写${required ? '非空且' : ''}不超过 ${max} 字的内容`);
    return value || null;
  };
  const integer = (key, max, fallback) => {
    const value = body[key] === undefined ? fallback : body[key];
    if (!Number.isSafeInteger(value) || value < (key === 'price' ? 1 : 0) || value > max) throw validationError(key, `必须为 ${key === 'price' ? 1 : 0}–${max} 的整数`);
    return value;
  };
  const name = text('name', 50, true);
  const price = integer('price', 1000000);
  if (!catalogMeta.rarities.some(({ value }) => value === body.rarity)) throw validationError('rarity', '稀有度无效');
  if (!catalogMeta.categories.some(({ value }) => value === body.category)) throw validationError('category', '分类无效');
  const image = text('image', 500, true);
  if (!/^\/images\/equipments\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.(png|webp|jpg|jpeg|svg)$/.test(image)) throw validationError('image', '请选择本地装备图片路径');
  const status = body.status === undefined ? 'off_sale' : body.status;
  if (!['off_sale', 'on_sale'].includes(status)) throw validationError('status', '只能选择在售或下架');
  let newUntil = null;
  if (body.new_until !== undefined && body.new_until !== null && body.new_until !== '') {
    const value = body.new_until;
    if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value)) throw validationError('new_until', '请提供完整 UTC 时间');
    newUntil = new Date(value);
    if (Number.isNaN(newUntil.getTime()) || newUntil.toISOString() !== value) throw validationError('new_until', '新品截止时间无效');
  }
  return { name, price, rarity: body.rarity, category: body.category, image,
    attack: integer('attack', 4294967295, 0), defense: integer('defense', 4294967295, 0), stock: integer('stock', 4294967295, 0),
    status, description: text('description', 500), series_code: text('series_code', 64), new_until: newUntil };
}

export function parseAdminEquipmentQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw validationError('query', '查询参数格式无效');
  const { page, page_size: pageSize, status, ...filters } = query;
  // Share public search rules, while admin pagination and status remain independent.
  const normalized = parseEquipmentQuery(filters);
  const integer = (value, fallback, field) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw validationError(field, '必须是安全范围内的正整数');
    }
    return Number(value);
  };
  normalized.page = integer(page, 1, 'page');
  normalized.pageSize = integer(pageSize, 10, 'page_size');
  if (![10, 20, 50].includes(normalized.pageSize)) throw validationError('page_size', '每页条数只能是 10、20 或 50');
  if (!Number.isSafeInteger((normalized.page - 1) * normalized.pageSize)) throw validationError('page', '页码超出范围');
  if (status !== undefined && (typeof status !== 'string' || !['', 'on_sale', 'off_sale', 'deleted'].includes(status))) {
    throw validationError('status', '装备状态无效');
  }
  return { ...normalized, status: status || '' };
}
