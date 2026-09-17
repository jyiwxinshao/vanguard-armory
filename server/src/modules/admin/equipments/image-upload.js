import express from 'express';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AppError, success, validationError } from '../../../utils/errors.js';

export const equipmentUploadDirectory = fileURLToPath(new URL('../../../../uploads/equipments/', import.meta.url));
export const uploadPrefix = '/api/uploads/equipments/';
export const uploadedImagePattern = /^\/api\/uploads\/equipments\/[a-f0-9]{64}\.webp$/;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };

export async function assertUploadedImageExists(image) {
  if (!uploadedImagePattern.test(image)) return;
  try { await access(join(equipmentUploadDirectory, image.slice(uploadPrefix.length))); }
  catch (error) {
    if (error.code === 'ENOENT') throw validationError('image', '上传图片不存在，请重新上传');
    throw error;
  }
}

export async function saveEquipmentImage(body, type, directory = equipmentUploadDirectory) {
  if (!formats[type] || !Buffer.isBuffer(body) || !body.length) throw validationError('image', '请选择 JPG、PNG 或 WebP 图片');
  if (body.length > MAX_IMAGE_BYTES) throw new AppError(413, 10001, '图片不能超过 5 MB');
  let output;
  try {
    const decoder = sharp(body, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const meta = await decoder.metadata();
    if (meta.format !== formats[type] || (meta.pages || 1) > 1) throw new Error('Unsupported image');
    // Decode and re-encode: discard metadata and reject disguised or corrupt files.
    output = await decoder.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  } catch { throw validationError('image', '图片无法读取，请使用不超过 1600 万像素的静态 JPG、PNG 或 WebP'); }
  const name = `${createHash('sha256').update(output).digest('hex')}.webp`;
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, output, { flag: 'wx' });
    await rename(temporary, join(directory, name));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { image: `${uploadPrefix}${name}` };
}

// Mounted only after admin authentication. The request body is the file itself.
export function createImageUploadRouter({ directory = equipmentUploadDirectory } = {}) {
  const router = express.Router();
  router.post('/', express.raw({ type: () => true, limit: MAX_IMAGE_BYTES, inflate: false }), async (req, res) => {
    const type = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return success(res, await saveEquipmentImage(req.body, type, directory), 201);
  });
  router.use((error, _req, _res, next) => {
    if (error.type === 'entity.too.large') return next(new AppError(413, 10001, '图片不能超过 5 MB'));
    if (error.type === 'encoding.unsupported') return next(validationError('image', '不支持压缩请求，请直接上传图片'));
    next(error);
  });
  return router;
}

export function serveEquipmentImage(directory = equipmentUploadDirectory) {
  return (req, res, next) => {
    if (!/^[a-f0-9]{64}\.webp$/.test(req.params.filename)) return next(new AppError(404, 10004, '图片不存在'));
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(req.params.filename, { root: directory, maxAge: '1y', immutable: true }, error => {
      if (!error) return;
      if (error.status === 404 || error.code === 'ENOENT') return next(new AppError(404, 10004, '图片不存在'));
      next(error);
    });
  };
}
