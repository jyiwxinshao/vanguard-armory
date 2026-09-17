import { withConnection } from '../../../config/database.js';
import { LOW_STOCK_THRESHOLD } from '../../../config/catalog.js';

export function createAdminOverviewService({ runWithConnection = withConnection } = {}) {
  return {
    async get() {
      return runWithConnection(async (connection) => {
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
          const [[orders]] = await connection.execute(`SELECT
            COALESCE(SUM(status = 'pending'), 0) AS pending_orders,
            COALESCE(SUM(status = 'paid'), 0) AS awaiting_delivery_orders,
            COALESCE(SUM(CASE WHEN status IN ('paid', 'completed') THEN actual_total ELSE 0 END), 0) AS paid_amount
            FROM orders`);
          const [[stock]] = await connection.execute("SELECT COUNT(*) AS low_stock_count FROM equipments WHERE status = 'on_sale' AND stock <= ?", [LOW_STOCK_THRESHOLD]);
          await connection.commit();
          return {
            pending_orders: Number(orders.pending_orders), awaiting_delivery_orders: Number(orders.awaiting_delivery_orders),
            paid_amount: Number(orders.paid_amount), low_stock_count: Number(stock.low_stock_count),
            low_stock_threshold: LOW_STOCK_THRESHOLD, updated_at: new Date().toISOString(),
          };
        } catch (error) { await connection.rollback(); throw error; }
      });
    },
  };
}
