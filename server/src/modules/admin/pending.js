import { AppError } from '../../utils/errors.js';

// Reserved routes must never report success until their real transaction/validation is implemented.
export function adminFeaturePending() {
  throw new AppError(501, 10011, '此管理功能尚未开放');
}
