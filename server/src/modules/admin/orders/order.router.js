import { Router } from 'express';
import { success } from '../../../utils/errors.js';
import { createAdminOrderService } from './order.service.js';

export function createAdminOrderRouter({ service = createAdminOrderService() } = {}) {
  const router = Router();
  router.get('/', async (req, res) => success(res, await service.list(req.query)));
  router.get('/:id', async (req, res) => success(res, await service.get(req.params.id)));
  router.put('/:id/status', async (req, res) => success(res, await service.changeStatus(req.user.id, req.params.id, req.body)));
  return router;
}
