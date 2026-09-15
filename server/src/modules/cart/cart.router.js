import { Router } from 'express';
import { createRequireAuth, requireRole } from '../../middleware/auth.js';
import { success } from '../../utils/errors.js';
import { createCartService } from './cart.service.js';

export function createCartRouter({ authService, cartService = createCartService() } = {}) {
  const router = Router();
  const requireAuthentication = createRequireAuth(authService);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireAuthentication, requireRole('user'));

  router.get('/', async (req, res) => success(res, await cartService.getCart(req.user.id)));
  router.post('/merge', async (req, res) => success(res, await cartService.mergeCart(req.user.id, req.body)));
  router.post('/items/batch-delete', async (req, res) => success(res, await cartService.deleteItems(req.user.id, req.body)));
  router.post('/items', async (req, res) => success(res, await cartService.addItem(req.user.id, req.body), 201));
  router.put('/items/:id', async (req, res) => success(res, await cartService.updateItem(req.user.id, req.params.id, req.body)));
  router.delete('/items/:id', async (req, res) => success(res, await cartService.deleteItem(req.user.id, req.params.id)));
  router.delete('/', async (req, res) => success(res, await cartService.clearCart(req.user.id)));
  return router;
}
