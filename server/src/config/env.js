import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} 必须是 1–65535 之间的整数`);
  }
  return value;
}

export const env = {
  host: process.env.HOST || '127.0.0.1',
  port: port('PORT', 3000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: port('DB_PORT', 3306),
    database: process.env.DB_NAME || 'game_store',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },
};

if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(env.db.database)) {
  throw new Error('DB_NAME 必须以字母开头，仅包含字母、数字和下划线，最多 64 位');
}
