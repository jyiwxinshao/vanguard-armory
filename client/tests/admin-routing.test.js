import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryHistory, createRouter } from 'vue-router';
import { canAccessAdmin, installAuthGuards, sessionRedirect } from '../src/router/guards.js';

const adminPage = { fullPath: '/admin/orders/7', meta: { requiresAuth: true, requiredRole: 'admin' }, query: {} };
const verified = (role) => ({ token: 'token', status: 'authenticated', isAuthenticated: true, user: { id: 1, role }, revision: 1 });

test('admin pages require verified admin identity and react to logout/account switches', () => {
  const auth = verified('admin');
  assert.equal(sessionRedirect(adminPage, auth), true);
  assert.equal(canAccessAdmin(auth), true);
  Object.assign(auth, { isAuthenticated: false, status: 'checking' });
  assert.equal(canAccessAdmin(auth), false);
  Object.assign(auth, verified('user'));
  assert.equal(sessionRedirect(adminPage, auth), '/403');
  assert.equal(canAccessAdmin(auth), false);
  Object.assign(auth, { token: null, isAuthenticated: false, user: null, status: 'anonymous' });
  assert.deepEqual(sessionRedirect(adminPage, auth), { path: '/login', query: { returnTo: '/admin/orders/7' } });
});

test('network failure preserves the admin destination for recovery without authorizing its content', () => {
  const auth = { ...verified('admin'), status: 'unavailable', isAuthenticated: false, user: null };
  assert.equal(sessionRedirect(adminPage, auth), true);
  assert.equal(canAccessAdmin(auth), false);
  Object.assign(auth, verified('admin'));
  assert.equal(canAccessAdmin(auth), true);
});

test('login defaults depend on role while safe deep links and storefront destinations survive', () => {
  const login = { fullPath: '/login', meta: { guestOnly: true }, query: {} };
  assert.equal(sessionRedirect(login, verified('admin')), '/admin/equipments');
  assert.equal(sessionRedirect(login, verified('user')), '/account');
  assert.equal(sessionRedirect({ ...login, query: { returnTo: '/admin/orders/7' } }, verified('admin')), '/admin/orders/7');
  assert.equal(sessionRedirect({ ...login, query: { returnTo: '//outside.test' } }, verified('admin')), '/admin/equipments');
  assert.equal(sessionRedirect({ ...login, query: { returnTo: '/cart' } }, verified('user')), '/cart');
  assert.equal(sessionRedirect({ fullPath: '/', meta: {}, query: {} }, verified('user')), true);
});

test('nested admin routes inherit authorization and await session restoration before entering', async () => {
  const component = { render: () => null };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component }, { path: '/403', component }, { path: '/login', component },
    { path: '/admin', component, meta: { requiresAuth: true, requiredRole: 'admin' }, children: [{ path: 'users/:id', component }] },
  ] });
  const auth = { token: 'token', user: null, isAuthenticated: false, ensureSession: async () => Object.assign(auth, verified('user')) };
  installAuthGuards(router, auth);
  await router.push('/admin/users/1');
  assert.equal(router.currentRoute.value.path, '/403');
  auth.ensureSession = async () => Object.assign(auth, verified('admin'));
  await router.push('/admin/users/1');
  assert.equal(router.currentRoute.value.meta.requiredRole, 'admin');
  assert.equal(router.currentRoute.value.path, '/admin/users/1');
});

test('protected cart redirects anonymous visits and logout, and resumes after login', () => {
  const cart = { fullPath: '/cart', meta: { requiresAuth: true }, query: {} };
  const auth = { token: null, isAuthenticated: false, status: 'anonymous' };
  const login = sessionRedirect(cart, auth);
  assert.deepEqual(login, { path: '/login', query: { returnTo: '/cart' } });
  Object.assign(auth, verified('user'));
  assert.equal(sessionRedirect({ ...login, meta: { guestOnly: true } }, auth), '/cart');
  assert.equal(sessionRedirect(cart, auth), true);
  Object.assign(auth, { token: null, isAuthenticated: false, status: 'anonymous' });
  assert.deepEqual(sessionRedirect(cart, auth), login);
});
