import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupDirectoryFor, buildManifest, commandAvailable, copyDirectoryContents, dbConfigFromEnv, dbEnv,
  mysqlArgs, mysqldumpArgs, parseEnv, parseRestoreArgs, replaceDirectory, restoreBackupDirectory, timestampedName, validateBackupDirectory, validateManifest,
} from '../../scripts/backup-core.js';

test('backup path generation is readable and independent per second', () => {
  const name = timestampedName(new Date(2026, 8, 18, 9, 15, 0));
  assert.match(name, /^2026-09-18_091500$/);
  assert.match(backupDirectoryFor(new Date(2026, 8, 18, 9, 15, 0)), /backups\/2026-09-18_091500$/);
});

test('env parsing and database config come from environment values', () => {
  const env = parseEnv('# comment\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=game_store\nDB_USER=root\nDB_PASSWORD=secret\n');
  assert.deepEqual(dbConfigFromEnv(env), { host: '127.0.0.1', port: '3306', database: 'game_store', user: 'root', password: 'secret' });
  assert.equal(parseEnv('DB_PASSWORD=has = sign').DB_PASSWORD, 'has = sign');
});

test('backup and restore understand quoted values and comments like the application', () => {
  const env = parseEnv('\uFEFF# fixture\r\nDB_HOST="127.0.0.1" # local\r\nDB_PORT=3306 # mysql\r\nDB_NAME=game_store # development\r\nDB_USER=\'demo\'\r\nDB_PASSWORD="  sample#with=sign  " # keep spaces inside quotes\r\n');
  assert.deepEqual(dbConfigFromEnv(env), { host: '127.0.0.1', port: '3306', database: 'game_store', user: 'demo', password: '  sample#with=sign  ' });
  assert.equal(parseEnv('export DB_PASSWORD=\'another#sample\'').DB_PASSWORD, 'another#sample');
  assert.equal(dbConfigFromEnv({ ...env, DB_PASSWORD: 'environment override' }).password, 'environment override');
});

test('restore args resolve a backup directory and the --yes flag', () => {
  assert.deepEqual(parseRestoreArgs(['backups/2026-09-18_091500', '--yes']), { backupDir: 'backups/2026-09-18_091500', yes: true });
  assert.deepEqual(parseRestoreArgs(['backups/2026-09-18_091500']), { backupDir: 'backups/2026-09-18_091500', yes: false });
  assert.deepEqual(parseRestoreArgs([]), { backupDir: null, yes: false });
});

test('manifest is built and validated without storing secrets', () => {
  const manifest = buildManifest({ createdAt: '2026-09-18T09:15:00.000Z', database: 'game_store', uploadFileCount: 3 });
  assert.deepEqual(manifest, { createdAt: '2026-09-18T09:15:00.000Z', database: 'game_store', uploadFileCount: 3, version: 1 });
  assert.equal(validateManifest(manifest), true);
  for (const bad of [null, {}, { ...manifest, uploadFileCount: -1 }, { ...manifest, version: 2 }, { ...manifest, database: '' }]) assert.equal(validateManifest(bad), false);
});

test('database commands never put the password into argv', () => {
  const db = { host: '127.0.0.1', port: '3306', user: 'root', password: 'super-secret', database: 'game_store' };
  const dump = mysqldumpArgs(db, '/tmp/database.sql');
  const restore = mysqlArgs(db);
  assert.ok(!dump.includes(db.password) && !restore.includes(db.password));
  assert.ok(dump.includes('--result-file') && dump.includes('/tmp/database.sql'));
  assert.ok(restore.includes('game_store'));
  assert.deepEqual(dbEnv(db), { MYSQL_PWD: 'super-secret' });
});

test('command availability reports a friendly missing-tool result', () => {
  assert.equal(commandAvailable('mysqldump', () => ({ error: null, status: 0 })), true);
  assert.equal(commandAvailable('mysqldump', () => ({ error: { code: 'ENOENT' }, status: null })), false);
  assert.equal(commandAvailable('mysqldump', () => ({ error: null, status: 1 })), false);
  assert.equal(commandAvailable('mysqldump', () => { throw new Error('boom'); }), false);
});

test('uploads copy recursively and permit a missing root only for backup creation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'armory-backup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'uploads');
  const dest = join(root, 'copy');
  await assert.rejects(copyDirectoryContents(source, dest), { code: 'ENOENT' });
  assert.equal(await copyDirectoryContents(source, dest, undefined, { allowMissing: true }), 0);
  assert.ok((await stat(dest)).isDirectory());

  await mkdir(join(source, 'nested'), { recursive: true });
  await writeFile(join(source, 'a.webp'), 'a');
  await writeFile(join(source, 'nested', 'b.webp'), 'b');
  assert.equal(await copyDirectoryContents(source, dest), 2);
  assert.deepEqual((await readdir(join(dest, 'nested'))).sort(), ['b.webp']);
});

test('backup directory validation requires a database dump and a valid manifest', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'armory-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(validateBackupDirectory(join(root, 'missing')), /不存在/);

  const backup = join(root, 'backup');
  await mkdir(backup, { recursive: true });
  await writeFile(join(backup, 'database.sql'), 'sql');
  await assert.rejects(validateBackupDirectory(backup), /manifest/);

  await writeFile(join(backup, 'manifest.json'), JSON.stringify({ createdAt: 'x', database: 'game_store', uploadFileCount: 0, version: 1 }));
  await assert.rejects(validateBackupDirectory(backup), /uploads/);
  await mkdir(join(backup, 'uploads'));
  const result = await validateBackupDirectory(backup);
  assert.equal(result.sqlPath, join(backup, 'database.sql'));
});

test('directory replacement swaps complete contents', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'armory-swap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'equipments');
  const source = join(root, 'new');
  await mkdir(target, { recursive: true });
  await mkdir(source, { recursive: true });
  await writeFile(join(target, 'old.webp'), 'old');
  await writeFile(join(source, 'new.webp'), 'new');
  await replaceDirectory(source, target);
  assert.deepEqual(await readdir(target), ['new.webp']);
  assert.deepEqual((await readdir(root)).sort(), ['equipments', 'new']);
});

async function restoreFixture(t, count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'armory-restore-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const backup = join(root, 'backup');
  const uploads = join(backup, 'uploads');
  const target = join(root, 'equipments');
  await mkdir(uploads, { recursive: true });
  await mkdir(target);
  await writeFile(join(target, 'old.webp'), 'existing image');
  await writeFile(join(backup, 'database.sql'), 'SELECT 1;');
  await writeFile(join(backup, 'manifest.json'), JSON.stringify(buildManifest({ createdAt: '2026-09-18', database: 'fixture_only', uploadFileCount: count })));
  for (let index = 0; index < count; index++) await writeFile(join(uploads, `${index}.webp`), `backup image ${index}`);
  return { root, backup, uploads, target };
}

const invalidBackups = {
  'missing uploads': async ({ uploads }) => rm(uploads, { recursive: true }),
  'missing image': async ({ uploads }) => rm(join(uploads, '0.webp')),
  'extra image': async ({ uploads }) => writeFile(join(uploads, 'extra.webp'), 'unexpected'),
  'uploads is a file': async ({ uploads }) => { await rm(uploads, { recursive: true }); await writeFile(uploads, 'invalid'); },
  'empty SQL': async ({ backup }) => writeFile(join(backup, 'database.sql'), ''),
  'missing SQL': async ({ backup }) => rm(join(backup, 'database.sql')),
  'SQL is a directory': async ({ backup }) => { const sql = join(backup, 'database.sql'); await rm(sql); await mkdir(sql); },
  'linked image': async ({ uploads, target }) => { await rm(join(uploads, '0.webp')); await fs.symlink(join(target, 'old.webp'), join(uploads, '0.webp')); },
};

for (const [name, damage] of Object.entries(invalidBackups)) {
  test(`restore rejects ${name} before database import and leaves existing images intact`, async (t) => {
    const fixture = await restoreFixture(t);
    await damage(fixture);
    let imports = 0;
    await assert.rejects(restoreBackupDirectory(fixture.backup, fixture.target, async () => { imports++; }));
    assert.equal(imports, 0);
    assert.equal(await fs.readFile(join(fixture.target, 'old.webp'), 'utf8'), 'existing image');
    assert.deepEqual((await readdir(fixture.root)).sort(), ['backup', 'equipments']);
  });
}

test('an unreadable image or SQL file blocks restore before any database import', async (t) => {
  const fixture = await restoreFixture(t);
  for (const blocked of [join(fixture.uploads, '0.webp'), join(fixture.backup, 'database.sql')]) {
    let imports = 0;
    const fsImpl = { ...fs, open: async (path, ...args) => {
      if (path === blocked) throw Object.assign(new Error('fixture permission denied'), { code: 'EACCES' });
      return fs.open(path, ...args);
    } };
    await assert.rejects(restoreBackupDirectory(fixture.backup, fixture.target, async () => { imports++; }, fsImpl), /不可读取/);
    assert.equal(imports, 0);
    assert.deepEqual(await readdir(fixture.target), ['old.webp']);
  }
});

test('an empty but complete upload backup is restored intentionally', async (t) => {
  const fixture = await restoreFixture(t, 0);
  let imports = 0;
  await restoreBackupDirectory(fixture.backup, fixture.target, async () => { imports++; });
  assert.equal(imports, 1);
  assert.deepEqual(await readdir(fixture.target), []);
});

test('all images are staged before database import and installed only on success', async (t) => {
  const fixture = await restoreFixture(t, 2);
  let imports = 0;
  await restoreBackupDirectory(fixture.backup, fixture.target, async (sql) => {
    imports++;
    assert.equal(sql, join(fixture.backup, 'database.sql'));
    assert.deepEqual(await readdir(fixture.target), ['old.webp']);
    const staging = (await readdir(fixture.root)).find((name) => name.startsWith('.equipments.restore-'));
    assert.deepEqual((await readdir(join(fixture.root, staging))).sort(), ['0.webp', '1.webp']);
  });
  assert.equal(imports, 1);
  assert.deepEqual((await readdir(fixture.target)).sort(), ['0.webp', '1.webp']);
  assert.deepEqual((await readdir(fixture.root)).sort(), ['backup', 'equipments']);
});

test('partial image copy failure preserves live images and does not import SQL', async (t) => {
  const fixture = await restoreFixture(t, 2);
  let copied = 0;
  const fsImpl = { ...fs, copyFile: async (...args) => {
    if (++copied === 2) throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
    return fs.copyFile(...args);
  } };
  let imports = 0;
  await assert.rejects(restoreBackupDirectory(fixture.backup, fixture.target, async () => { imports++; }, fsImpl), /disk full/);
  assert.equal(imports, 0);
  assert.deepEqual(await readdir(fixture.target), ['old.webp']);
  assert.deepEqual((await readdir(fixture.root)).sort(), ['backup', 'equipments']);
});

test('failed database import keeps live images and removes staging files', async (t) => {
  const fixture = await restoreFixture(t);
  await assert.rejects(restoreBackupDirectory(fixture.backup, fixture.target, async () => { throw new Error('fixture SQL failure'); }), /SQL failure/);
  assert.deepEqual(await readdir(fixture.target), ['old.webp']);
  assert.deepEqual((await readdir(fixture.root)).sort(), ['backup', 'equipments']);
});

test('failed image install rolls the original directory back', async (t) => {
  const fixture = await restoreFixture(t);
  const fsImpl = { ...fs, rename: async (source, destination) => {
    if (destination === fixture.target && !source.endsWith('.previous')) throw new Error('fixture rename failure');
    return fs.rename(source, destination);
  } };
  await assert.rejects(replaceDirectory(fixture.uploads, fixture.target, fsImpl), /rename failure/);
  assert.equal(await fs.readFile(join(fixture.target, 'old.webp'), 'utf8'), 'existing image');
  assert.deepEqual((await readdir(fixture.root)).sort(), ['backup', 'equipments']);
});

test('a missing source cannot clear images even when calling replacement directly', async (t) => {
  const fixture = await restoreFixture(t);
  await assert.rejects(replaceDirectory(join(fixture.backup, 'missing'), fixture.target), { code: 'ENOENT' });
  assert.deepEqual(await readdir(fixture.target), ['old.webp']);
});
