import { createConnection } from '../server/src/config/database.js';
import { env } from '../server/src/config/env.js';
import { applySchema, reportScriptError } from './helpers.js';

let connection;
try {
  connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.changeUser({ database: env.db.database });
  await connection.query("SET time_zone = '+00:00'");
  await applySchema(connection);
  console.log('数据库结构已是最新');
} catch (error) {
  reportScriptError(error);
} finally {
  await connection?.end();
}
