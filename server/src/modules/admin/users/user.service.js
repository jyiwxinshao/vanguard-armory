import { adminFeaturePending } from '../pending.js';

// Next: validate filters/body in user.validation.js; return explicit safe columns only.
// changeStatus may target normal users only. Never expose password_hash or edit admin roles.
export function createAdminUserService() {
  return { list: adminFeaturePending, get: adminFeaturePending, changeStatus: adminFeaturePending };
}
