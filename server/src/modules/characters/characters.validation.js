import { catalogMeta } from '../../config/catalog.js';
import { validationError } from '../../utils/errors.js';

export function parseCharacterAssignment(server, body) {
  if (!catalogMeta.servers.some((item) => item.value === server)) throw validationError('server', '请选择有效的游戏服务器');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validationError('body', '角色资料格式无效');
  for (const key of Object.keys(body)) if (!['character_name', 'expected_name'].includes(key)) throw validationError(key, '不支持此字段');
  const name = typeof body.character_name === 'string' ? body.character_name.trim() : '';
  const validName = (value) => typeof value === 'string' && [...value].length >= 2 && [...value].length <= 10 && !/[\u0000-\u001f\u007f]/u.test(value);
  if (!validName(name)) throw validationError('character_name', '角色名应为 2–10 个字符，不能含控制字符');
  if (body.expected_name !== null && !validName(body.expected_name)) throw validationError('expected_name', '请重新加载角色资料后保存');
  return { server, name, expectedName: body.expected_name };
}
