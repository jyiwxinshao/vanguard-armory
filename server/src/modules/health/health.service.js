import { withConnection } from '../../config/database.js';
import { inspectSchema } from '../../config/schema.js';

export async function checkDatabase() {
  return withConnection(async (connection) => {
    const result = await inspectSchema(connection);
    if (result.status !== 'ready') return result.status;
    await connection.query('SELECT id, name, price, rarity, category, image, attack, defense, description, stock, status, created_at FROM equipments LIMIT 0');
    return 'ready';
  });
}
