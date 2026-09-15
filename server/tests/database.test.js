import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConnection } from '../src/config/database.js';
import { verifyPassword, passwordRounds } from '../src/utils/password.js';
import { applySchema, tableCounts } from '../../database/helpers.js';
import { seedDatabase } from '../../database/seed-service.js';
import { inspectSchema } from '../src/config/schema.js';

test('real MySQL initialization, seed transactions, constraints and repeatability', async (t) => {
  const databaseName = `game_store_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false;
  const credentials = { adminPassword: randomBytes(16).toString('hex'), userPassword: randomBytes(16).toString('hex') };
  try {
    // This name is generated here, never taken from the application's DB_NAME.
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await connection.query("SET time_zone = '+00:00'");
    await applySchema(connection);

    await t.test('invalid seed passwords leave all tables empty', async () => {
      await assert.rejects(seedDatabase(connection, { ...credentials, adminPassword: '' }), { code: 'SETUP_ERROR' });
      assert.ok(Object.values(await tableCounts(connection)).every((count) => count === 0));
    });

    await t.test('a mid-seed SQL error rolls back accounts, carts and equipment together', async () => {
      await connection.query("CREATE TRIGGER test_seed_failure BEFORE INSERT ON equipments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'intentional test failure'");
      try {
        await assert.rejects(seedDatabase(connection, credentials), { code: 'ER_SIGNAL_EXCEPTION' });
        assert.ok(Object.values(await tableCounts(connection)).every((count) => count === 0));
      } finally {
        await connection.query('DROP TRIGGER test_seed_failure');
      }
    });

    await t.test('seed creates 16 items, 3 bcrypt accounts and only 2 user carts', async () => {
      const result = await seedDatabase(connection, credentials);
      assert.equal(result.seeded, true);
      assert.deepEqual(result.counts, { order_requests: 0, cart_merge_receipts: 0, users: 3, equipments: 16, carts: 2, cart_items: 0, orders: 0, order_items: 0 });
      const [users] = await connection.query('SELECT id, role, password_hash FROM users');
      for (const user of users) {
        assert.equal(passwordRounds(user.password_hash), 10);
        assert.ok(await verifyPassword(user.role === 'admin' ? credentials.adminPassword : credentials.userPassword, user.password_hash));
        const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM carts WHERE user_id = ?', [user.id]);
        assert.equal(total, user.role === 'admin' ? 0 : 1);
      }
      const [[counts]] = await connection.query("SELECT COUNT(DISTINCT rarity) AS rarities, COUNT(DISTINCT category) AS categories, SUM(stock = 0) AS sold_out, SUM(status = 'off_sale') AS off_sale FROM equipments");
      assert.equal(counts.rarities, 4);
      assert.equal(counts.categories, 4);
      assert.equal(Number(counts.sold_out), 1);
      assert.equal(Number(counts.off_sale), 1);
      const [[{ timezone }]] = await connection.query('SELECT @@session.time_zone AS timezone');
      assert.equal(timezone, '+00:00');
    });

    await t.test('unique keys, foreign keys, quantities and integer amounts reject invalid records', async () => {
      const [[user]] = await connection.query("SELECT id FROM users WHERE role = 'user' ORDER BY id LIMIT 1");
      const [[cart]] = await connection.execute('SELECT id FROM carts WHERE user_id = ?', [user.id]);
      const [[equipment]] = await connection.query('SELECT id FROM equipments ORDER BY id LIMIT 1');
      await connection.beginTransaction();
      try {
        await assert.rejects(connection.execute("INSERT INTO users (username, email, password_hash) VALUES ('player_one', 'duplicate@example.test', ?)", ['x'.repeat(60)]), { code: 'ER_DUP_ENTRY' });
        await assert.rejects(connection.execute('INSERT INTO carts (user_id) VALUES (?)', [user.id]), { code: 'ER_DUP_ENTRY' });
        await assert.rejects(connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, 0)', [cart.id, equipment.id]), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
        await assert.rejects(connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, 4294967295, 1)', [cart.id]), { code: 'ER_NO_REFERENCED_ROW_2' });
        await connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, 1)', [cart.id, equipment.id]);
        await assert.rejects(connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, 1)', [cart.id, equipment.id]), { code: 'ER_DUP_ENTRY' });
        await assert.rejects(connection.execute("INSERT INTO orders (order_no, user_id, total, discount, actual_total, character_name, server) VALUES ('bad-amount', ?, 100, 0, 99, '测试玩家', 'star_1')", [user.id]), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
        await assert.rejects(connection.execute("INSERT INTO orders (order_no, user_id, total, discount, actual_total, character_name, server) VALUES ('bad-discount', ?, 100, 200, 0, '测试玩家', 'star_1')", [user.id]), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
        const [order] = await connection.execute("INSERT INTO orders (order_no, user_id, total, discount, actual_total, character_name, server) VALUES ('valid-order', ?, 12900, 0, 12900, '测试玩家', 'star_1')", [user.id]);
        await connection.execute("INSERT INTO order_items (order_id, equipment_id, equipment_name, equipment_image, rarity, price, quantity) VALUES (?, ?, '名称快照', '/images/equipments/placeholder.svg', 'R', 12900, 1)", [order.insertId, equipment.id]);
        await assert.rejects(connection.execute('DELETE FROM equipments WHERE id = ?', [equipment.id]), { code: 'ER_ROW_IS_REFERENCED_2' });
      } finally {
        await connection.rollback();
      }
      assert.equal((await tableCounts(connection)).orders, 0);
    });

    await t.test('rerunning initialization and seed preserves edited stock, account status and hashes', async () => {
      await connection.query("UPDATE equipments SET stock = 7, name = '测试中保留的装备名称' ORDER BY id LIMIT 1");
      await connection.query("UPDATE users SET status = 'frozen' WHERE username = 'player_one'");
      const [before] = await connection.query('SELECT id, username, password_hash, status FROM users ORDER BY id');
      await applySchema(connection);
      const result = await seedDatabase(connection, { adminPassword: '', userPassword: '' });
      assert.equal(result.seeded, false);
      const [after] = await connection.query('SELECT id, username, password_hash, status FROM users ORDER BY id');
      assert.deepEqual(after, before);
      const [[equipment]] = await connection.query('SELECT name, stock FROM equipments ORDER BY id LIMIT 1');
      assert.equal(equipment.stock, 7);
      assert.equal(equipment.name, '测试中保留的装备名称');
      assert.equal(result.counts.equipments, 16);
    });

    await t.test('table names alone do not make an incompatible old schema ready', async () => {
      await connection.query('ALTER TABLE equipments DROP CHECK ck_equipments_price, DROP COLUMN price');
      const result = await inspectSchema(connection);
      assert.equal(result.status, 'schema_mismatch');
      assert.ok(result.issues.some((issue) => issue.includes('equipments.price')));
      await assert.rejects(applySchema(connection), { code: 'SETUP_ERROR' });
    });
  } finally {
    if (created) await connection.query(`DROP DATABASE \`${databaseName}\``);
    await connection.end();
  }
});
