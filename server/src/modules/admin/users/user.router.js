import { Router } from 'express';
import { success } from '../../../utils/errors.js';
import { createAdminUserService } from './user.service.js';

export function createAdminUserRouter({ service = createAdminUserService() } = {}) {
  const router = Router();
  router.get('/', async (req, res) => success(res, await service.list(req.query)));
  router.get('/:id', async (req, res) => success(res, await service.get(req.params.id)));
  router.put('/:id/status', async (req, res) => success(res, await service.changeStatus(req.user.id, req.params.id, req.body)));
  return router;
}
