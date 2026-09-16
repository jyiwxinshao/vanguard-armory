import { Router } from 'express';
import { createRequireAuth, requireRole } from '../../middleware/auth.js';
import { success } from '../../utils/errors.js';
import { createAdminEquipmentRouter } from './equipments/equipment.router.js';
import { createAdminUserRouter } from './users/user.router.js';
import { createAdminOrderRouter } from './orders/order.router.js';

export function createAdminRouter({ authService, services = {} } = {}) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(createRequireAuth(authService), requireRole('admin'));
  router.get('/me', (req, res) => success(res, req.user));
  router.use('/equipments', createAdminEquipmentRouter({ service: services.equipments }));
  router.use('/users', createAdminUserRouter({ service: services.users }));
  router.use('/orders', createAdminOrderRouter({ service: services.orders }));
  return router;
}
