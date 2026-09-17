import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminEquipmentQuery } from '../src/modules/admin/equipments/equipment.validation.js';
import { createAdminOverviewService } from '../src/modules/admin/overview/overview.service.js';

test('low-stock filter is an explicit validated admin option', () => {
  assert.equal(parseAdminEquipmentQuery({ low_stock: '1', status: 'on_sale' }).lowStock, true);
  assert.equal(parseAdminEquipmentQuery({ low_stock: '0' }).lowStock, false);
  for (const low_stock of ['true', true, 1, ['1'], '5']) assert.throws(() => parseAdminEquipmentQuery({ low_stock }), { status: 422 });
});

test('overview rolls back a failed snapshot instead of publishing partial statistics', async () => {
  let rolledBack = false;
  const service = createAdminOverviewService({ runWithConnection: async (run) => run({
    query: async () => {}, execute: async () => { throw new Error('offline'); },
    commit: async () => assert.fail('failed snapshot cannot commit'), rollback: async () => { rolledBack = true; },
  }) });
  await assert.rejects(service.get(), /offline/);
  assert.equal(rolledBack, true);
});
