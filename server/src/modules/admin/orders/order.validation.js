import { validationError } from '../../../utils/errors.js';
import { parseOrderId, parseOrderQuery } from '../../orders/orders.validation.js';

function validateObject(value, fields, field = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError(field, '格式无效');
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw validationError(key, '不支持此字段');
}

export function parseAdminOrderId(value) {
  return parseOrderId(value);
}

export function parseAdminOrderQuery(query = {}) {
  validateObject(query, ['user_id', 'status', 'order_no', 'created_from', 'created_to', 'page', 'page_size'], 'query');
  const { user_id: rawUserId, ...orderQuery } = query;
  const { status, orderNo, from, to, page, pageSize } = parseOrderQuery(orderQuery);
  let userId = null;
  if (rawUserId !== undefined && rawUserId !== '') {
    if (typeof rawUserId !== 'string') throw validationError('user_id', '用户 ID 无效');
    userId = parseOrderId(rawUserId);
  }
  return { userId, status, orderNo, from, to, page, pageSize };
}

export function parseAdminOrderStatus(body) {
  validateObject(body, ['status']);
  if (typeof body.status !== 'string' || !['cancelled', 'completed'].includes(body.status)) {
    throw validationError('status', '只能取消订单或完成交付');
  }
  return body.status;
}
