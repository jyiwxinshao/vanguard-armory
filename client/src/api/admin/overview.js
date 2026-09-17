import { http } from '../http.js';
export const getAdminOverview = (config) => http.get('/admin/overview', config);
