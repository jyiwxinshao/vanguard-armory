import { withConnection } from '../../../config/database.js';
import { AppError } from '../../../utils/errors.js';
import { parseAdminUserId, parseAdminUserQuery, parseAdminUserStatus } from './user.validation.js';

const publicColumns = 'id, username, email, avatar, role, status, created_at, updated_at';

export function createAdminUserService({ runWithConnection = withConnection } = {}) {
  async function readUser(connection, id) {
    const [[user]] = await connection.execute(`SELECT ${publicColumns} FROM users WHERE id = ?`, [id]);
    if (!user) throw new AppError(404, 10004, '用户不存在');
    return user;
  }

  return {
    async list(query) {
      const filters = parseAdminUserQuery(query);
      const conditions = [];
      const values = [];
      if (filters.keyword) {
        conditions.push("(username LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!')");
        const pattern = `%${filters.keyword.replace(/[!%_]/g, (character) => `!${character}`)}%`;
        values.push(pattern, pattern);
      }
      if (filters.status) { conditions.push('status = ?'); values.push(filters.status); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return runWithConnection(async (connection) => {
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
          const [[{ total }]] = await connection.execute(`SELECT COUNT(*) AS total FROM users ${where}`, values);
          const [items] = await connection.execute(
            `SELECT ${publicColumns} FROM users ${where} ORDER BY created_at DESC, id DESC LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`, values,
          );
          await connection.commit();
          return { items, total, page: filters.page, page_size: filters.pageSize };
        } catch (error) { await connection.rollback(); throw error; }
      });
    },

    async get(value) {
      const id = parseAdminUserId(value);
      return runWithConnection((connection) => readUser(connection, id));
    },

    async changeStatus(_actorId, value, body) {
      const id = parseAdminUserId(value);
      const { status } = parseAdminUserStatus(body);
      return runWithConnection(async (connection) => {
        await connection.beginTransaction();
        try {
          const [[user]] = await connection.execute('SELECT id, role, status FROM users WHERE id = ? FOR UPDATE', [id]);
          if (!user) throw new AppError(404, 10004, '用户不存在');
          if (user.role !== 'user') throw new AppError(403, 10003, '只能管理普通用户账号');
          if (user.status === status) { await connection.commit(); return readUser(connection, id); }
          await connection.execute('UPDATE users SET status = ? WHERE id = ?', [status, id]);
          const updated = await readUser(connection, id);
          await connection.commit();
          return updated;
        } catch (error) { await connection.rollback(); throw error; }
      });
    },
  };
}
