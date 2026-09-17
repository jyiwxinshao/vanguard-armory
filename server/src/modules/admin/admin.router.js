import { Router } from 'express';
import { createImageUploadRouter } from './equipments/image-upload.js';
import { createRequireAuth, requireRole } from '../../middleware/auth.js';
import { success } from '../../utils/errors.js';
import { createAdminEquipmentRouter } from './equipments/equipment.router.js';
import { createAdminUserRouter } from './users/user.router.js';
import { createAdminOverviewService } from './overview/overview.service.js';
import { createAdminOrderRouter } from './orders/order.router.js';

export function createAdminRouter({ authService, services = {}, uploadDirectory } = {}) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(createRequireAuth(authService), requireRole('admin'));
  router.get('/me', (req, res) => success(res, req.user));
  router.use('/equipment-images', createImageUploadRouter({ directory: uploadDirectory }));
  const overview = services.overview || createAdminOverviewService();
  router.get('/overview', async (_req, res) => success(res, await overview.get()));
  router.use('/equipments', createAdminEquipmentRouter({ service: services.equipments }));
  router.use('/users', createAdminUserRouter({ service: services.users }));
  router.use('/orders', createAdminOrderRouter({ service: services.orders }));
  return router;
}
