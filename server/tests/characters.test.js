import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCharacterAssignment } from '../src/modules/characters/characters.validation.js';
import { createAdminUserService } from '../src/modules/admin/users/user.service.js';

test('character assignment validates server, Unicode name, expected state and immutable ownership', async () => {
  assert.deepEqual(parseCharacterAssignment('star_1', { character_name: ' 星海先锋 ', expected_name: null }), { server: 'star_1', name: '星海先锋', expectedName: null });
  assert.equal(parseCharacterAssignment('dusk_2', { character_name: '🗡'.repeat(10), expected_name: '旧角色' }).name, '🗡'.repeat(10));
  for (const body of [null, [], {}, { character_name: '一', expected_name: null }, { character_name: '人'.repeat(11), expected_name: null }, { character_name: '角\n色', expected_name: null }, { character_name: '角色' }, { character_name: '角色', expected_name: 1 }, { character_name: '角色', expected_name: null, user_id: 5 }, { character_name: '角色', expected_name: null, id: 5 }]) {
    assert.throws(() => parseCharacterAssignment('star_1', body), { status: 422 });
  }
  const service = createAdminUserService({ runWithConnection: () => assert.fail('invalid inputs must not reach database') });
  await assert.rejects(service.saveCharacter(1, '2', 'unknown', { character_name: '角色', expected_name: null }), { status: 422 });
  await assert.rejects(service.saveCharacter(1, '0', 'star_1', { character_name: '角色', expected_name: null }), { status: 422 });
});
