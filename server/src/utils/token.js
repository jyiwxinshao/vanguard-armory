import jwt from 'jsonwebtoken';
import { AppError } from './errors.js';

const issuer = 'game-store';
const audience = 'game-store-web';
const maxUserId = 4294967295;

export function authenticationError() {
  return new AppError(401, 10002, '登录状态无效或已过期，请重新登录');
}

function parseExpiresIn(value) {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) return value;
  } else if (typeof value === 'string') {
    const match = /^([1-9]\d*)(s|m|h|d)?$/.exec(value);
    if (match) {
      const seconds = Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]] || 1);
      if (Number.isSafeInteger(seconds) && seconds > 0) return seconds;
    }
  }
  throw new Error('JWT_EXPIRES_IN 必须是正整数秒数，或使用 s、m、h、d 单位，例如 2h');
}

function validUserId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) <= maxUserId;
}

// Construction is explicit so tests can inject their own secret without reading local credentials.
export function createTokenService({ secret = process.env.JWT_SECRET, expiresIn = process.env.JWT_EXPIRES_IN ?? '2h' } = {}) {
  if (typeof secret !== 'string' || !secret.trim() || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET 必须配置为至少 32 字节的随机密钥，不能使用空值');
  }
  const expiresInSeconds = parseExpiresIn(expiresIn);

  return {
    expiresInSeconds,
    sign(userId) {
      const subject = String(userId);
      if (!validUserId(subject)) throw new Error('无法为无效的用户 ID 签发登录凭证');
      return jwt.sign({}, secret, { algorithm: 'HS256', issuer, audience, subject, expiresIn: expiresInSeconds });
    },
    verify(token) {
      if (typeof token !== 'string' || token.length > 8192) throw authenticationError();
      let payload;
      try {
        payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer, audience });
      } catch {
        throw authenticationError();
      }
      if (!payload || typeof payload !== 'object' || !validUserId(payload.sub)
        || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
        || payload.exp <= payload.iat) {
        throw authenticationError();
      }
      return Number(payload.sub);
    },
  };
}
