import axios from 'axios';

export const http = axios.create({ baseURL: '/api', timeout: 7000 });
let authHandlers = {};
export function configureAuthTransport(handlers) { authHandlers = handlers; }

http.interceptors.request.use((config) => {
  const token = authHandlers.getToken?.();
  config.authToken = token;
  config.authRevision = authHandlers.getRevision?.();
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use((response) => response.data.data, (error) => {
  const config = error.config || {};
  const current = config.authToken === authHandlers.getToken?.() && config.authRevision === authHandlers.getRevision?.() && (authHandlers.isCurrentSession?.(config.authToken, config.authRevision) ?? true);
  if (!config.skipAuthHandling && current) {
    if (error.response?.status === 401) authHandlers.onUnauthorized?.('登录已过期，请重新登录');
    else if (error.response?.status === 403 && error.response.data?.code === 10006) authHandlers.onUnauthorized?.('账号已被冻结，请联系管理员');
    else if (error.response?.status === 403) authHandlers.onForbidden?.();
  }
  return Promise.reject(error);
});
