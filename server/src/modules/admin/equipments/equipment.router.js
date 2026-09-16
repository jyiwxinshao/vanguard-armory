import { Router } from 'express';
import { success } from '../../../utils/errors.js';
import { createAdminEquipmentService } from './equipment.service.js';

// Mounted only behind /api/admin's shared authentication and role middleware.
export function createAdminEquipmentRouter({ service = createAdminEquipmentService() } = {}) {
  const router = Router();
  router.get('/', async (req, res) => success(res, await service.list(req.query)));
  router.get('/:id', async (req, res) => success(res, await service.get(req.params.id)));
  router.post('/', async (req, res) => success(res, await service.create(req.user.id, req.body), 201));
  router.put('/:id', async (req, res) => success(res, await service.update(req.user.id, req.params.id, req.body)));
  router.patch('/:id/stock', async (req, res) => success(res, await service.adjustStock(req.user.id, req.params.id, req.body)));
  router.delete('/:id', async (req, res) => success(res, await service.remove(req.user.id, req.params.id)));
  return router;
}
