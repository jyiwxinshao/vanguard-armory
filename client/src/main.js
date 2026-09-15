import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router, { installAuthGuards } from './router/index.js';
import { configureAuthTransport } from './api/http.js';
import { useAuthStore } from './stores/auth.js';
import { loginLocation, safeReturnPath } from './utils/auth.js';
import './styles/main.css';
import { useCartStore } from './stores/cart.js';
import { installCartSession } from './cart-session.js';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
const auth = useAuthStore(pinia);
configureAuthTransport({
  getToken: () => auth.token,
  getRevision: () => auth.revision,
  isCurrentSession: (token, revision) => auth.isCurrentSession(token, revision),
  onUnauthorized: (message) => {
    auth.clearSession(message);
    if (!router.currentRoute.value.meta.guestOnly) void router.replace(loginLocation(router.currentRoute.value.fullPath));
  },
  onForbidden: () => { void router.replace('/403'); },
});
installCartSession(auth, useCartStore(pinia));
installAuthGuards(router, auth);
watch(() => auth.status, (status) => {
  const route = router.currentRoute.value;
  if (status === 'anonymous' && route.meta.requiresAuth) void router.replace(loginLocation(route.fullPath));
  if (auth.isAuthenticated && route.meta.guestOnly) void router.replace(safeReturnPath(route.query.returnTo));
});
auth.startStorageSync();
app.use(router).mount('#app');
