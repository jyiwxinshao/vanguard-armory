import { adminEquipmentRoute } from './equipment-query.js';
import { requestMessage } from '../auth.js';

export function safeAdminEquipmentReturn(value) {
  const fallback = '/admin/equipments';
  if (typeof value !== 'string' || value.split(/[?#]/u, 1)[0] !== fallback) return fallback;
  try {
    if (/[\\\u0000-\u001f\u007f]/u.test(decodeURIComponent(value))) return fallback;
    const url = new URL(value, 'https://game-store.invalid');
    const query = {};
    for (const key of url.searchParams.keys()) query[key] = url.searchParams.getAll(key);
    const search = new URLSearchParams(adminEquipmentRoute(query)).toString();
    return search ? `${fallback}?${search}` : fallback;
  } catch { return fallback; }
}

export function adminEquipmentIssue(error) {
  const status = error.response?.status;
  if (status === 404) return { message: '装备不存在，请返回列表重新选择。', retry: false };
  if (status === 422) return { message: '装备地址无效，请返回列表重新选择。', retry: false };
  return { message: requestMessage(error, '装备详情加载失败，请重试'), retry: ![401, 403].includes(status) };
}

export function formatEquipmentDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN');
}
