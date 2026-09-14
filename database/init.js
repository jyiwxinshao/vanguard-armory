import { createConnection } from '../server/src/config/database.js';
import { env } from '../server/src/config/env.js';
import { applySchema, reportScriptError, tableCounts } from './helpers.js';

let connection;
try {
  connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  // DB_NAME is validated before constructing this identifier.
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.changeUser({ database: env.db.database });
  await connection.query("SET time_zone = '+00:00'");
  await applySchema(connection);
  console.log(`数据库 ${env.db.database} 的六张表已就绪；已有表和数据未被覆盖。`);
  console.log(JSON.stringify(await tableCounts(connection)));
} catch (error) {
  reportScriptError(error);
} finally {
  await connection?.end();
}
