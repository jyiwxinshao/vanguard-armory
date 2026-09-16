import { adminFeaturePending } from '../pending.js';

// Next: add equipment.validation.js and inject withConnection/withTransaction, as in orders.
// Editing excludes stock; adjustStock needs an idempotency key; remove is a guarded soft delete.
export function createAdminEquipmentService() {
  return {
    list: adminFeaturePending,
    get: adminFeaturePending,
    create: adminFeaturePending,
    update: adminFeaturePending,
    adjustStock: adminFeaturePending,
    remove: adminFeaturePending,
  };
}
