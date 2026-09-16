import { http } from '../http.js';

export const getAdminOrders = (params, config = {}) => http.get('/admin/orders', { ...config, params });
export const getAdminOrder = (id, config) => http.get(`/admin/orders/${encodeURIComponent(id)}`, config);
export const updateAdminOrderStatus = (id, body, config) => http.put(`/admin/orders/${encodeURIComponent(id)}/status`, body, config);
