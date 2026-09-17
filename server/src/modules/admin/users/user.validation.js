import { validationError } from '../../../utils/errors.js';

function validateObject(value, fields, field = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError(field, '格式无效');
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw validationError(key, '不支持此字段');
}

function positiveInteger(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw validationError(field, '必须是安全范围内的正整数');
  return Number(value);
}

export function parseAdminUserId(value) {
  const id = positiveInteger(value, 'id', undefined);
  if (id > 4294967295) throw validationError('id', '用户 ID 超出范围');
  return id;
}

export function parseAdminUserQuery(query = {}) {
  validateObject(query, ['keyword', 'status', 'page', 'page_size'], 'query');
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
  if ([...keyword].length > 50) throw validationError('keyword', '关键词最多 50 个字符');
  const status = query.status ?? '';
  if (typeof status !== 'string' || (status && !['active', 'frozen'].includes(status))) throw validationError('status', '用户状态无效');
  const page = positiveInteger(query.page, 'page', 1);
  const pageSize = positiveInteger(query.page_size, 'page_size', 10);
  if (![10, 20, 50].includes(pageSize)) throw validationError('page_size', '每页条数只能是 10、20 或 50');
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw validationError('page', '页码超出范围');
  return { keyword, status, page, pageSize };
}

export function parseAdminUserStatus(body) {
  validateObject(body, ['status']);
  if (typeof body.status !== 'string' || !['active', 'frozen'].includes(body.status)) throw validationError('status', '只能将用户状态设置为 active 或 frozen');
  return { status: body.status };
}
