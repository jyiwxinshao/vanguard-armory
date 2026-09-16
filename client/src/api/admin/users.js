import { http } from '../http.js';

export const getAdminUsers = (params, config = {}) => http.get('/admin/users', { ...config, params });
export const getAdminUser = (id, config) => http.get(`/admin/users/${encodeURIComponent(id)}`, config);
export const updateAdminUserStatus = (id, body, config) => http.put(`/admin/users/${encodeURIComponent(id)}/status`, body, config);
