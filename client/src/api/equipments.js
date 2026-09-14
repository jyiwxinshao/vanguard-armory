import { http } from './http.js';

export const getEquipments = (params, { signal } = {}) => http.get('/equipments', { params, signal });
export const getEquipment = (id, { signal } = {}) => http.get(`/equipments/${encodeURIComponent(id)}`, { signal });
export const getHealth = () => http.get('/health');
