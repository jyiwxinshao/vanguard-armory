import { http } from './http.js';

export const getCart = (config) => http.get('/cart', config);
export const addCartItem = (equipmentId, quantity, config) => http.post('/cart/items', { equipment_id: equipmentId, quantity }, config);
export const updateCartItem = (itemId, quantity, config) => http.put(`/cart/items/${encodeURIComponent(itemId)}`, { quantity }, config);
export const deleteCartItem = (itemId, config) => http.delete(`/cart/items/${encodeURIComponent(itemId)}`, config);
export const deleteCartItems = (ids, config) => http.post('/cart/items/batch-delete', { ids }, config);
export const clearCart = (config) => http.delete('/cart', config);
export const mergeCart = (batch, config) => http.post('/cart/merge', { merge_id: batch.batch_id, items: batch.items }, config);
