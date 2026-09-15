import { validationError } from '../../utils/errors.js';

export const CART_ITEM_QUANTITY_MAX = 9999;
export const MAX_CART_RESOURCE_ID = 4294967295;

function validateBody(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('body', '请提交 JSON 对象');
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) throw validationError(key, '不允许提交此字段');
  }
}

function positiveInteger(value, field, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw validationError(field, `${label}必须是正整数`);
  if (value > MAX_CART_RESOURCE_ID) throw validationError(field, `${label}超出范围`);
  return value;
}

export function parseAddItem(body) {
  validateBody(body, ['equipment_id', 'quantity']);
  const equipmentId = positiveInteger(body.equipment_id, 'equipment_id', '装备 ID');
  const quantity = positiveInteger(body.quantity, 'quantity', '购买数量');
  if (quantity > CART_ITEM_QUANTITY_MAX) throw validationError('quantity', `购买数量不能超过 ${CART_ITEM_QUANTITY_MAX}`);
  return { equipmentId, quantity };
}

export function parseUpdateItem(body) {
  validateBody(body, ['quantity']);
  const quantity = positiveInteger(body.quantity, 'quantity', '购买数量');
  if (quantity > CART_ITEM_QUANTITY_MAX) throw validationError('quantity', `购买数量不能超过 ${CART_ITEM_QUANTITY_MAX}`);
  return { quantity };
}

export function parseCartItemId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d*$/.test(text)) throw validationError('id', '购物车明细 ID 必须是正整数');
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id > MAX_CART_RESOURCE_ID) throw validationError('id', '购物车明细 ID 超出范围');
  return id;
}

export const CART_KINDS_MAX = 100;

export function parseMerge(body) {
  validateBody(body, ['merge_id', 'items']);
  if (typeof body.merge_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.merge_id)) {
    throw validationError('merge_id', '合并批次 ID 必须是 UUID v4');
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > CART_KINDS_MAX) {
    throw validationError('items', '每次合并需要 1–100 项装备');
  }
  const quantities = new Map();
  for (const entry of body.items) {
    const { equipmentId, quantity } = parseAddItem(entry);
    quantities.set(equipmentId, (quantities.get(equipmentId) || 0) + quantity);
  }
  const items = [...quantities].sort(([a], [b]) => a - b).map(([equipment_id, quantity]) => ({ equipment_id, quantity }));
  return { mergeId: body.merge_id.toLowerCase(), items };
}

export function parseBatchDelete(body) {
  validateBody(body, ['ids']);
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > CART_KINDS_MAX) throw validationError('ids', '请选择 1–100 项购物车明细');
  return [...new Set(body.ids.map((id) => positiveInteger(id, 'ids', '购物车明细 ID')))].sort((a, b) => a - b);
}
