import { Router } from 'express';
import { createAuthService } from './auth.service.js';
import { createRequireAuth } from '../../middleware/auth.js';
import { success } from '../../utils/errors.js';

export function createAuthRouter({ authService = createAuthService() } = {}) {
  const router = Router();
  const requireAuthentication = createRequireAuth(authService);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/register', async (req, res) => success(res, await authService.register(req.body), 201));
  router.post('/login', async (req, res) => success(res, await authService.login(req.body)));
  router.get('/me', requireAuthentication, (req, res) => success(res, req.user));
  // This acknowledges client-side logout; an issued token is not revoked on the server.
  router.post('/logout', requireAuthentication, (_req, res) => success(res, { logged_out: true }));
  return router;
}
