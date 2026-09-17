import { Router } from 'express';
import { createRequireAuth, requireRole } from '../../middleware/auth.js';
import { success } from '../../utils/errors.js';
import { createOrderService } from './orders.service.js';

export function createOrderRouter({ authService, orderService = createOrderService() } = {}) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(createRequireAuth(authService), requireRole('user'));
  router.get('/', async (req, res) => success(res, await orderService.listOrders(req.user.id, req.query)));
  router.post('/', async (req, res) => {
    const result = await orderService.createOrder(req.user.id, req.body);
    return success(res, result, result.replayed ? 200 : 201);
  });
  router.get('/by-request/:requestId', async (req, res) => success(res, await orderService.getByRequest(req.user.id, req.params.requestId)));
  router.get('/character', async (req, res) => success(res, await orderService.getCharacter(req.user.id, req.query)));
  router.get('/:id', async (req, res) => success(res, await orderService.getOrder(req.user.id, req.params.id)));
  router.put('/:id/pay', async (req, res) => success(res, await orderService.changeStatus(req.user.id, req.params.id, 'pay', req.body)));
  router.put('/:id/cancel', async (req, res) => success(res, await orderService.changeStatus(req.user.id, req.params.id, 'cancel', req.body)));
  return router;
}
