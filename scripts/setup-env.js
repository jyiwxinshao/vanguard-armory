import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const directory = new URL('../server/', import.meta.url);
const example = await readFile(new URL('.env.example', directory), 'utf8');
const local = example
  .replace('SEED_ADMIN_PASSWORD=', `SEED_ADMIN_PASSWORD=${randomBytes(18).toString('hex')}`)
  .replace('SEED_USER_PASSWORD=', `SEED_USER_PASSWORD=${randomBytes(18).toString('hex')}`)
  .replace('JWT_SECRET=', `JWT_SECRET=${randomBytes(32).toString('hex')}`);

try {
  await writeFile(new URL('.env', directory), local, { flag: 'wx', mode: 0o600 });
  console.log('已生成 server/.env 和本地演示密码。请填写 DB_PASSWORD；敏感值未输出到终端。');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('server/.env 已存在，保留全部现有配置。');
}
