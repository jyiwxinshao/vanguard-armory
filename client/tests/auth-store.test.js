import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, disposePinia } from 'pinia';
import { useAuthStore } from '../src/stores/auth.js';
import { configureAuthTransport, http } from '../src/api/http.js';
import { AUTH_TOKEN_KEY } from '../src/utils/auth.js';

const player = { id: 10, username: '测试玩家', email: 'player@example.test', role: 'user', status: 'active' };
const secondPlayer = { ...player, id: 11, username: '另一玩家' };
const credentials = { account: '测试玩家', password: 'password123' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, initialToken = null) {
  const data = new Map(initialToken ? [[AUTH_TOKEN_KEY, initialToken]] : []);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const pinia = createPinia();
  const auth = useAuthStore(pinia);
  const calls = [];
  const originalAdapter = http.defaults.adapter;
  let unauthorized = 0;
  let forbidden = 0;
  http.defaults.adapter = (config) => new Promise((resolve, reject) => {
    calls.push({
      config,
      succeed: (result) => resolve({ status: 200, statusText: 'OK', headers: {}, config, data: { code: 0, data: result } }),
      fail: (status, code = 10002) => {
        const error = new Error(status ? 'Request failed' : 'Network unavailable');
        error.config = config;
        if (status) error.response = { status, data: { code, message: '测试错误' } };
        reject(error);
      },
    });
  });
  configureAuthTransport({
    getToken: () => auth.token,
    getRevision: () => auth.revision,
    isCurrentSession: (token, revision) => auth.isCurrentSession(token, revision),
    onUnauthorized: (message) => { unauthorized++; auth.clearSession(message); },
    onForbidden: () => { forbidden++; },
  });
  t.after(() => {
    configureAuthTransport({});
    http.defaults.adapter = originalAdapter;
    disposePinia(pinia);
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return { auth, storage, calls, get unauthorized() { return unauthorized; }, get forbidden() { return forbidden; } };
}

test('refresh validates the stored token once and never trusts cached profile data', async (t) => {
  const { auth, calls } = harness(t, 'stored-token');
  assert.equal(auth.user, null);
  assert.equal(auth.isAuthenticated, false);
  const first = auth.ensureSession();
  const second = auth.ensureSession();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.url, '/auth/me');
  assert.equal(calls[0].config.headers.Authorization, 'Bearer stored-token');
  assert.equal(auth.status, 'checking');
  calls[0].succeed(player);
  await Promise.all([first, second]);
  assert.equal(auth.isAuthenticated, true);
  assert.deepEqual(auth.user, player);
  await auth.ensureSession();
  assert.equal(calls.length, 1);
});

test('temporary network failure keeps the token and retry restores the account', async (t) => {
  const { auth, storage, calls } = harness(t, 'stored-token');
  const restore = auth.ensureSession();
  await flush();
  calls[0].fail();
  await restore;
  assert.equal(auth.status, 'unavailable');
  assert.equal(auth.user, null);
  assert.equal(storage.getItem(AUTH_TOKEN_KEY), 'stored-token');
  await auth.ensureSession();
  assert.equal(calls.length, 1);
  const retry = auth.ensureSession({ retry: true });
  await flush();
  calls[1].succeed(player);
  await retry;
  assert.equal(auth.isAuthenticated, true);
});

for (const [label, status, code, notice] of [
  ['expired', 401, 10002, /过期/], ['frozen', 403, 10006, /冻结/],
]) test(`${label} stored credentials clear the session and show a useful notice`, async (t) => {
  const { auth, storage, calls } = harness(t, 'stored-token');
  const restore = auth.ensureSession();
  await flush();
  calls[0].fail(status, code);
  await restore;
  assert.equal(auth.status, 'anonymous');
  assert.equal(auth.user, null);
  assert.equal(storage.getItem(AUTH_TOKEN_KEY), null);
  assert.match(auth.notice, notice);
});

test('logout clears locally immediately, survives network failure and ignores a late profile', async (t) => {
  const { auth, storage, calls } = harness(t, 'stored-token');
  const restore = auth.ensureSession();
  await flush();
  const logout = auth.logout();
  assert.equal(auth.token, null);
  assert.equal(storage.getItem(AUTH_TOKEN_KEY), null);
  await flush();
  assert.equal(calls[1].config.url, '/auth/logout');
  assert.equal(calls[1].config.headers.Authorization, 'Bearer stored-token');
  calls[1].fail();
  calls[0].succeed(player);
  await Promise.all([restore, logout]);
  assert.equal(auth.status, 'anonymous');
  assert.equal(auth.user, null);
});

test('a late old-session failure cannot erase a newer login', async (t) => {
  const h = harness(t, 'stored-token');
  const restore = h.auth.ensureSession();
  await flush();
  h.auth.clearSession();
  const login = h.auth.login(credentials);
  await flush();
  h.calls[1].succeed({ token: 'new-token', user: secondPlayer });
  await login;
  h.calls[0].fail(401);
  await restore;
  assert.equal(h.auth.token, 'new-token');
  assert.equal(h.auth.user.id, secondPlayer.id);
  assert.equal(h.auth.isAuthenticated, true);
});

test('login cannot overwrite a session changed in another tab before its storage event', async (t) => {
  const { auth, calls, storage } = harness(t);
  const login = auth.login(credentials);
  const rejected = assert.rejects(login, { code: 'AUTH_STATE_CHANGED' });
  await flush();
  storage.setItem(AUTH_TOKEN_KEY, 'other-tab-token');
  calls[0].succeed({ token: 'stale-login-token', user: player });
  await flush();
  assert.equal(calls[1].config.headers.Authorization, 'Bearer other-tab-token');
  calls[1].succeed(secondPlayer);
  await rejected;
  assert.equal(auth.token, 'other-tab-token');
  assert.equal(auth.user.id, secondPlayer.id);
});

for (const firstResponse of ['older', 'newer']) test(`only the latest login attempt can succeed when the ${firstResponse} response arrives first`, async (t) => {
  const { auth, calls } = harness(t);
  const older = auth.login(credentials);
  const rejected = assert.rejects(older, { code: 'AUTH_STATE_CHANGED' });
  await flush();
  const newer = auth.login({ ...credentials, account: secondPlayer.username });
  await flush();
  if (firstResponse === 'older') {
    calls[0].succeed({ token: 'older-token', user: player });
    await rejected;
    assert.equal(auth.isAuthenticated, false);
    calls[1].succeed({ token: 'newer-token', user: secondPlayer });
    await newer;
  } else {
    calls[1].succeed({ token: 'newer-token', user: secondPlayer });
    await newer;
    calls[0].succeed({ token: 'older-token', user: player });
    await rejected;
  }
  assert.equal(auth.token, 'newer-token');
  assert.equal(auth.user.id, secondPlayer.id);
});

test('storage events restore a changed account and clear it when another tab logs out', async (t) => {
  const { auth, calls, storage } = harness(t);
  let listener;
  const target = { addEventListener: (_, callback) => { listener = callback; }, removeEventListener: () => { listener = null; } };
  const stop = auth.startStorageSync(target);
  t.after(stop);
  storage.setItem(AUTH_TOKEN_KEY, 'other-tab-token');
  listener({ key: AUTH_TOKEN_KEY });
  await flush();
  calls[0].succeed(secondPlayer);
  await flush();
  assert.equal(auth.user.id, secondPlayer.id);
  storage.removeItem(AUTH_TOKEN_KEY);
  listener({ key: AUTH_TOKEN_KEY });
  assert.equal(auth.user, null);
  assert.equal(auth.status, 'anonymous');
  assert.match(auth.notice, /其他页面/);
});

test('storage events invalidate pending work even when the final stored token is unchanged', async (t) => {
  const { auth, calls } = harness(t, 'same-token');
  let listener;
  const stop = auth.startStorageSync({ addEventListener: (_, callback) => { listener = callback; }, removeEventListener() {} });
  t.after(stop);
  const original = auth.ensureSession();
  await flush();
  listener({ key: AUTH_TOKEN_KEY });
  await flush();
  assert.equal(calls.length, 2);
  calls[1].succeed(secondPlayer);
  await flush();
  calls[0].fail(401);
  await original;
  assert.equal(auth.user.id, secondPlayer.id);
  assert.equal(auth.isAuthenticated, true);
});

test('failed browser storage writes never report a successful persistent login', async (t) => {
  const { auth, calls, storage } = harness(t);
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  const login = auth.login(credentials);
  const rejected = assert.rejects(login, { code: 'STORAGE_UNAVAILABLE' });
  await flush();
  calls[0].succeed({ token: 'new-token', user: player });
  await rejected;
  assert.equal(auth.status, 'anonymous');
  assert.equal(auth.token, null);
  assert.equal(auth.user, null);
});

test('failed storage removal still signs out this page and does not restore the ignored token', async (t) => {
  const { auth, storage, calls } = harness(t, 'old-token');
  storage.removeItem = () => { throw new Error('Storage blocked'); };
  auth.clearSession();
  await auth.ensureSession();
  assert.equal(auth.status, 'anonymous');
  assert.equal(calls.length, 0);
  assert.match(auth.notice, /未能清除/);
  storage.setItem(AUTH_TOKEN_KEY, 'new-token');
  const sync = auth.syncFromStorage();
  await flush();
  calls[0].succeed(secondPlayer);
  await sync;
  assert.equal(auth.isAuthenticated, true);
});

test('unauthorized responses from an old tab session do not clear the latest stored credentials', async (t) => {
  const h = harness(t, 'old-token');
  const request = http.get('/protected');
  const rejected = assert.rejects(request);
  await flush();
  h.storage.setItem(AUTH_TOKEN_KEY, 'new-token');
  h.calls[0].fail(401);
  await rejected;
  assert.equal(h.unauthorized, 0);
  assert.equal(h.storage.getItem(AUTH_TOKEN_KEY), 'new-token');
});

test('transport distinguishes expired login, frozen account and permission denial', async (t) => {
  const h = harness(t, 'stored-token');
  const forbidden = http.get('/admin/me');
  const permissionRejected = assert.rejects(forbidden);
  await flush();
  h.calls[0].fail(403, 10003);
  await permissionRejected;
  assert.equal(h.forbidden, 1);
  assert.equal(h.auth.token, 'stored-token');
  const frozen = http.get('/protected');
  const frozenRejected = assert.rejects(frozen);
  await flush();
  h.calls[1].fail(403, 10006);
  await frozenRejected;
  assert.equal(h.unauthorized, 1);
  assert.equal(h.auth.token, null);
  assert.match(h.auth.notice, /冻结/);
  const anonymous = http.get('/protected');
  const anonymousRejected = assert.rejects(anonymous);
  await flush();
  h.calls[2].fail(401);
  await anonymousRejected;
  assert.equal(h.unauthorized, 2);
});
