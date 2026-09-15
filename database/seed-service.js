import { demoEquipments } from './equipments.js';
import { hashPassword, validatePassword } from '../server/src/utils/password.js';
import { setupError, tableCounts } from './helpers.js';
import { inspectSchema } from '../server/src/config/schema.js';

export async function seedDatabase(connection, { adminPassword, userPassword }) {
  const [[{ db_name: databaseName }]] = await connection.query('SELECT DATABASE() AS db_name');
  const lockName = `gs_seed_${databaseName}`.slice(0, 64);
  const [[{ locked }]] = await connection.execute('SELECT GET_LOCK(?, 5) AS locked', [lockName]);
  if (locked !== 1) throw setupError('另一个初始化操作正在运行，请稍后再试');
  try {
    const schema = await inspectSchema(connection);
    if (schema.status !== 'ready') throw setupError('数据库结构未就绪，请先执行 npm run db:init 并处理结构检查结果');
    const counts = await tableCounts(connection);
    if (Object.values(counts).some((count) => count > 0)) return { seeded: false, counts };
    try {
      validatePassword(adminPassword, 'SEED_ADMIN_PASSWORD');
      validatePassword(userPassword, 'SEED_USER_PASSWORD');
    } catch (error) {
      throw setupError(error.message);
    }
    const [adminHash, userHash] = await Promise.all([hashPassword(adminPassword), hashPassword(userPassword)]);
    await connection.beginTransaction();
    try {
      const accounts = [
        ['admin', 'admin@example.test', adminHash, 'admin'],
        ['player_one', 'player.one@example.test', userHash, 'user'],
        ['player_two', 'player.two@example.test', userHash, 'user'],
      ];
      for (const account of accounts) {
        const [result] = await connection.execute('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', account);
        if (account[3] === 'user') await connection.execute('INSERT INTO carts (user_id) VALUES (?)', [result.insertId]);
      }
      for (const item of demoEquipments) {
        await connection.execute(
          'INSERT INTO equipments (name, price, rarity, category, image, attack, defense, new_until, description, stock, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [item.name, item.price, item.rarity, item.category, item.image, item.attack, item.defense, item.new_until ?? null, item.description, item.stock, item.status],
        );
      }
      await connection.commit();
      return { seeded: true, counts: await tableCounts(connection) };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}
