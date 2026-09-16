import { createConnection } from '../server/src/config/database.js';
import { seedDatabase } from './seed-service.js';
import { reportScriptError } from './helpers.js';

let connection;
try {
  connection = await createConnection();
  const result = await seedDatabase(connection, {
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    userPassword: process.env.SEED_USER_PASSWORD,
  });
  console.log(result.seeded ? `已创建 ${result.counts.equipments} 件装备、1 个管理员和 2 个普通用户。演示密码请查看本地 server/.env。` : '检测到已有业务数据，跳过全部种子写入；保留现有库存、用户状态和密码。');
  console.log(JSON.stringify(result.counts));
} catch (error) {
  reportScriptError(error);
} finally {
  await connection?.end();
}
