import test from 'node:test';
import assert from 'node:assert/strict';
import { cartItemIssue, selectedCartItems, selectedCartQuantity, selectedCartTotal } from '../src/utils/cart.js';

function item(overrides = {}) {
  return {
    id: 1,
    equipment_id: 11,
    quantity: 2,
    price: 1000,
    subtotal: 2000,
    stock: 5,
    status: 'on_sale',
    available: true,
    ...overrides,
  };
}

test('cart item issues distinguish normal, sold-out, insufficient, off-sale and deleted items', () => {
  assert.equal(cartItemIssue(item()), '');
  assert.equal(cartItemIssue(item({ available: false, stock: 0 })), '已售罄');
  assert.equal(cartItemIssue(item({ available: false, quantity: 4, stock: 2 })), '库存不足');
  assert.equal(cartItemIssue(item({ available: false, status: 'off_sale' })), '已下架');
  assert.equal(cartItemIssue(item({ available: false, status: 'deleted' })), '已删除');
});

test('selection helpers only include available selected items and sum their quantities and subtotals', () => {
  const items = [
    item({ id: 1, quantity: 2, subtotal: 2000, available: true }),
    item({ id: 2, equipment_id: 12, quantity: 3, subtotal: 4500, available: true }),
    item({ id: 3, equipment_id: 13, quantity: 5, subtotal: 5000, available: false, status: 'off_sale' }),
  ];
  assert.deepEqual(selectedCartItems(items, [1, 2, 3]).map((row) => row.id), [1, 2]);
  assert.equal(selectedCartQuantity(items, [1, 2, 3]), 5);
  assert.equal(selectedCartTotal(items, [1, 2, 3]), 6500);
  assert.deepEqual(selectedCartItems(items, []), []);
  assert.equal(selectedCartTotal(items, [3]), 0);
});
