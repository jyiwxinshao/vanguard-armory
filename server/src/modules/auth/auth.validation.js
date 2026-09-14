import { validationError } from '../../utils/errors.js';
import { validatePassword } from '../../utils/password.js';

function validateBody(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('body', '请提交 JSON 对象');
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) throw validationError(key, '不允许提交此字段');
  }
}

export function parseRegistration(body) {
  validateBody(body, ['username', 'email', 'password']);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if ([...username].length < 2 || [...username].length > 20 || /[@\s]/u.test(username)) {
    throw validationError('username', '用户名须为 2–20 个字符，不能包含 @ 或空白字符');
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if ([...email].length > 50 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw validationError('email', '请填写有效邮箱，最多 50 个字符');
  }
  try {
    validatePassword(body.password);
  } catch {
    throw validationError('password', '密码至少 8 个字符，UTF-8 编码最多 72 字节');
  }
  return { username, email, password: body.password };
}

export function parseLogin(body) {
  validateBody(body, ['account', 'password']);
  const account = typeof body.account === 'string' ? body.account.trim() : '';
  if (!account || [...account].length > 50) throw validationError('account', '请填写用户名或邮箱，最多 50 个字符');
  if (typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) {
    throw validationError('password', '请填写密码，UTF-8 编码最多 72 字节');
  }
  return { account: account.includes('@') ? account.toLowerCase() : account, password: body.password };
}
