import express from 'express';
import { createOrderService } from './modules/orders/orders.service.js';
import { createOrderRouter } from './modules/orders/orders.router.js';
import { catalogMeta } from './config/catalog.js';
import { checkDatabase } from './modules/health/health.service.js';
import { getEquipmentById, listEquipments, parseEquipmentId, parseEquipmentQuery } from './modules/equipments/equipment.service.js';
import { AppError, logError, success } from './utils/errors.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createAuthRouter } from './modules/auth/auth.router.js';
import { createCartService } from './modules/cart/cart.service.js';
import { createCartRouter } from './modules/cart/cart.router.js';
import { createRequireAuth, requireRole } from './middleware/auth.js';

// Dependency injection lets HTTP error paths be tested without pretending a database is available.
export function createApp({ healthCheck = checkDatabase, equipmentList = listEquipments, equipmentDetail = getEquipmentById, logger = logError, authService = createAuthService(), cartService = createCartService(), orderService = createOrderService() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/auth', createAuthRouter({ authService }));
  app.use('/api/cart', createCartRouter({ authService, cartService }));
  app.use('/api/orders', createOrderRouter({ authService, orderService }));
  app.get('/api/admin/me', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, createRequireAuth(authService), requireRole('admin'), (req, res) => success(res, req.user));

  app.get('/api/health', async (_req, res) => {
    let database;
    try {
      database = await healthCheck();
    } catch (error) {
      logger('database.health', error);
      database = 'unavailable';
    }
    if (database !== 'ready') {
      return res.status(503).json({
        code: 10010,
        message: '商城服务暂未就绪，请稍后重试',
        data: { service: 'game-store-api', status: 'unavailable', database },
      });
    }
    return success(res, { service: 'game-store-api', status: 'ready', database });
  });

  app.get('/api/meta', (_req, res) => success(res, catalogMeta));
  app.get('/api/equipments', async (req, res) => {
    const filters = parseEquipmentQuery(req.query);
    return success(res, await equipmentList(filters));
  });
  app.get('/api/equipments/:id', async (req, res) => success(res, await equipmentDetail(parseEquipmentId(req.params.id))));

  app.use((_req, _res, next) => next(new AppError(404, 10004, '访问的资源不存在')));
  app.use((error, _req, res, _next) => {
    if (error instanceof URIError && error.status === 400) {
      return res.status(422).json({ code: 10001, message: '路径参数格式错误', data: { errors: [{ field: 'path', message: '路径参数编码无效' }] } });
    }
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(422).json({ code: 10001, message: '请求内容格式错误或过大', data: { errors: [{ field: 'body', message: '请提交有效且不超过 100 KB 的 JSON' }] } });
    }
    if (error instanceof AppError) {
      return res.status(error.status).json({ code: error.code, message: error.message, data: error.data });
    }
    logger('http.request', error);
    return res.status(500).json({ code: 99999, message: '服务暂时不可用，请稍后重试', data: null });
  });
  return app;
}
