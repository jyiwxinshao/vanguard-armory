import { createAuthService } from '../modules/auth/auth.service.js';
import { AppError } from '../utils/errors.js';
import { authenticationError } from '../utils/token.js';

export function createRequireAuth(authService) {
  return async (req, _res, next) => {
    try {
      req.user = await authService.authenticate(req.headers.authorization);
      next();
    } catch (error) {
      next(error);
    }
  };
}

let defaultService;
export function requireAuth(req, res, next) {
  try {
    defaultService ??= createAuthService();
    return createRequireAuth(defaultService)(req, res, next);
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...roles) {
  if (!roles.length || roles.some((role) => !['admin', 'user'].includes(role))) {
    throw new Error('requireRole 必须声明有效的 user 或 admin 角色');
  }
  return (req, _res, next) => {
    if (!req.user) return next(authenticationError());
    if (!roles.includes(req.user.role)) return next(new AppError(403, 10003, '没有执行此操作的权限'));
    return next();
  };
}
