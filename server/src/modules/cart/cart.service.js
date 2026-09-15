import { createHash } from 'node:crypto';
import { withConnection, withTransaction } from '../../config/database.js';
import { AppError, validationError } from '../../utils/errors.js';
import { CART_ITEM_QUANTITY_MAX, CART_KINDS_MAX, parseMerge, parseBatchDelete, parseAddItem, parseCartItemId, parseUpdateItem } from './cart.validation.js';

export { parseAddItem, parseCartItemId, parseUpdateItem, CART_ITEM_QUANTITY_MAX } from './cart.validation.js';

function cartNotFound() {
  return new AppError(404, 10004, '购物车不存在');
}

function cartItemNotFound() {
  return new AppError(404, 10004, '购物车明细不存在');
}

function equipmentUnavailable() {
  return new AppError(404, 10004, '装备不存在或已下架');
}

function stockConflict(equipmentId, stock) {
  return new AppError(409, 10005, '库存不足', { equipment_id: equipmentId, stock });
}

async function lockCart(connection, userId) {
  const [[cart]] = await connection.execute('SELECT id FROM carts WHERE user_id = ? FOR UPDATE', [userId]);
  if (!cart) throw cartNotFound();
  return cart.id;
}

async function readSellableEquipment(connection, equipmentId) {
  const [[equipment]] = await connection.execute(
    "SELECT id, stock FROM equipments WHERE id = ? AND status = 'on_sale' FOR UPDATE",
    [equipmentId],
  );
  return equipment;
}

async function touchCart(connection, cartId) {
  await connection.execute('UPDATE carts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cartId]);
}

async function readCart(connection, cartId) {
  const [rows] = await connection.execute(
    `SELECT ci.id, ci.equipment_id, ci.quantity,
            e.name, e.image, e.price, e.rarity, e.category, e.stock, e.status
       FROM cart_items ci
       JOIN equipments e ON e.id = ci.equipment_id
      WHERE ci.cart_id = ?
      ORDER BY ci.id ASC`,
    [cartId],
  );
  const items = rows.map((row) => ({
    id: row.id,
    equipment_id: row.equipment_id,
    name: row.name,
    image: row.image,
    price: row.price,
    rarity: row.rarity,
    category: row.category,
    quantity: row.quantity,
    stock: row.stock,
    status: row.status,
    available: row.status === 'on_sale' && row.quantity <= row.stock,
    reason: row.status !== 'on_sale' ? row.status : row.stock === 0 ? 'sold_out' : row.quantity > row.stock ? 'insufficient_stock' : null,
    subtotal: row.price * row.quantity,
  }));
  const available = items.filter((item) => item.available);
  return { items, total_price: items.reduce((total, item) => total + item.subtotal, 0),
    available_total_price: available.reduce((total, item) => total + item.subtotal, 0),
    invalid_count: items.length - available.length, checkout_allowed: items.length > 0 && available.length === items.length }; 
}

export function createCartService({ runWithConnection = withConnection, runWithTransaction = withTransaction } = {}) {
  return {
    async getCart(userId) {
      return runWithConnection(async (connection) => {
        const [[cart]] = await connection.execute('SELECT id FROM carts WHERE user_id = ?', [userId]);
        if (!cart) throw cartNotFound();
        return readCart(connection, cart.id);
      });
    },

    async addItem(userId, body) {
      const { equipmentId, quantity } = parseAddItem(body);
      return runWithTransaction(async (connection) => {
        const cartId = await lockCart(connection, userId);
        const equipment = await readSellableEquipment(connection, equipmentId);
        if (!equipment) throw equipmentUnavailable();

        const [[existing]] = await connection.execute(
          'SELECT quantity FROM cart_items WHERE cart_id = ? AND equipment_id = ? FOR UPDATE',
          [cartId, equipmentId],
        );
        const nextQuantity = (existing?.quantity || 0) + quantity;
        if (nextQuantity > CART_ITEM_QUANTITY_MAX) throw validationError('quantity', `购买数量不能超过 ${CART_ITEM_QUANTITY_MAX}`);
        if (nextQuantity > equipment.stock) throw stockConflict(equipmentId, equipment.stock);

        if (existing) {
          await connection.execute('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND equipment_id = ?', [nextQuantity, cartId, equipmentId]);
        } else {
          const [[{ count }]] = await connection.execute('SELECT COUNT(*) AS count FROM cart_items WHERE cart_id = ?', [cartId]);
          if (count >= CART_KINDS_MAX) throw validationError('items', '购物车最多容纳 100 种装备');
          await connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, ?)', [cartId, equipmentId, nextQuantity]);
        }
        await touchCart(connection, cartId);
        return readCart(connection, cartId);
      });
    },

    async updateItem(userId, itemId, body) {
      const id = parseCartItemId(itemId);
      const { quantity } = parseUpdateItem(body);
      return runWithTransaction(async (connection) => {
        const cartId = await lockCart(connection, userId);
        const [[item]] = await connection.execute(
          'SELECT equipment_id FROM cart_items WHERE id = ? AND cart_id = ? FOR UPDATE',
          [id, cartId],
        );
        if (!item) throw cartItemNotFound();

        const equipment = await readSellableEquipment(connection, item.equipment_id);
        if (!equipment) throw equipmentUnavailable();
        if (quantity > equipment.stock) throw stockConflict(item.equipment_id, equipment.stock);

        await connection.execute('UPDATE cart_items SET quantity = ? WHERE id = ?', [quantity, id]);
        await touchCart(connection, cartId);
        return readCart(connection, cartId);
      });
    },

    async deleteItem(userId, itemId) {
      const id = parseCartItemId(itemId);
      return runWithTransaction(async (connection) => {
        const cartId = await lockCart(connection, userId);
        const [result] = await connection.execute('DELETE FROM cart_items WHERE id = ? AND cart_id = ?', [id, cartId]);
        if (result.affectedRows === 0) throw cartItemNotFound();
        await touchCart(connection, cartId);
        return readCart(connection, cartId);
      });
    },

    async deleteItems(userId, body) {
      const ids = parseBatchDelete(body);
      return runWithTransaction(async (connection) => {
        const cartId = await lockCart(connection, userId);
        const marks = ids.map(() => '?').join(',');
        const [owned] = await connection.execute(`SELECT id FROM cart_items WHERE cart_id = ? AND id IN (${marks}) FOR UPDATE`, [cartId, ...ids]);
        if (owned.length !== ids.length) throw cartItemNotFound();
        await connection.execute(`DELETE FROM cart_items WHERE cart_id = ? AND id IN (${marks})`, [cartId, ...ids]);
        await touchCart(connection, cartId);
        return readCart(connection, cartId);
      });
    },

    async mergeCart(userId, body) {
      const { mergeId, items } = parseMerge(body);
      const hash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
      return runWithTransaction(async (connection) => {
        const cartId = await lockCart(connection, userId);
        // Claim the globally unique batch before touching quantities. A competing account
        // waits for this transaction, then sees the original owner and is rejected.
        await connection.execute(`INSERT INTO cart_merge_receipts (merge_id, user_id, payload_hash, adjustments)
          VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE merge_id = merge_id`, [mergeId, userId, hash, 'null']);
        const [[receipt]] = await connection.execute('SELECT user_id, payload_hash, adjustments FROM cart_merge_receipts WHERE merge_id = ? FOR UPDATE', [mergeId]);
        if (receipt.user_id !== userId || receipt.payload_hash !== hash) throw new AppError(409, 10011, '合并批次与原账号或内容不一致，请保留本地数据');
        const saved = typeof receipt.adjustments === 'string' ? JSON.parse(receipt.adjustments) : receipt.adjustments;
        if (saved !== null) return { ...await readCart(connection, cartId), merge: { merge_id: mergeId, replayed: true }, adjustments: saved };

        const [existing] = await connection.execute('SELECT equipment_id, quantity FROM cart_items WHERE cart_id = ? FOR UPDATE', [cartId]);
        const quantities = new Map(existing.map((item) => [item.equipment_id, item.quantity]));
        let kinds = existing.length;
        const adjustments = [];
        for (const item of items) {
          const [[equipment]] = await connection.execute('SELECT id, stock, status FROM equipments WHERE id = ? FOR UPDATE', [item.equipment_id]);
          const previous = quantities.get(item.equipment_id) || 0;
          const requested = previous + item.quantity;
          let reason = !equipment ? 'not_found' : equipment.status !== 'on_sale' ? equipment.status : equipment.stock === 0 ? 'sold_out' : null;
          let accepted = previous;
          if (!reason) {
            accepted = Math.min(requested, equipment.stock, CART_ITEM_QUANTITY_MAX);
            if (accepted < requested) reason = equipment.stock <= CART_ITEM_QUANTITY_MAX ? 'stock_limit' : 'quantity_limit';
            if (previous) await connection.execute('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND equipment_id = ?', [accepted, cartId, item.equipment_id]);
            else {
              kinds += 1;
              if (kinds > CART_KINDS_MAX) throw validationError('items', '合并后超过 100 种装备，请先整理服务器购物车后重试');
              await connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, ?)', [cartId, item.equipment_id, accepted]);
            }
          }
          if (reason) adjustments.push({ equipment_id: item.equipment_id, previous_quantity: previous, incoming_quantity: item.quantity, requested_quantity: requested, accepted_quantity: accepted, reason });
        }
        await touchCart(connection, cartId);
        await connection.execute('UPDATE cart_merge_receipts SET adjustments = ? WHERE merge_id = ?', [JSON.stringify(adjustments), mergeId]);
        return { ...await readCart(connection, cartId), merge: { merge_id: mergeId, replayed: false }, adjustments };
      });
    },

    async clearCart(userId) {
      return runWithTransaction(async (connection) => {
        const cartId = await lockCart(connection, userId);
        await connection.execute('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
        await touchCart(connection, cartId);
        return readCart(connection, cartId);
      });
    },
  };
}

const defaultService = createCartService();
export const getCart = (userId) => defaultService.getCart(userId);
export const addCartItem = (userId, body) => defaultService.addItem(userId, body);
export const updateCartItem = (userId, itemId, body) => defaultService.updateItem(userId, itemId, body);
export const deleteCartItem = (userId, itemId) => defaultService.deleteItem(userId, itemId);
export const clearCart = (userId) => defaultService.clearCart(userId);
