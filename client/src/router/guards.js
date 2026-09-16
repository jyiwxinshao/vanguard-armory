import { loginLocation, safeReturnPath } from '../utils/auth.js';

export const canAccessAdmin = (auth) => auth.isAuthenticated && auth.user?.role === 'admin';

// Shared by navigation guards and in-place session changes (logout/account switching).
export function sessionRedirect(to, auth) {
  if (to.meta.requiresAuth && !auth.token) return loginLocation(to.fullPath);
  if (to.meta.requiredRole && auth.isAuthenticated && auth.user?.role !== to.meta.requiredRole) return '/403';
  if (to.meta.guestOnly && auth.isAuthenticated) {
    const fallback = auth.user?.role === 'admin' ? '/admin/equipments' : '/account';
    return safeReturnPath(to.query.returnTo, fallback);
  }
  return true;
}

export function installAuthGuards(router, auth) {
  router.beforeEach(async (to) => {
    await auth.ensureSession();
    // An unavailable session keeps the recovery screen; it never authorizes admin content.
    return sessionRedirect(to, auth);
  });
}
