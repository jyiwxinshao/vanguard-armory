import { adminOrderRoute } from './orders-query.js';
import { adminUserRoute } from './users-query.js';

function safeAdminReturn(value, fallback, routeBuilder) {
  if (typeof value !== 'string' || value.split(/[?#]/u, 1)[0] !== fallback) return fallback;
  try {
    if (/[\\\u0000-\u001f\u007f]/u.test(decodeURIComponent(value))) return fallback;
    const url = new URL(value, 'https://game-store.invalid');
    const query = {};
    for (const key of url.searchParams.keys()) query[key] = url.searchParams.getAll(key);
    const search = new URLSearchParams(routeBuilder(query)).toString();
    return search ? `${fallback}?${search}` : fallback;
  } catch { return fallback; }
}

export const safeAdminUserReturn = (value) => safeAdminReturn(value, '/admin/users', adminUserRoute);
export const safeAdminOrderReturn = (value) => safeAdminReturn(value, '/admin/orders', adminOrderRoute);
