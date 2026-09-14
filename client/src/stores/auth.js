import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { getCurrentUser, loginAccount, logoutAccount } from '../api/auth.js';
import { AUTH_TOKEN_KEY, createTokenStorage, requestMessage } from '../utils/auth.js';

export const useAuthStore = defineStore('auth', () => {
  const storage = createTokenStorage();
  let ignoredStoredToken = null;
  const readStoredToken = () => {
    const storedToken = storage.read();
    return storedToken === ignoredStoredToken ? null : storedToken;
  };
  const token = ref(readStoredToken());
  const user = ref(null);
  const status = ref(token.value ? 'uninitialized' : 'anonymous');
  const initializationError = ref('');
  const notice = ref('');
  const revision = ref(0);
  const isAuthenticated = computed(() => status.value === 'authenticated' && Boolean(user.value && token.value));
  let pending = null;
  let stopStorageSync;
  let loginAttempt = 0;

  function clearSession(message = '') {
    revision.value += 1;
    token.value = null;
    user.value = null;
    status.value = 'anonymous';
    initializationError.value = '';
    notice.value = message;
    pending = null;
    try { storage.write(null); ignoredStoredToken = null; } catch {
      ignoredStoredToken = storage.read();
      notice.value = '已退出当前页面，但浏览器未能清除登录存储，请清理本站数据';
    }
  }

  function isCurrent(expectedToken, expectedRevision) {
    return token.value === expectedToken && revision.value === expectedRevision && readStoredToken() === expectedToken;
  }

  async function syncFromStorage({ force = false } = {}) {
    const storedToken = readStoredToken();
    if (storedToken === token.value && !force) return;
    revision.value += 1;
    token.value = storedToken;
    user.value = null;
    pending = null;
    initializationError.value = '';
    status.value = storedToken ? 'uninitialized' : 'anonymous';
    notice.value = storedToken ? '' : '已在其他页面退出登录';
    if (storedToken) await ensureSession();
  }

  async function ensureSession({ retry = false } = {}) {
    if (readStoredToken() !== token.value) return syncFromStorage();
    if (!token.value || isAuthenticated.value || (status.value === 'unavailable' && !retry)) return;
    if (pending) return pending.promise;
    const expectedToken = token.value;
    const expectedRevision = revision.value;
    const request = { promise: null };
    status.value = 'checking';
    initializationError.value = '';
    request.promise = (async () => {
      try {
        const result = await getCurrentUser();
        if (!isCurrent(expectedToken, expectedRevision)) { await syncFromStorage(); return; }
        user.value = result;
        status.value = 'authenticated';
      } catch (error) {
        if (!isCurrent(expectedToken, expectedRevision)) { await syncFromStorage(); return; }
        const code = error.response?.data?.code;
        if (error.response?.status === 401) clearSession('登录已过期，请重新登录');
        else if (error.response?.status === 403 && code === 10006) clearSession('账号已被冻结，请联系管理员');
        else {
          user.value = null;
          status.value = 'unavailable';
          initializationError.value = requestMessage(error, '暂时无法验证登录状态，请重试');
        }
      } finally { if (pending === request) pending = null; }
    })();
    pending = request;
    return request.promise;
  }

  async function login(credentials) {
    const attempt = ++loginAttempt;
    const expectedToken = token.value;
    const expectedRevision = revision.value;
    const result = await loginAccount(credentials);
    if (attempt !== loginAttempt || !isCurrent(expectedToken, expectedRevision)) {
      await syncFromStorage();
      const error = new Error('Session changed');
      error.code = 'AUTH_STATE_CHANGED';
      throw error;
    }
    storage.write(result.token);
    ignoredStoredToken = null;
    revision.value += 1;
    token.value = result.token;
    user.value = result.user;
    status.value = 'authenticated';
    initializationError.value = '';
    notice.value = '';
    pending = null;
  }

  async function logout() {
    const previousToken = token.value;
    clearSession('已退出登录');
    if (previousToken) { try { await logoutAccount(previousToken); } catch { /* Local logout remains effective when the server is unavailable. */ } }
  }

  function startStorageSync(target = globalThis.window) {
    if (stopStorageSync || !target) return;
    const listener = (event) => { if (event.key === AUTH_TOKEN_KEY || event.key === null) void syncFromStorage({ force: true }); };
    target.addEventListener('storage', listener);
    stopStorageSync = () => { target.removeEventListener('storage', listener); stopStorageSync = undefined; };
    return stopStorageSync;
  }

  return { token, user, status, initializationError, notice, revision, isAuthenticated, isCurrentSession: isCurrent, ensureSession, syncFromStorage, login, logout, clearSession, startStorageSync };
});
