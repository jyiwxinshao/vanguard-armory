import { createRouter, createWebHistory } from 'vue-router';
import EquipmentList from '../views/EquipmentList.vue';
import NotFound from '../views/NotFound.vue';
import StorefrontLayout from '../layouts/StorefrontLayout.vue';
import { recordInitialRoute } from '../utils/promotion-session.js';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/', component: StorefrontLayout,
      children: [
        { path: '', component: EquipmentList },
        { path: '/equipments/:id', component: () => import('../views/EquipmentDetail.vue') },
        { path: '/checkout', component: () => import('../views/Checkout.vue'), meta: { requiresAuth: true } },
        { path: '/orders', component: () => import('../views/Orders.vue'), meta: { requiresAuth: true } },
        { path: '/orders/:id', component: () => import('../views/OrderDetail.vue'), meta: { requiresAuth: true } },
        { path: '/cart', component: () => import('../views/Cart.vue') },
        { path: '/login', component: () => import('../views/Login.vue'), meta: { guestOnly: true } },
        { path: '/register', component: () => import('../views/Register.vue'), meta: { guestOnly: true } },
        { path: '/account', component: () => import('../views/Account.vue'), meta: { requiresAuth: true } },
        { path: '/403', component: () => import('../views/Forbidden.vue') },
        { path: '/:pathMatch(.*)*', component: NotFound },
      ],
    },
    {
      path: '/admin', component: () => import('../layouts/AdminLayout.vue'),
      meta: { requiresAuth: true, requiredRole: 'admin' },
      children: [
        { path: '', redirect: '/admin/equipments' },
        { path: 'equipments', component: () => import('../views/admin/EquipmentList.vue'), meta: { title: '装备管理' } },
        { path: 'equipments/new', component: () => import('../views/admin/EquipmentCreate.vue'), meta: { title: '新增装备' } },
        { path: 'equipments/:id', component: () => import('../views/admin/EquipmentDetail.vue'), meta: { title: '装备详情' } },
        { path: 'equipments/:id/edit', component: () => import('../views/admin/EquipmentEdit.vue'), meta: { title: '编辑装备' } },
        { path: 'equipments/:id/stock', component: () => import('../views/admin/EquipmentStock.vue'), meta: { title: '调整库存' } },
        { path: 'users', component: () => import('../views/admin/UserList.vue'), meta: { title: '用户管理' } },
        { path: 'users/:id', component: () => import('../views/admin/UserDetail.vue'), meta: { title: '用户详情' } },
        { path: 'orders', component: () => import('../views/admin/OrderList.vue'), meta: { title: '订单管理' } },
        { path: 'orders/:id', component: () => import('../views/admin/OrderDetail.vue'), meta: { title: '订单详情' } },
        { path: ':pathMatch(.*)*', component: NotFound, meta: { title: '页面不存在' } },
      ],
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((to) => recordInitialRoute(to.path));

export default router;

export { installAuthGuards } from './guards.js';
