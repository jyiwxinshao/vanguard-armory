import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createTokenService } from '../src/utils/token.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';

test('JWT configuration requires a secret and an unambiguous positive expiry', () => {
  const secret = randomBytes(32).toString('hex');
  for (const weakSecret of ['', 'short']) {
    assert.throws(() => createTokenService({ secret: weakSecret, expiresIn: '2h' }));
  }
  for (const expiresIn of ['0s', '-1h', 'nonsense']) {
    assert.throws(() => createTokenService({ secret, expiresIn }));
  }
  assert.equal(createTokenService({ secret, expiresIn: '2h' }).expiresInSeconds, 7200);
  assert.equal(createTokenService({ secret, expiresIn: 60 }).expiresInSeconds, 60);
});

test('signed tokens identify the user and reject expired, tampered or wrong-purpose claims', () => {
  const secret = randomBytes(32).toString('hex');
  const tokens = createTokenService({ secret, expiresIn: '2h' });
  const issued = tokens.sign(42);
  const decoded = jwt.verify(issued, secret, { algorithms: ['HS256'], issuer: 'game-store', audience: 'game-store-web' });
  assert.equal(decoded.sub, '42');
  assert.equal(decoded.exp - decoded.iat, 7200);
  assert.doesNotThrow(() => tokens.verify(issued));

  const sign = (payload, overrides = {}, key = secret) => jwt.sign(payload, key, {
    algorithm: 'HS256', issuer: 'game-store', audience: 'game-store-web', expiresIn: '2h', ...overrides,
  });
  const invalid = [
    'not-a-token',
    sign({ sub: '42' }, {}, randomBytes(32).toString('hex')),
    sign({ sub: '42' }, { expiresIn: -1 }),
    sign({ sub: '42' }, { issuer: 'another-app' }),
    sign({ sub: '42' }, { audience: 'another-client' }),
    sign({ sub: '42' }, { algorithm: 'HS384' }),
    sign({ sub: '0' }),
    sign({ sub: '42x' }),
    sign({ sub: '4294967296' }),
  ];
  for (const token of invalid) assert.throws(() => tokens.verify(token));
});

test('registration validates all fields before any database write', async () => {
  let databaseCalls = 0;
  const database = async () => { databaseCalls++; throw new Error('unexpected database call'); };
  const service = createAuthService({
    runWithConnection: database,
    runWithTransaction: database,
    tokens: createTokenService({ secret: randomBytes(32).toString('hex'), expiresIn: '2h' }),
  });
  const valid = { username: '测试玩家', email: 'player@example.test', password: 'safe-password' };
  for (const input of [
    null, [], {},
    { ...valid, username: 'a' }, { ...valid, username: 'a b' }, { ...valid, username: 'a@b' },
    { ...valid, username: '名'.repeat(21) },
    { ...valid, email: 'not-an-email' }, { ...valid, email: `${'x'.repeat(45)}@test.test` },
    { ...valid, password: 'short' }, { ...valid, password: '密'.repeat(25) },
    { ...valid, role: 'admin' }, { ...valid, status: 'active' },
  ]) {
    await assert.rejects(service.register(input), (error) => error.status === 422 && error.code === 10001);
  }
  assert.equal(databaseCalls, 0);
});
