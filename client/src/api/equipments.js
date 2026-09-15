import { http } from './http.js';

export const getEquipments = (params, { signal } = {}) => http.get('/equipments', { params, signal });
export const getEquipment = (id, config = {}) => http.get(`/equipments/${encodeURIComponent(id)}`, config);
export const getHealth = () => http.get('/health');
