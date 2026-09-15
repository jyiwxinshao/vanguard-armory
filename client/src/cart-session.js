import { watch } from 'vue';
import { GUEST_CART_KEY } from './utils/guest-cart-storage.js';

// The only session-driven initialization entry. Views may refresh through the
// store's shared promise; they never initiate a second merge independently.
export function installCartSession(auth, cart, target = globalThis.window) {
  const stop = watch(() => [auth.status, auth.user?.id, auth.user?.role, auth.revision, auth.token], () => {
    const token = auth.token;
    const revision = auth.revision;
    const userId = auth.user?.id;
    const kind = auth.isAuthenticated ? (auth.user.role === 'user' ? 'server' : 'admin') : auth.status === 'anonymous' ? 'guest' : 'pending';
    void cart.setSession({ kind, userId, token, revision, current: () => auth.isCurrentSession(token, revision) }).catch(() => {});
  }, { immediate: true, flush: 'sync' });
  let timer;
  let refreshPending = false;
  const refresh = () => {
    if (!['guest', 'server'].includes(cart.mode)) return;
    if (cart.loading) { refreshPending = true; return; }
    refreshPending = false;
    void cart.fetchCart().catch(() => {});
  };
  const stopLoading = watch(() => cart.loading, (loading) => {
    if (!loading && refreshPending) { clearTimeout(timer); timer = setTimeout(refresh, 50); }
  });
  const listener = (event) => {
    if (event.key === GUEST_CART_KEY || event.key === null) {
      clearTimeout(timer);
      timer = setTimeout(refresh, 50);
    }
  };
  target?.addEventListener('storage', listener);
  target?.addEventListener('focus', refresh);
  return () => { stop(); stopLoading(); clearTimeout(timer); target?.removeEventListener('storage', listener); target?.removeEventListener('focus', refresh); };
}
