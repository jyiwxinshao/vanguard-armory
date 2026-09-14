import { http } from './http.js';

const localHandling = { skipAuthHandling: true };
export const registerAccount = (credentials) => http.post('/auth/register', credentials, localHandling);
export const loginAccount = (credentials) => http.post('/auth/login', credentials, localHandling);
export const getCurrentUser = () => http.get('/auth/me', localHandling);
export const logoutAccount = (token) => http.post('/auth/logout', {}, { ...localHandling, headers: { Authorization: `Bearer ${token}` } });
