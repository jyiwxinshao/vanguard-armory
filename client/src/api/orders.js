import { http } from './http.js';

export const createOrder = (body, config) => http.post('/orders', body, config);
export const getOrders = (params, config = {}) => http.get('/orders', { ...config, params });
export const getOrder = (id, config) => http.get(`/orders/${encodeURIComponent(id)}`, config);
export const getOrderByRequest = (id, config) => http.get(`/orders/by-request/${encodeURIComponent(id)}`, config);
export const payOrder = (id, config) => http.put(`/orders/${encodeURIComponent(id)}/pay`, {}, config);
export const cancelOrder = (id, config) => http.put(`/orders/${encodeURIComponent(id)}/cancel`, {}, config);

export const getCheckoutCharacter = (server, config = {}) => http.get('/orders/character', { ...config, params: { server } });
