import { withConnection, withTransaction } from '../../../config/database.js';
import { AppError } from '../../../utils/errors.js';
import { returnOrderStock } from '../../orders/order-transitions.js';
import { parseAdminOrderId, parseAdminOrderQuery, parseAdminOrderStatus } from './order.validation.js';

const orderColumns = 'id, order_no, user_id, total, discount, actual_total, character_id, character_name, server, status, payment_time, cancelled_at, completed_at, created_at, updated_at';
const notFound = () => new AppError(404, 10004, '订单不存在');
const terminalConflict = () => new AppError(409, 10008, '当前订单状态不允许此操作，请刷新查看');

async function readOrder(connection, id) {
  const [[order]] = await connection.execute(`SELECT ${orderColumns} FROM orders WHERE id = ?`, [id]);
  if (!order) throw notFound();
  const [rows] = await connection.execute('SELECT id, equipment_id, equipment_name, equipment_image, rarity, price, quantity FROM order_items WHERE order_id = ? ORDER BY id', [id]);
  return { ...order, items: rows.map((item) => ({ ...item, subtotal: item.price * item.quantity })) };
}

function transactionError(error) {
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) throw new AppError(409, 10009, '操作发生竞争，未提交本次修改，请重试');
  throw error;
}

export function createAdminOrderService({ runWithConnection = withConnection, runWithTransaction = withTransaction } = {}) {
  return {
    async list(query) {
      const { userId, status, orderNo, from, to, page, pageSize } = parseAdminOrderQuery(query);
      const conditions = []; const values = [];
      if (orderNo) { conditions.push("order_no LIKE ? ESCAPE '!'"); values.push(`%${orderNo.replace(/[!%_]/g, (character) => `!${character}`)}%`); }
      if (userId) { conditions.push('user_id = ?'); values.push(userId); }
      if (status) { conditions.push('status = ?'); values.push(status); }
      if (from) { conditions.push('created_at >= ?'); values.push(from); }
      if (to) { conditions.push('created_at < ?'); values.push(to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return runWithConnection(async (connection) => {
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
          const [[{ total }]] = await connection.execute(`SELECT COUNT(*) AS total FROM orders ${where}`, values);
          const [items] = await connection.execute(`SELECT ${orderColumns} FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values);
          await connection.commit();
          return { items, total, page, page_size: pageSize };
        } catch (error) { await connection.rollback(); throw error; }
      });
    },

    async get(value) {
      const id = parseAdminOrderId(value);
      return runWithConnection((connection) => readOrder(connection, id));
    },

    async changeStatus(_actorId, value, body) {
      const id = parseAdminOrderId(value);
      const target = parseAdminOrderStatus(body);
      try {
        return await runWithTransaction(async (connection) => {
          const [[order]] = await connection.execute('SELECT id, status FROM orders WHERE id = ? FOR UPDATE', [id]);
          if (!order) throw notFound();
          if (order.status === target) return readOrder(connection, id);
          if (target === 'cancelled' && order.status !== 'pending') throw terminalConflict();
          if (target === 'completed' && order.status !== 'paid') throw terminalConflict();
          if (target === 'cancelled') await returnOrderStock(connection, id);
          const time = target === 'cancelled' ? 'cancelled_at' : 'completed_at';
          await connection.execute(`UPDATE orders SET status = ?, ${time} = CURRENT_TIMESTAMP WHERE id = ?`, [target, id]);
          return readOrder(connection, id);
        });
      } catch (error) { return transactionError(error); }
    },
  };
}
