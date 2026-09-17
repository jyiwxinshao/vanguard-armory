import { http } from '../http.js';

// All equipment maintenance routes are live, including guarded soft delete.
export const getAdminEquipments = (params, config = {}) => http.get('/admin/equipments', { ...config, params });
export const getAdminEquipment = (id, config) => http.get(`/admin/equipments/${encodeURIComponent(id)}`, config);
export const createAdminEquipment = (body, config) => http.post('/admin/equipments', body, config);
export const updateAdminEquipment = (id, body, config) => http.put(`/admin/equipments/${encodeURIComponent(id)}`, body, config);
export const adjustAdminStock = (id, body, config) => http.patch(`/admin/equipments/${encodeURIComponent(id)}/stock`, body, config);
export const removeAdminEquipment = (id, config) => http.delete(`/admin/equipments/${encodeURIComponent(id)}`, config);
