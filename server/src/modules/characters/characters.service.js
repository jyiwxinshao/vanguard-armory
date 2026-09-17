import { catalogMeta } from '../../config/catalog.js';

export async function readCharacters(connection, userId) {
  const [items] = await connection.execute('SELECT id, server, character_name, created_at FROM game_characters WHERE user_id = ? ORDER BY id', [userId]);
  return { items, servers: catalogMeta.servers };
}
