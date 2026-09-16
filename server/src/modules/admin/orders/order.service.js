import { adminFeaturePending } from '../pending.js';

// Next: order.validation.js; share cancellation transaction helpers with the user order service.
// Allowed transitions: pending -> cancelled, paid -> completed. Never accept arbitrary status.
export function createAdminOrderService() {
  return { list: adminFeaturePending, get: adminFeaturePending, changeStatus: adminFeaturePending };
}
