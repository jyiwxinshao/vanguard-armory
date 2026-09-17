import { Router } from 'express';
import { success } from '../../../utils/errors.js';
import { createAdminUserService } from './user.service.js';

export function createAdminUserRouter({ service = createAdminUserService() } = {}) {
  const router = Router();
  router.get('/', async (req, res) => success(res, await service.list(req.query)));
  router.get('/:id', async (req, res) => success(res, await service.get(req.params.id)));
  router.get('/:id/characters', async (req, res) => success(res, await service.listCharacters(req.params.id)));
  router.put('/:id/characters/:server', async (req, res) => success(res, await service.saveCharacter(req.user.id, req.params.id, req.params.server, req.body)));
  router.put('/:id/status', async (req, res) => success(res, await service.changeStatus(req.user.id, req.params.id, req.body)));
  return router;
}
