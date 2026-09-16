import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentCreateBody, equipmentCreateFailure } from '../src/utils/admin/equipment-form.js';
const form = { name: '  新长剑 ', price: '19.90', image: '/images/equipments/placeholder.svg', rarity: 'R', category: 'weapon', attack: '0', defense: '0', stock: '12', status: 'off_sale', description: '', series_code: '', new_until: '' };

test('create form converts decimal money exactly and handles optional fields', () => {
  for (const [price, cents] of [['19.90', 1990], ['0.29', 29], ['0.01', 1], ['10000', 1000000]]) {
    const result = equipmentCreateBody({ ...form, price });
    assert.deepEqual(result.errors, {});
    assert.equal(result.body.price, cents);
    assert.equal(result.body.name, '新长剑');
    assert.equal(result.body.stock, 12);
    assert.equal(result.body.description, null);
    assert.equal(result.body.new_until, null);
  }
  const input = '2026-10-01T12:30';
  assert.equal(equipmentCreateBody({ ...form, new_until: input }).body.new_until, new Date(input).toISOString());
});

test('create form rejects money rounding, invalid counts, dates and oversized text', () => {
  for (const price of ['0', '-1', '1.005', '1e2', '10000.01', '', 'Infinity']) assert.ok(equipmentCreateBody({ ...form, price }).errors.price);
  for (const stock of ['', '-1', '2.3', '4294967296', '1e2']) assert.ok(equipmentCreateBody({ ...form, stock }).errors.stock);
  assert.ok(equipmentCreateBody({ ...form, name: ' ' }).errors.name);
  assert.ok(equipmentCreateBody({ ...form, description: '剑'.repeat(501) }).errors.description);
  assert.ok(equipmentCreateBody({ ...form, new_until: '2026-02-30T12:00' }).errors.new_until);
});

test('ambiguous write failures require verification rather than automatic resubmission', () => {
  assert.equal(equipmentCreateFailure(new Error('timeout')), true);
  assert.equal(equipmentCreateFailure({ response: { status: 500 } }), true);
  assert.equal(equipmentCreateFailure({ response: { status: 422 } }), false);
  assert.equal(equipmentCreateFailure({ response: { status: 403 } }), false);
});
