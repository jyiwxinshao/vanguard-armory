import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import {
  commandAvailable, dbConfigFromEnv, dbEnv, envFile, mysqlArgs, parseEnv, parseRestoreArgs,
  restoreBackupDirectory, uploadDirectory, validateBackupDirectory,
} from './backup-core.js';

function askConfirmation(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

function runMysql(db, sqlPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('mysql', mysqlArgs(db), {
      env: { ...process.env, ...dbEnv(db) },
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mysql 恢复失败（退出码 ${code}）`))));
    pipeline(createReadStream(sqlPath), child.stdin).catch((error) => { child.kill(); reject(error); });
  });
}

async function main() {
  const { backupDir, yes } = parseRestoreArgs(process.argv.slice(2));
  if (!backupDir) {
    console.error('请指定备份目录，例如：npm run restore -- backups/2026-09-18_091500');
    process.exitCode = 1;
    return;
  }
  const validated = await validateBackupDirectory(backupDir);
  if (!commandAvailable('mysql')) {
    console.error('未找到 mysql，请先安装 MySQL Client 并确保命令已加入 PATH。');
    process.exitCode = 1;
    return;
  }
  let env;
  try {
    env = { ...parseEnv(await readFile(envFile(), 'utf8')), ...process.env };
  } catch {
    console.error('未找到 server/.env，请先配置数据库连接后再恢复。');
    process.exitCode = 1;
    return;
  }
  const db = dbConfigFromEnv(env);

  console.log('即将恢复备份：');
  console.log(`  备份目录：${backupDir}`);
  console.log(`  目标数据库：${db.host}:${db.port}/${db.database}`);
  console.log(`  上传图片：${validated.manifest.uploadFileCount} 个文件`);
  console.log('此操作可能覆盖当前数据库和上传图片数据。');

  if (!yes) {
    const confirmed = await askConfirmation('输入 yes 确认恢复，其他输入将取消：');
    if (!confirmed) {
      console.log('已取消恢复。');
      return;
    }
  }

  await restoreBackupDirectory(backupDir, uploadDirectory(), (sqlPath) => runMysql(db, sqlPath));
  console.log('恢复完成。');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
