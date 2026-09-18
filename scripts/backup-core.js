import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const repoRootPath = () => repoRoot;
export const backupsRoot = () => join(repoRoot, 'backups');
export const uploadDirectory = () => join(repoRoot, 'server', 'uploads', 'equipments');
export const envFile = () => join(repoRoot, 'server', '.env');

export function parseEnv(content) {
  return parseDotenv(String(content));
}

export function dbConfigFromEnv(env = {}) {
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: env.DB_PORT || '3306',
    database: env.DB_NAME || 'game_store',
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
  };
}

export function timestampedName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function backupDirectoryFor(date = new Date()) {
  return join(backupsRoot(), timestampedName(date));
}

export function parseRestoreArgs(args = []) {
  const list = Array.isArray(args) ? args : [];
  return {
    backupDir: list.find((arg) => !arg.startsWith('--')) || null,
    yes: list.includes('--yes'),
  };
}

export function buildManifest({ createdAt, database, uploadFileCount }) {
  return { createdAt, database, uploadFileCount, version: 1 };
}

export function validateManifest(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.createdAt === 'string' && value.createdAt
    && typeof value.database === 'string' && value.database
    && Number.isInteger(value.uploadFileCount) && value.uploadFileCount >= 0
    && value.version === 1);
}

// The database password is supplied via MYSQL_PWD rather than a visible flag.
export function dbEnv(db) {
  return { MYSQL_PWD: db.password };
}

export function mysqldumpArgs(db, sqlPath) {
  return ['--host', db.host, '--port', String(db.port), '--user', db.user, '--single-transaction', '--result-file', sqlPath, db.database];
}

export function mysqlArgs(db) {
  return ['--host', db.host, '--port', String(db.port), '--user', db.user, '--database', db.database];
}

export function commandAvailable(command, spawnSyncImpl = spawnSync) {
  try {
    const result = spawnSyncImpl(command, ['--version'], { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

// Only backup creation may treat a never-created upload directory as empty.
// Restore and nested directories must always exist.
export async function copyDirectoryContents(source, destination, fsImpl = fs, { allowMissing = false } = {}) {
  let entries;
  try {
    entries = await fsImpl.readdir(source, { withFileTypes: true });
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') {
      await fsImpl.mkdir(destination, { recursive: true });
      return 0;
    }
    throw error;
  }
  await fsImpl.mkdir(destination, { recursive: true });
  let count = 0;
  for (const entry of entries) {
    const src = join(source, entry.name);
    const dest = join(destination, entry.name);
    if (entry.isDirectory()) count += await copyDirectoryContents(src, dest, fsImpl);
    else if (entry.isFile()) {
      await fsImpl.copyFile(src, dest);
      count += 1;
    } else throw new Error(`图片目录包含不支持的文件类型：${src}`);
  }
  return count;
}

async function requireReadableFile(path, fsImpl, { nonEmpty = false } = {}) {
  const info = await fsImpl.lstat(path);
  if (!info.isFile() || (nonEmpty && info.size === 0)) throw new Error(`文件必须是${nonEmpty ? '非空的' : ''}普通文件：${path}`);
  const handle = await fsImpl.open(path, 'r');
  await handle.close();
}

async function countReadableFiles(directory, fsImpl) {
  const info = await fsImpl.lstat(directory);
  if (!info.isDirectory()) throw new Error(`图片路径不是普通目录：${directory}`);
  let count = 0;
  for (const entry of await fsImpl.readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await countReadableFiles(path, fsImpl);
    else { await requireReadableFile(path, fsImpl); count += 1; }
  }
  return count;
}

export async function validateBackupDirectory(backupDir, fsImpl = fs) {
  if (!backupDir || typeof backupDir !== 'string') throw new Error('请指定备份目录');
  let rootStat;
  try { rootStat = await fsImpl.lstat(backupDir); } catch { throw new Error('备份目录不存在'); }
  if (!rootStat.isDirectory()) throw new Error('备份目录无效');
  const sqlPath = join(backupDir, 'database.sql');
  try { await requireReadableFile(sqlPath, fsImpl, { nonEmpty: true }); }
  catch (error) { throw new Error('备份 database.sql 缺失、为空或不可读取，无法恢复', { cause: error }); }
  let manifest;
  try { manifest = JSON.parse(await fsImpl.readFile(join(backupDir, 'manifest.json'), 'utf8')); }
  catch { throw new Error('备份缺少有效的 manifest.json，无法恢复'); }
  if (!validateManifest(manifest)) throw new Error('备份 manifest.json 无效');
  const uploadsPath = join(backupDir, 'uploads');
  let count;
  try { count = await countReadableFiles(uploadsPath, fsImpl); }
  catch (error) { throw new Error('备份 uploads 目录缺失、包含不支持的文件或不可读取，无法恢复', { cause: error }); }
  if (count !== manifest.uploadFileCount) throw new Error(`备份图片数量不一致：清单 ${manifest.uploadFileCount} 个，实际 ${count} 个，无法恢复`);
  return { sqlPath, manifest, uploadsPath };
}

// Finish copying beside the destination before touching live files. Renames
// then happen on the same filesystem; a failed install restores the old tree.
export async function prepareDirectoryReplacement(source, target, fsImpl = fs) {
  const parent = dirname(target);
  await fsImpl.mkdir(parent, { recursive: true });
  const staged = await fsImpl.mkdtemp(join(parent, `.${basename(target)}.restore-`));
  const backupOld = `${staged}.previous`;
  const dispose = () => fsImpl.rm(staged, { recursive: true, force: true });
  let fileCount;
  try {
    fileCount = await copyDirectoryContents(source, staged, fsImpl);
  } catch (error) { await dispose(); throw error; }

  async function commit() {
    let movedOld = false;
    try {
      await fsImpl.rename(target, backupOld);
      movedOld = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try { await fsImpl.rename(staged, target); }
    catch (error) {
      if (movedOld) {
        try { await fsImpl.rename(backupOld, target); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], `图片替换失败，旧图片保留在 ${backupOld}`); }
      }
      throw error;
    }
    if (movedOld) {
      try { await fsImpl.rm(backupOld, { recursive: true, force: true }); }
      catch { console.warn(`图片已恢复，旧目录清理失败，请稍后清理：${backupOld}`); }
    }
  }
  return { fileCount, commit, dispose };
}

export async function replaceDirectory(source, target, fsImpl = fs) {
  const staged = await prepareDirectoryReplacement(source, target, fsImpl);
  try { await staged.commit(); } finally { await staged.dispose(); }
}

export async function restoreBackupDirectory(backupDir, target, restoreDatabase, fsImpl = fs) {
  const validated = await validateBackupDirectory(backupDir, fsImpl);
  const staged = await prepareDirectoryReplacement(validated.uploadsPath, target, fsImpl);
  try {
    if (staged.fileCount !== validated.manifest.uploadFileCount) throw new Error('备份图片在校验后发生变化，已停止恢复');
    await restoreDatabase(validated.sqlPath);
    await staged.commit();
  } finally { await staged.dispose(); }
}
