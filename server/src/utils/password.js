import bcrypt from 'bcrypt';

export function validatePassword(password, variableName = 'password') {
  if (typeof password !== 'string' || [...password].length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error(`${variableName} 需要至少 8 个字符，UTF-8 编码最多 72 字节`);
  }
}

export async function hashPassword(password) {
  validatePassword(password);
  return bcrypt.hash(password, 10);
}

export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
export const passwordRounds = (hash) => bcrypt.getRounds(hash);
