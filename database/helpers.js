import { readFile } from 'node:fs/promises';
import { requiredTables, inspectSchema } from '../server/src/config/schema.js';
import { backfillEquipmentSeries, runMigrations } from './migrations.js';
import { seedDemoCharacters } from './characters.js';

export const schemaUrl = new URL('./schema.sql', import.meta.url);

export function setupError(message) {
  const error = new Error(message);
  error.code = 'SETUP_ERROR';
  return error;
}

export function validateMysqlVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [];
  if (!match || version.includes('MariaDB') || major < 8 || (major === 8 && minor === 0 && patch < 16)) {
    throw setupError('此项目需要 MySQL 8.0.16 或更新版本，以执行 CHECK 约束');
  }
}

export async function applySchema(connection) {
  const [[{ version }]] = await connection.query('SELECT VERSION() AS version');
  validateMysqlVersion(version);
  await connection.query(await readFile(schemaUrl, 'utf8'));
  await runMigrations(connection);
  const result = await inspectSchema(connection);
  if (result.status !== 'ready') throw setupError(`现有数据表结构与项目约定不一致，未自动修改旧表：${result.issues.join('；')}`);
  await backfillEquipmentSeries(connection);
  await seedDemoCharacters(connection);
}

export async function tableCounts(connection) {
  const counts = {};
  for (const table of requiredTables) {
    const [[{ total }]] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    counts[table] = total;
  }
  return counts;
}

export function reportScriptError(error) {
  const hints = {
    ER_ACCESS_DENIED_ERROR: '数据库认证失败，请检查 server/.env 中的 DB_USER 和 DB_PASSWORD。',
    ECONNREFUSED: '未能连接 MySQL，请确认本机服务已启动及 DB_HOST、DB_PORT 正确。',
    ER_BAD_DB_ERROR: '项目数据库尚未创建，请先执行 npm run db:init。',
    ER_NO_SUCH_TABLE: '数据库表尚未完整创建，请先执行 npm run db:init。',
    ER_DBACCESS_DENIED_ERROR: '当前数据库账号没有所需权限，请使用有项目数据库权限的账号。',
  };
  console.error(error.code === 'SETUP_ERROR' ? error.message : (hints[error.code] || `操作未完成（${error.code || 'UNKNOWN'}），未输出数据库连接信息。`));
  process.exitCode = 1;
}
