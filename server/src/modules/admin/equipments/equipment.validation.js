import { parseEquipmentQuery } from '../../equipments/equipment.validation.js';
import { validationError } from '../../../utils/errors.js';

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
