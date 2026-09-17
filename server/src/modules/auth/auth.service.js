import { withConnection, withTransaction } from '../../config/database.js';
import { AppError, validationError } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { authenticationError, createTokenService } from '../../utils/token.js';
import { parseLogin, parseRegistration } from './auth.validation.js';
import { readCharacters } from '../characters/characters.service.js';

const publicColumns = 'id, username, email, avatar, role, status, created_at, updated_at';

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function assertActive(user) {
  if (user.status === 'frozen') throw new AppError(403, 10006, '账号已被冻结，请联系管理员');
  if (user.status !== 'active' || !['admin', 'user'].includes(user.role)) throw authenticationError();
}

export function createAuthService({ runWithConnection = withConnection, runWithTransaction = withTransaction, tokens = createTokenService() } = {}) {
  return {
    async listCharacters(userId) {
      return runWithConnection((connection) => readCharacters(connection, userId));
    },
    async register(body) {
      const { username, email, password } = parseRegistration(body);
      const passwordHash = await hashPassword(password);
      try {
        return await runWithTransaction(async (connection) => {
          const [result] = await connection.execute(
            "INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, 'user', 'active')",
            [username, email, passwordHash],
          );
          await connection.execute('INSERT INTO carts (user_id) VALUES (?)', [result.insertId]);
          const [[user]] = await connection.execute(`SELECT ${publicColumns} FROM users WHERE id = ?`, [result.insertId]);
          return publicUser(user);
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          const detail = error.sqlMessage || error.message || '';
          // Match the constraint suffix, not a username/email containing an index name.
          const key = /for key ['`](?:[^'`]*\.)?(uq_users_username|uq_users_email)['`]\s*$/i.exec(detail)?.[1];
          if (key === 'uq_users_username') throw validationError('username', '此用户名已被使用');
          if (key === 'uq_users_email') throw validationError('email', '此邮箱已被使用');
        }
        throw error;
      }
    },

    async login(body) {
      const { account, password } = parseLogin(body);
      const column = account.includes('@') ? 'email' : 'username';
      const user = await runWithConnection(async (connection) => {
        const [[row]] = await connection.execute(`SELECT ${publicColumns}, password_hash FROM users WHERE ${column} = ? LIMIT 1`, [account]);
        return row;
      });
      if (!user || !await verifyPassword(password, user.password_hash)) {
        throw new AppError(401, 10002, '用户名、邮箱或密码错误');
      }
      assertActive(user);
      return { token: tokens.sign(user.id), expires_in: tokens.expiresInSeconds, user: publicUser(user) };
    },

    async authenticate(authorization) {
      if (typeof authorization !== 'string') throw authenticationError();
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      if (!match) throw authenticationError();
      const userId = tokens.verify(match[1]);
      const user = await runWithConnection(async (connection) => {
        const [[row]] = await connection.execute(`SELECT ${publicColumns} FROM users WHERE id = ?`, [userId]);
        return row;
      });
      if (!user) throw authenticationError();
      assertActive(user);
      return publicUser(user);
    },
  };
}
