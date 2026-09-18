import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  backupDirectoryFor, buildManifest, commandAvailable, copyDirectoryContents,
  dbConfigFromEnv, dbEnv, envFile, mysqldumpArgs, parseEnv, uploadDirectory,
} from './backup-core.js';

function runMysqldump(db, sqlPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('mysqldump', mysqldumpArgs(db, sqlPath), {
      env: { ...process.env, ...dbEnv(db) },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mysqldump 失败（退出码 ${code}）`))));
  });
}

async function main() {
  if (!commandAvailable('mysqldump')) {
    console.error('未找到 mysqldump，请先安装 MySQL Client 并确保命令已加入 PATH。');
    process.exitCode = 1;
    return;
  }
  let env;
  try {
    env = { ...parseEnv(await readFile(envFile(), 'utf8')), ...process.env };
  } catch {
    console.error('未找到 server/.env，请先配置数据库连接后再备份。');
    process.exitCode = 1;
    return;
  }
  const db = dbConfigFromEnv(env);
  const backupDir = backupDirectoryFor();
  const sqlPath = join(backupDir, 'database.sql');
  await mkdir(backupDir, { recursive: true });
  await runMysqldump(db, sqlPath);
  const uploadFileCount = await copyDirectoryContents(uploadDirectory(), join(backupDir, 'uploads'), undefined, { allowMissing: true });
  const manifest = buildManifest({ createdAt: new Date().toISOString(), database: db.database, uploadFileCount });
  await writeFile(join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`备份已创建：${backupDir}`);
  console.log(`数据库：${db.database}；上传图片：${uploadFileCount} 个文件`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
