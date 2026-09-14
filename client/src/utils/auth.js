export const AUTH_TOKEN_KEY = 'game-store.auth.token';

export function safeReturnPath(value, fallback = '/account') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/u.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://game-store.invalid');
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://game-store.invalid' || pathname.startsWith('//') || /[\\\u0000-\u0020]/u.test(pathname) || /^\/(login|register|403)(\/|$)/i.test(pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export const loginLocation = (path) => ({ path: '/login', query: { returnTo: safeReturnPath(path) } });

export function passwordIssue(password) {
  if (typeof password !== 'string' || Array.from(password).length < 8) return '密码至少需要 8 个字符';
  if (new TextEncoder().encode(password).length > 72) return '密码的 UTF-8 编码不能超过 72 字节，请减少字符';
  return '';
}

export function validateRegistration(values) {
  const errors = {};
  const username = String(values.username || '').trim();
  const email = String(values.email || '').trim();
  if (Array.from(username).length < 2 || Array.from(username).length > 20 || /[@\s]/u.test(username)) errors.username = '用户名需为 2–20 个字符，不能包含空白或 @';
  if (Array.from(email).length > 50 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) errors.email = '请输入有效邮箱，最多 50 个字符';
  const issue = passwordIssue(values.password);
  if (issue) errors.password = issue;
  if (values.confirmPassword !== values.password) errors.confirmPassword = '两次输入的密码不一致';
  return errors;
}

export function validateLogin(values) {
  const errors = {};
  if (!String(values.account || '').trim()) errors.account = '请输入用户名或邮箱';
  const issue = passwordIssue(values.password);
  if (issue) errors.password = issue;
  return errors;
}

export function fieldErrorsFrom(error) {
  return Object.fromEntries((error.response?.data?.data?.errors || []).map(({ field, message }) => [field, message]));
}

export function requestMessage(error, fallback = '操作暂时未成功，请稍后重试') {
  if (error.code === 'AUTH_STATE_CHANGED') return '登录状态已在其他页面改变，请重新确认';
  if (!error.response) return error.code === 'STORAGE_UNAVAILABLE' ? '浏览器无法保存登录状态，请允许本站使用本地存储后重试' : '无法连接商城，请检查网络后重试';
  if (error.response.status >= 500) return '商城暂时无法处理请求，请稍后重试';
  return error.response.data?.message || fallback;
}

export function createTokenStorage(storage) {
  if (arguments.length === 0) { try { storage = globalThis.localStorage; } catch { storage = undefined; } }
  return {
    read() { try { return storage?.getItem(AUTH_TOKEN_KEY) || null; } catch { return null; } },
    write(token) {
      try {
        if (!storage) throw new Error('Storage unavailable');
        if (token) storage.setItem(AUTH_TOKEN_KEY, token);
        else storage.removeItem(AUTH_TOKEN_KEY);
      } catch {
        const error = new Error('Unable to update session storage');
        error.code = 'STORAGE_UNAVAILABLE';
        throw error;
      }
    },
  };
}
