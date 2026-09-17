import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokenService } from '../src/utils/token.js';
import { saveEquipmentImage, MAX_IMAGE_BYTES } from '../src/modules/admin/equipments/image-upload.js';
import { createAdminEquipmentService } from '../src/modules/admin/equipments/equipment.service.js';

test('image upload validates contents, re-encodes, deduplicates and preserves saved files across app restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'armory-upload-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#33aabb' } }).png().toBuffer();
  const first = await saveEquipmentImage(input, 'image/png', directory);
  assert.match(first.image, /^\/api\/uploads\/equipments\/[a-f0-9]{64}\.webp$/);
  assert.deepEqual(await saveEquipmentImage(input, 'image/png', directory), first);
  const names = await readdir(directory);
  assert.equal(names.length, 1);
  const stored = await readFile(join(directory, names[0]));
  const metadata = await sharp(stored).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 2048);
  for (const [bytes, type] of [[Buffer.from('<svg/>'), 'image/png'], [input, 'image/jpeg'], [input, 'image/svg+xml'], [input.subarray(0, 40), 'image/png'], [Buffer.alloc(0), 'image/png']]) {
    await assert.rejects(saveEquipmentImage(bytes, type, directory), { status: 422 });
  }
  await assert.rejects(saveEquipmentImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png', directory), { status: 413 });
  const oversized = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: 'white' } }).png().toBuffer();
  await assert.rejects(saveEquipmentImage(oversized, 'image/png', directory), { status: 422 });
  assert.deepEqual(await readdir(directory), names);

  const tokens = createTokenService({ secret: 'test-image-upload-secret-'.repeat(3), expiresIn: '2h' });
  const account = { id: 1, username: 'admin', role: 'admin', status: 'active' };
  const authService = createAuthService({ tokens, runWithConnection: async callback => callback({ execute: async () => [[account]] }) });
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
  async function start() {
    server = createApp({ authService, uploadDirectory: directory, logger: () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  let base = await start();
  const post = (headers = {}, body = input) => fetch(`${base}/api/admin/equipment-images`, { method: 'POST', headers: { 'Content-Type': 'image/png', ...headers }, body });
  assert.equal((await post()).status, 401);
  const headers = { Authorization: `Bearer ${tokens.sign(1)}` };
  account.role = 'user'; assert.equal((await post(headers)).status, 403);
  account.role = 'admin'; account.status = 'frozen'; assert.equal((await post(headers)).status, 403);
  account.status = 'active';
  const response = await post(headers);
  assert.equal(response.status, 201); assert.deepEqual((await response.json()).data, first);
  assert.equal((await post(headers, Buffer.alloc(MAX_IMAGE_BYTES + 1))).status, 413);
  assert.equal((await post(headers, Buffer.from('not an image'))).status, 422);
  await new Promise(resolve => server.close(resolve)); server = null;
  base = await start();
  const image = await fetch(base + first.image);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), stored);
  for (const path of ['/api/uploads/equipments/secret.svg', '/api/uploads/equipments/' + '0'.repeat(64) + '.webp', '/api/uploads/equipments/%2e%2e%2f.env']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});

test('equipment save refuses a nonexistent uploaded image before accessing the database', async () => {
  const service = createAdminEquipmentService({ runWithConnection: () => assert.fail('must not write') });
  await assert.rejects(service.create(1, { name: '测试', price: 100, rarity: 'R', category: 'weapon', stock: 1, image: '/api/uploads/equipments/' + '0'.repeat(64) + '.webp' }), { status: 422 });
});
