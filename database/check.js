import { createConnection } from '../server/src/config/database.js';
import { env } from '../server/src/config/env.js';
import { tableCounts, reportScriptError } from './helpers.js';

let connection;
try {
  connection = await createConnection();
  const [[{ version, timezone }]] = await connection.query('SELECT VERSION() AS version, @@session.time_zone AS timezone');
  console.log(`MySQL ${version} 连接成功，项目数据库：${env.db.database}，会话时区：${timezone}`);
  console.log(JSON.stringify(await tableCounts(connection)));
} catch (error) {
  reportScriptError(error);
} finally {
  await connection?.end();
}
