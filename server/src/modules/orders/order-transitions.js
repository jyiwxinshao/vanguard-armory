import { AppError } from '../../utils/errors.js';

// Shared cancellation side effect: restores stock in a stable equipment order.
// The caller must already hold the order row lock inside the same transaction.
export async function returnOrderStock(connection, orderId) {
  const [items] = await connection.execute('SELECT equipment_id, quantity FROM order_items WHERE order_id = ? ORDER BY equipment_id', [orderId]);
  for (const item of items) {
    const [[equipment]] = await connection.execute('SELECT stock FROM equipments WHERE id = ? FOR UPDATE', [item.equipment_id]);
    if (!equipment || equipment.stock + item.quantity > 4294967295) throw new AppError(409, 10009, '库存暂时无法返还，订单未取消，请稍后重试');
    await connection.execute('UPDATE equipments SET stock = stock + ? WHERE id = ?', [item.quantity, item.equipment_id]);
  }
  return items;
}
