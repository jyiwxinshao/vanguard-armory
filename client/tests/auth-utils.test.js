import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_TOKEN_KEY, createTokenStorage, passwordIssue, safeReturnPath, validateRegistration } from '../src/utils/auth.js';

test('login returns only to local, non-auth pages and preserves catalog filters', () => {
  assert.equal(safeReturnPath('/?category=weapon&page=2#catalog'), '/?category=weapon&page=2#catalog');
  assert.equal(safeReturnPath('/account'), '/account');
  for (const destination of [
    undefined, ['//outside.test'], 'https://outside.test', '//outside.test', '/\\outside.test',
    '/%2foutside.test', '/%5coutside.test', '/%0aoutside.test', '/login', '/register?returnTo=/login',
    '/403', '/LOGIN', '/%6cogin', '/a/../login', '/%zz', '/ path',
  ]) assert.equal(safeReturnPath(destination), '/account');
});

test('registration counts characters and enforces bcrypt byte limits', () => {
  assert.equal(passwordIssue('密'.repeat(24)), '');
  assert.ok(passwordIssue('密'.repeat(25)));
  assert.equal(passwordIssue('😀'.repeat(18)), '');
  assert.ok(passwordIssue('😀'.repeat(19)));
  assert.ok(passwordIssue('😀'.repeat(7)));
  const valid = { username: ' 玩家甲 ', email: ' Player@Example.test ', password: 'password123', confirmPassword: 'password123' };
  assert.deepEqual(validateRegistration(valid), {});
  assert.ok(validateRegistration({ ...valid, username: '玩家 甲' }).username);
  assert.ok(validateRegistration({ ...valid, email: 'player@test' }).email);
  assert.ok(validateRegistration({ ...valid, confirmPassword: 'different' }).confirmPassword);
});

test('blocked local storage does not crash initialization and reports failed writes', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  const blocked = createTokenStorage();
  assert.equal(blocked.read(), null);
  assert.throws(() => blocked.write('token'), { code: 'STORAGE_UNAVAILABLE' });
  const data = new Map();
  const available = createTokenStorage({
    getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key),
  });
  available.write('token');
  assert.equal(data.get(AUTH_TOKEN_KEY), 'token');
  assert.equal(available.read(), 'token');
  available.write(null);
  assert.equal(available.read(), null);
});
