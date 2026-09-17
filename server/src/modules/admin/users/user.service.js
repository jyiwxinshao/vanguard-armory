import { withConnection } from '../../../config/database.js';
import { AppError } from '../../../utils/errors.js';
import { parseAdminUserId, parseAdminUserQuery, parseAdminUserStatus } from './user.validation.js';
import { readCharacters } from '../../characters/characters.service.js';
import { parseCharacterAssignment } from '../../characters/characters.validation.js';

const publicColumns = 'id, username, email, avatar, role, status, created_at, updated_at';

export function createAdminUserService({ runWithConnection = withConnection } = {}) {
  async function readUser(connection, id) {
    const [[user]] = await connection.execute(`SELECT ${publicColumns} FROM users WHERE id = ?`, [id]);
    if (!user) throw new AppError(404, 10004, '用户不存在');
    return user;
  }

  return {
    async listCharacters(value) {
      const id = parseAdminUserId(value);
      return runWithConnection(async (connection) => {
        const user = await readUser(connection, id);
        if (user.role !== 'user') throw new AppError(403, 10003, '只能配置普通用户的游戏角色');
        return readCharacters(connection, id);
      });
    },
    async saveCharacter(_actorId, value, serverValue, body) {
      const id = parseAdminUserId(value);
      const { server, name, expectedName } = parseCharacterAssignment(serverValue, body);
      return runWithConnection(async (connection) => {
        await connection.beginTransaction();
        try {
          // Serialize assignments per account, including the first character on a server.
          const [[user]] = await connection.execute('SELECT id, role FROM users WHERE id = ? FOR UPDATE', [id]);
          if (!user) throw new AppError(404, 10004, '用户不存在');
          if (user.role !== 'user') throw new AppError(403, 10003, '只能配置普通用户的游戏角色');
          const [[character]] = await connection.execute('SELECT id, character_name FROM game_characters WHERE user_id = ? AND server = ? FOR UPDATE', [id, server]);
          if (character?.character_name !== name) {
            if ((character?.character_name ?? null) !== expectedName) throw new AppError(409, 10008, '角色已被修改，请刷新后重新确认');
            if (character) await connection.execute('UPDATE game_characters SET character_name = ? WHERE id = ?', [name, character.id]);
            else await connection.execute('INSERT INTO game_characters (user_id, server, character_name) VALUES (?, ?, ?)', [id, server, name]);
          }
          const result = await readCharacters(connection, id);
          await connection.commit();
          return result;
        } catch (error) { await connection.rollback(); throw error; }
      });
    },
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
