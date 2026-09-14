import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { createConnection } from '../src/config/database.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { createTokenService } from '../src/utils/token.js';
import { passwordRounds, verifyPassword } from '../src/utils/password.js';
import { createApp } from '../src/app.js';
import { applySchema } from '../../database/helpers.js';
import { seedDatabase } from '../../database/seed-service.js';

test('authentication against an isolated real MySQL database', async (t) => {
  const databaseName = `game_store_auth_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  const secret = randomBytes(32).toString('hex');
  const credentials = { adminPassword: randomBytes(16).toString('hex'), userPassword: randomBytes(16).toString('hex') };
  let created = false;
  let pool;
  let server;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await connection.query("SET time_zone = '+00:00'");
    await applySchema(connection);
    await seedDatabase(connection, credentials);

    pool = mysql.createPool({ ...env.db, database: databaseName, connectionLimit: 5, timezone: 'Z' });
    const runWithConnection = async (run) => {
      const client = await pool.getConnection();
      try { await client.query("SET time_zone = '+00:00'"); return await run(client); }
      finally { client.release(); }
    };
    const runWithTransaction = (run) => runWithConnection(async (client) => {
      await client.beginTransaction();
      try { const value = await run(client); await client.commit(); return value; }
      catch (error) { await client.rollback(); throw error; }
    });
    const authService = createAuthService({ runWithConnection, runWithTransaction, tokens: createTokenService({ secret, expiresIn: '2h' }) });
    server = createApp({ authService, logger: () => {} }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, { method = 'GET', body, token } = {}) => {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
    };
    const newPassword = randomBytes(16).toString('hex');
    let newUser;
    let userToken;
    let adminToken;

    await t.test('registration normalizes identity and atomically creates a normal user and cart', async () => {
      const result = await request('/api/auth/register', { method: 'POST', body: { username: '  远征新玩家  ', email: '  New.Player@Example.Test  ', password: newPassword } });
      assert.equal(result.status, 201);
      assert.equal(result.cacheControl, 'no-store');
      newUser = result.body.data;
      assert.equal(newUser.username, '远征新玩家');
      assert.equal(newUser.email, 'new.player@example.test');
      assert.equal(newUser.role, 'user');
      assert.equal(newUser.status, 'active');
      assert.equal('password_hash' in newUser, false);
      const [[record]] = await connection.execute('SELECT password_hash FROM users WHERE id = ?', [newUser.id]);
      assert.equal(passwordRounds(record.password_hash), 10);
      assert.ok(await verifyPassword(newPassword, record.password_hash));
      const [[{ count }]] = await connection.execute('SELECT COUNT(*) AS count FROM carts WHERE user_id = ?', [newUser.id]);
      assert.equal(count, 1);
    });

    await t.test('duplicate and concurrent registrations do not create orphan carts or privileged users', async () => {
      const sameUsername = await request('/api/auth/register', { method: 'POST', body: { username: newUser.username, email: 'other@example.test', password: newPassword } });
      assert.equal(sameUsername.status, 422);
      assert.ok(sameUsername.body.data.errors.some((error) => error.field === 'username'));
      const sameEmail = await request('/api/auth/register', { method: 'POST', body: { username: '另一位玩家', email: newUser.email.toUpperCase(), password: newPassword } });
      assert.equal(sameEmail.status, 422);
      assert.ok(sameEmail.body.data.errors.some((error) => error.field === 'email'));
      const privileged = await request('/api/auth/register', { method: 'POST', body: { username: '尝试提权', email: 'privilege@example.test', password: newPassword, role: 'admin' } });
      assert.equal(privileged.status, 422);
      const body = { username: '并发注册', email: 'race@example.test', password: newPassword };
      const results = await Promise.all([request('/api/auth/register', { method: 'POST', body }), request('/api/auth/register', { method: 'POST', body })]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 422]);
      const [[{ users }]] = await connection.query("SELECT COUNT(*) AS users FROM users WHERE username = '并发注册'");
      const [[{ carts }]] = await connection.query("SELECT COUNT(*) AS carts FROM carts JOIN users ON users.id = carts.user_id WHERE username = '并发注册'");
      assert.equal(users, 1);
      assert.equal(carts, 1);
    });

    await t.test('a cart creation failure rolls back the newly registered user', async () => {
      await connection.query("CREATE TRIGGER test_auth_cart_failure BEFORE INSERT ON carts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'intentional failure'");
      try {
        const result = await request('/api/auth/register', { method: 'POST', body: { username: '事务回滚玩家', email: 'rollback@example.test', password: newPassword } });
        assert.equal(result.status, 500);
        const [[{ count }]] = await connection.query("SELECT COUNT(*) AS count FROM users WHERE email = 'rollback@example.test'");
        assert.equal(count, 0);
      } finally { await connection.query('DROP TRIGGER test_auth_cart_failure'); }
    });

    await t.test('username and email login return a verifiable token and no password hash', async () => {
      for (const account of [newUser.username, ' NEW.PLAYER@EXAMPLE.TEST ']) {
        const result = await request('/api/auth/login', { method: 'POST', body: { account, password: newPassword } });
        assert.equal(result.status, 200);
        assert.equal(result.cacheControl, 'no-store');
        assert.equal(result.body.data.user.id, newUser.id);
        assert.equal(result.body.data.expires_in, 7200);
        assert.equal(JSON.stringify(result.body).includes('password_hash'), false);
        userToken = result.body.data.token;
        assert.equal(jwt.verify(userToken, secret, { algorithms: ['HS256'], issuer: 'game-store', audience: 'game-store-web' }).sub, String(newUser.id));
      }
      const missing = await request('/api/auth/login', { method: 'POST', body: { account: '不存在的玩家', password: newPassword } });
      const wrong = await request('/api/auth/login', { method: 'POST', body: { account: newUser.username, password: 'wrong-password' } });
      assert.equal(missing.status, 401);
      assert.equal(wrong.status, 401);
      assert.equal(missing.body.message, wrong.body.message);
    });

    await t.test('current-user endpoints enforce expiry and ignore attempts to choose another identity', async () => {
      assert.equal((await request('/api/auth/me')).status, 401);
      const current = await request('/api/auth/me?user_id=1', { token: userToken });
      assert.equal(current.status, 200);
      assert.equal(current.body.data.id, newUser.id);
      const expired = jwt.sign({}, secret, { algorithm: 'HS256', issuer: 'game-store', audience: 'game-store-web', subject: String(newUser.id), expiresIn: -1 });
      assert.equal((await request('/api/auth/me', { token: expired })).status, 401);
      assert.equal((await request('/api/auth/me', { token: 'broken-token' })).status, 401);
      const deletedSubject = jwt.sign({}, secret, { algorithm: 'HS256', issuer: 'game-store', audience: 'game-store-web', subject: '4294967295', expiresIn: '2h' });
      assert.equal((await request('/api/auth/me', { token: deletedSubject })).status, 401);
    });

    await t.test('freezing an already logged-in account blocks its existing token and new login', async () => {
      await connection.execute("UPDATE users SET status = 'frozen' WHERE id = ?", [newUser.id]);
      const me = await request('/api/auth/me', { token: userToken });
      assert.equal(me.status, 403);
      assert.equal(me.body.code, 10006);
      const login = await request('/api/auth/login', { method: 'POST', body: { account: newUser.username, password: newPassword } });
      assert.equal(login.status, 403);
      assert.equal(login.body.code, 10006);
      await connection.execute("UPDATE users SET status = 'active' WHERE id = ?", [newUser.id]);
      assert.equal((await request('/api/auth/me', { token: userToken })).status, 200);
    });

    await t.test('admin authorization uses the current database role, not token-provided roles', async () => {
      assert.equal((await request('/api/admin/me', { token: userToken })).status, 403);
      const login = await request('/api/auth/login', { method: 'POST', body: { account: 'admin', password: credentials.adminPassword } });
      assert.equal(login.status, 200);
      adminToken = login.body.data.token;
      assert.equal((await request('/api/admin/me', { token: adminToken })).status, 200);
      const fakeRole = jwt.sign({ role: 'admin' }, secret, { algorithm: 'HS256', issuer: 'game-store', audience: 'game-store-web', subject: String(newUser.id), expiresIn: '2h' });
      assert.equal((await request('/api/admin/me', { token: fakeRole })).status, 403);
      await connection.query("UPDATE users SET role = 'user' WHERE username = 'admin'");
      assert.equal((await request('/api/admin/me', { token: adminToken })).status, 403);
      await connection.query("UPDATE users SET role = 'admin' WHERE username = 'admin'");
    });

    await t.test('logout accepts an authenticated user; further anonymous requests are denied', async () => {
      assert.equal((await request('/api/auth/logout', { method: 'POST', token: userToken })).status, 200);
      assert.equal((await request('/api/auth/me')).status, 401);
      assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 401);
      // The documented stage-two contract clears browser credentials, without server revocation.
      assert.equal((await request('/api/auth/me', { token: userToken })).status, 200);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool?.end();
    try { if (created) await connection.query(`DROP DATABASE \`${databaseName}\``); }
    finally { await connection.end(); }
  }
});
