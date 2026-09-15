import { validationError } from '../../utils/errors.js';
import { catalogMeta } from '../../config/catalog.js';

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'completed'];
export const ORDER_TOTAL_MAX = 100000000;
const servers = new Set(catalogMeta.servers.map((item) => item.value));
function object(value, fields, field = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError(field, '请提交 JSON 对象');
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw validationError(key, '不允许提交此字段');
}
function integer(value, field, max = 4294967295) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw validationError(field, `必须是 1–${max} 的整数`);
  return value;
}
function text(value, field, min, max) {
  if (typeof value !== 'string') throw validationError(field, '必须是字符串');
  const result = value.trim();
  if (Array.from(result).length < min || Array.from(result).length > max || /[\u0000-\u001f\u007f]/u.test(result)) throw validationError(field, `请输入 ${min}–${max} 个字符，不包含控制字符`);
  return result;
}
export function parseOrderId(value) {
  if (typeof value === 'number') return integer(value, 'id');
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw validationError('id', '订单 ID 必须是正整数');
  return integer(Number(value), 'id');
}
export function parseRequestId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw validationError('request_id', '提交编号必须是 UUID v4');
  return value.toLowerCase();
}
export function parseCreateOrder(body) {
  object(body, ['request_id', 'items', 'character_name', 'server', 'remark']);
  const requestId = parseRequestId(body.request_id);
  const characterName = text(body.character_name, 'character_name', 2, 10);
  if (typeof body.server !== 'string' || !servers.has(body.server)) throw validationError('server', '请选择有效的游戏服务器');
  const remark = body.remark === undefined ? '' : text(body.remark, 'remark', 0, 200);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw validationError('items', '需要 1–100 项确认装备');
  const equipmentIds = new Set(); const cartIds = new Set();
  const items = body.items.map((item) => {
    object(item, ['cart_item_id', 'equipment_id', 'quantity', 'expected_price'], 'items');
    const cart_item_id = integer(item.cart_item_id, 'items');
    const equipment_id = integer(item.equipment_id, 'items');
    const quantity = integer(item.quantity, 'items', 9999);
    const expected_price = integer(item.expected_price, 'items', 1000000);
    if (equipmentIds.has(equipment_id) || cartIds.has(cart_item_id)) throw validationError('items', '确认条目不能重复');
    equipmentIds.add(equipment_id); cartIds.add(cart_item_id);
    return { cart_item_id, equipment_id, quantity, expected_price };
  }).sort((a, b) => a.equipment_id - b.equipment_id);
  return { requestId, characterName, server: body.server, remark, items };
}
export function parseOrderAction(body) {
  if (body !== undefined) object(body, []);
}
export function parseOrderQuery(query = {}) {
  object(query, ['status', 'created_from', 'created_to', 'page', 'page_size'], 'query');
  const status = query.status ?? '';
  if (typeof status !== 'string' || (status && !ORDER_STATUSES.includes(status))) throw validationError('status', '订单状态无效');
  function pageValue(field, fallback, max) {
    const value = query[field] ?? String(fallback);
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw validationError(field, '分页参数必须为正整数');
    return integer(Number(value), field, max);
  }
  const page = pageValue('page', 1, 1000000);
  const pageSize = pageValue('page_size', 10, 50);
  if (![10, 20, 50].includes(pageSize)) throw validationError('page_size', '每页数量只能为 10、20、50');
  function date(field) {
    const value = query[field];
    if (value === undefined || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw validationError(field, '日期必须是带 Z 的 ISO 时间');
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z') || parsed.getUTCFullYear() < 1000) throw validationError(field, '日期无效');
    return parsed;
  }
  const from = date('created_from'); const to = date('created_to');
  if (from && to && from > to) throw validationError('created_to', '结束时间不能早于开始时间');
  return { status, from, to, page, pageSize };
}
