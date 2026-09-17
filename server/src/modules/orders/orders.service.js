import { createHash, randomBytes } from 'node:crypto';
import { withConnection, withTransaction } from '../../config/database.js';
import { AppError, validationError } from '../../utils/errors.js';
import { readCart } from '../cart/cart.service.js';
import { returnOrderStock } from './order-transitions.js';
import { ORDER_TOTAL_MAX, parseCreateOrder, parseCharacterQuery, parseOrderAction, parseOrderId, parseOrderQuery, parseRequestId } from './orders.validation.js';

const orderColumns = 'id, order_no, user_id, total, discount, actual_total, character_id, character_name, server, status, payment_time, cancelled_at, completed_at, created_at, updated_at';
const notFound = () => new AppError(404, 10004, '订单不存在');
const changed = () => new AppError(409, 10007, '购物车或确认价格已变化，请重新确认订单');
const unavailable = () => new AppError(409, 10009, '购物车包含失效装备，请返回购物车处理');
const stockError = (id, stock) => new AppError(409, 10005, '库存不足，请返回购物车调整数量', { equipment_id: id, stock });
const requestConflict = () => new AppError(409, 10012, '提交编号与原账号或原内容不一致，请核对原订单');
function orderNo() { return new Date().toISOString().replace(/\D/g, '').slice(0, 14) + randomBytes(5).toString('hex'); }
async function readOrder(connection, userId, id) {
  const [[order]] = await connection.execute(`SELECT ${orderColumns} FROM orders WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!order) throw notFound();
  // Historical display reads only snapshots; equipment changes never change an order.
  const [rows] = await connection.execute('SELECT id, equipment_id, equipment_name, equipment_image, rarity, price, quantity FROM order_items WHERE order_id = ? ORDER BY id', [id]);
  return { ...order, items: rows.map((item) => ({ ...item, subtotal: item.price * item.quantity })) };
}
function transactionError(error) {
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) throw new AppError(409, 10009, '操作发生竞争，未提交本次修改，请使用同一提交编号重试');
  throw error;
}
export function createOrderService({ runWithConnection = withConnection, runWithTransaction = withTransaction, makeOrderNo = orderNo } = {}) {
  return {
    async getCharacter(userId, query) {
      const server = parseCharacterQuery(query);
      return runWithConnection(async (connection) => {
        const [[character]] = await connection.execute('SELECT id, server, character_name FROM game_characters WHERE user_id = ? AND server = ?', [userId, server]);
        return { character: character || null };
      });
    },
    async createOrder(userId, body) {
      const input = parseCreateOrder(body);
      const { requestId, items, characterId, characterName, server, remark, legacy } = input;
      // Preserve the original hash for replay of already-created legacy orders only.
      const hash = createHash('sha256').update(JSON.stringify(legacy ? { characterName, server, remark, items } : { characterId, server, items })).digest('hex');
      try {
        return await runWithTransaction(async (connection) => {
          const [[cart]] = await connection.execute('SELECT id FROM carts WHERE user_id = ? FOR UPDATE', [userId]);
          if (!cart) throw new AppError(404, 10004, '购物车不存在');
          await connection.execute(`INSERT INTO order_requests (request_id, user_id, payload_hash) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE request_id = request_id`, [requestId, userId, hash]);
          const [[receipt]] = await connection.execute('SELECT user_id, payload_hash, order_id FROM order_requests WHERE request_id = ? FOR UPDATE', [requestId]);
          if (receipt.user_id !== userId || receipt.payload_hash !== hash) throw requestConflict();
          if (receipt.order_id) return { order: await readOrder(connection, userId, receipt.order_id), request_id: requestId, replayed: true, cart: await readCart(connection, cart.id) };
          if (legacy) throw new AppError(409, 10007, '兑换信息已升级，请重新确认服务器与账号角色后下单');
          const [[character]] = await connection.execute('SELECT id, character_name FROM game_characters WHERE user_id = ? AND server = ? FOR UPDATE', [userId, server]);
          if (!character || character.id !== characterId) throw new AppError(409, 10007, '该服务器的角色不存在或已变化，请重新查询角色后下单');
          const [rows] = await connection.execute('SELECT id, equipment_id, quantity FROM cart_items WHERE cart_id = ? ORDER BY equipment_id FOR UPDATE', [cart.id]);
          if (!rows.length) throw new AppError(409, 10009, '购物车为空，请先添加装备');
          if (rows.length !== items.length || rows.some((row, index) => row.id !== items[index].cart_item_id || row.equipment_id !== items[index].equipment_id || row.quantity !== items[index].quantity)) throw changed();
          const snapshots = [];
          for (const item of items) {
            const [[equipment]] = await connection.execute('SELECT id, name, image, rarity, price, stock, status FROM equipments WHERE id = ? FOR UPDATE', [item.equipment_id]);
            if (!equipment || equipment.status !== 'on_sale') throw unavailable();
            if (equipment.stock < item.quantity) throw stockError(item.equipment_id, equipment.stock);
            snapshots.push({ ...equipment, quantity: item.quantity, expected_price: item.expected_price });
          }
          if (snapshots.some((item) => item.price !== item.expected_price)) throw changed();
          const total = snapshots.reduce((sum, item) => sum + item.price * item.quantity, 0);
          if (!Number.isSafeInteger(total) || total < 1 || total > ORDER_TOTAL_MAX) throw validationError('items', '订单总额超出允许范围，请减少装备数量');
          for (const item of snapshots) {
            const [result] = await connection.execute('UPDATE equipments SET stock = stock - ? WHERE id = ? AND stock >= ?', [item.quantity, item.id, item.quantity]);
            if (result.affectedRows !== 1) throw stockError(item.id, item.stock);
          }
          let id;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const [result] = await connection.execute(`INSERT INTO orders (order_no, user_id, total, discount, actual_total, character_id, character_name, server)
                VALUES (?, ?, ?, 0, ?, ?, ?, ?)`, [makeOrderNo(), userId, total, total, character.id, character.character_name, server]);
              id = result.insertId; break;
            } catch (error) { if (error.code !== 'ER_DUP_ENTRY' || attempt === 2) throw error; }
          }
          for (const item of snapshots) await connection.execute(`INSERT INTO order_items (order_id, equipment_id, equipment_name, equipment_image, rarity, price, quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, item.id, item.name, item.image, item.rarity, item.price, item.quantity]);
          const ids = rows.map((row) => row.id);
          const [deleted] = await connection.execute(`DELETE FROM cart_items WHERE cart_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [cart.id, ...ids]);
          if (deleted.affectedRows !== ids.length) throw changed();
          await connection.execute('UPDATE carts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [cart.id]);
          await connection.execute('UPDATE order_requests SET order_id = ? WHERE request_id = ?', [id, requestId]);
          return { order: await readOrder(connection, userId, id), request_id: requestId, replayed: false, cart: await readCart(connection, cart.id) };
        });
      } catch (error) { return transactionError(error); }
    },
    async getOrder(userId, value) {
      const id = parseOrderId(value);
      return runWithConnection((connection) => readOrder(connection, userId, id));
    },
    async getByRequest(userId, value) {
      const requestId = parseRequestId(value);
      return runWithConnection(async (connection) => {
        const [[receipt]] = await connection.execute('SELECT order_id FROM order_requests WHERE request_id = ? AND user_id = ?', [requestId, userId]);
        if (!receipt?.order_id) throw notFound();
        return { request_id: requestId, order: await readOrder(connection, userId, receipt.order_id) };
      });
    },
    async listOrders(userId, query) {
      const { status, from, to, page, pageSize } = parseOrderQuery(query);
      const conditions = ['user_id = ?']; const values = [userId];
      if (status) { conditions.push('status = ?'); values.push(status); }
      if (from) { conditions.push('created_at >= ?'); values.push(from); }
      if (to) { conditions.push('created_at < ?'); values.push(to); }
      const where = conditions.join(' AND ');
      return runWithConnection(async (connection) => {
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
          const [[{ total }]] = await connection.execute(`SELECT COUNT(*) AS total FROM orders WHERE ${where}`, values);
          const [items] = await connection.execute(`SELECT ${orderColumns} FROM orders WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values);
          await connection.commit();
          return { items, total, page, page_size: pageSize };
        } catch (error) { await connection.rollback(); throw error; }
      });
    },
    async changeStatus(userId, value, action, body) {
      const id = parseOrderId(value); parseOrderAction(body);
      if (!['pay', 'cancel'].includes(action)) throw validationError('action', '订单操作无效');
      const target = action === 'pay' ? 'paid' : 'cancelled';
      try {
        return await runWithTransaction(async (connection) => {
          const [[order]] = await connection.execute('SELECT id, status FROM orders WHERE id = ? AND user_id = ? FOR UPDATE', [id, userId]);
          if (!order) throw notFound();
          if (order.status === target) return readOrder(connection, userId, id);
          if (order.status !== 'pending') throw new AppError(409, 10008, '当前订单状态不允许此操作，请刷新查看');
          if (action === 'cancel') {
            await returnOrderStock(connection, id);
          }
          const time = action === 'pay' ? 'payment_time' : 'cancelled_at';
          await connection.execute(`UPDATE orders SET status = ?, ${time} = CURRENT_TIMESTAMP WHERE id = ?`, [target, id]);
          return readOrder(connection, userId, id);
        });
      } catch (error) { return transactionError(error); }
    },
  };
}
