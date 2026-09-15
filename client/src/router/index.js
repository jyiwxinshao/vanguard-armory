import { createRouter, createWebHistory } from 'vue-router';
import EquipmentList from '../views/EquipmentList.vue';
import NotFound from '../views/NotFound.vue';
import { loginLocation, safeReturnPath } from '../utils/auth.js';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: EquipmentList },
    { path: '/equipments/:id', component: () => import('../views/EquipmentDetail.vue') },
    { path: '/cart', component: () => import('../views/Cart.vue') },
    { path: '/login', component: () => import('../views/Login.vue'), meta: { guestOnly: true } },
    { path: '/register', component: () => import('../views/Register.vue'), meta: { guestOnly: true } },
    { path: '/account', component: () => import('../views/Account.vue'), meta: { requiresAuth: true } },
    { path: '/403', component: () => import('../views/Forbidden.vue') },
    { path: '/:pathMatch(.*)*', component: NotFound },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

export function installAuthGuards(router, auth) {
  router.beforeEach(async (to) => {
    await auth.ensureSession();
    if (to.meta.requiresAuth && !auth.token) return loginLocation(to.fullPath);
    if (to.meta.guestOnly && auth.isAuthenticated) return safeReturnPath(to.query.returnTo);
    return true;
  });
}
