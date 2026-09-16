import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConnection } from '../src/config/database.js';
import { applySchema } from '../../database/helpers.js';
import { inspectSchema } from '../src/config/schema.js';
import { demoEquipments } from '../../database/equipments.js';

test('db:migrate upgrades an old schema to the latest version idempotently without data loss', async () => {
  const databaseName = `game_store_migration_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await connection.query("SET time_zone = '+00:00'");

    // Build a full schema first, then remove the later additions to emulate a legacy database.
    await applySchema(connection);
    await connection.query('DROP TABLE order_requests, cart_merge_receipts');
    await connection.query('ALTER TABLE equipments DROP COLUMN new_until, DROP COLUMN series_code');

    const [user] = await connection.execute(
      "INSERT INTO users (username, email, password_hash, role, status) VALUES ('old_user', 'old@example.test', ?, 'user', 'active')",
      ['x'.repeat(60)],
    );
    const [cart] = await connection.execute('INSERT INTO carts (user_id) VALUES (?)', [user.insertId]);
    const [equipment] = await connection.execute(
      "INSERT INTO equipments (name, price, rarity, category, image, attack, defense, stock, status) VALUES ('旧版装备', 100, 'R', 'weapon', '/old.png', 1, 0, 3, 'on_sale')",
    );
    await connection.execute(
      "INSERT INTO orders (order_no, user_id, total, discount, actual_total, character_name, server) VALUES ('OLD0001', ?, 100, 0, 100, '旧玩家', 'star_1')",
      [user.insertId],
    );
    await connection.execute('INSERT INTO cart_items (cart_id, equipment_id, quantity) VALUES (?, ?, 1)', [cart.insertId, equipment.insertId]);

    await applySchema(connection);

    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('cart_merge_receipts', 'order_requests')");
    assert.deepEqual(tables[0].map((row) => row.name).sort(), ['cart_merge_receipts', 'order_requests']);
    const columns = await connection.query("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'equipments' AND COLUMN_NAME IN ('new_until', 'series_code')");
    assert.deepEqual(columns[0].map((row) => row.name).sort(), ['new_until', 'series_code']);
    assert.equal((await inspectSchema(connection)).status, 'ready');

    const [[preserved]] = await connection.execute('SELECT name, stock FROM equipments WHERE name = ?', ['旧版装备']);
    assert.equal(preserved.stock, 3);
    const counts = await connection.query(
      "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM carts) AS carts, (SELECT COUNT(*) FROM equipments) AS equipments, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM cart_items) AS cart_items",
    );
    assert.deepEqual(Number(counts[0][0].users), 1);
    assert.deepEqual(Number(counts[0][0].carts), 1);
    assert.deepEqual(Number(counts[0][0].equipments), 1);
    assert.deepEqual(Number(counts[0][0].orders), 1);
    assert.deepEqual(Number(counts[0][0].cart_items), 1);

    await applySchema(connection);
    assert.equal((await inspectSchema(connection)).status, 'ready');
  } finally {
    try { if (created) await connection.query(`DROP DATABASE \`${databaseName}\``); }
    finally { await connection.end(); }
  }
});

test('legacy series backfill restores all six items and preserves edits, other items and existing classifications', async (t) => {
  const databaseName = `game_store_series_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const connection = await createConnection({ withoutDatabase: true, multipleStatements: true });
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database: databaseName });
    await connection.query("SET time_zone = '+00:00'");
    await applySchema(connection);
    await connection.query('ALTER TABLE equipments DROP COLUMN series_code');
    const series = demoEquipments.filter((item) => item.series_code === 'eclipse_relics');
    assert.equal(series.length, 6);
    const fixtures = [
      ...series,
      { ...series[0], image: '/custom/same-name.png', status: 'off_sale' },
      { ...series[1], name: '另一件同图装备', status: 'deleted' },
      { ...series[2], name: '日蚀系列仿制品', image: '/custom/unrelated.png' },
    ];
    for (const [index, item] of fixtures.entries()) {
      await connection.execute(
        `INSERT INTO equipments (name, price, rarity, category, image, attack, defense, new_until, description, stock, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.name, item.price + 123, item.rarity, item.category, item.image, item.attack + 1, item.defense + 1,
          '2026-09-30 00:00:00', '保留修改后的描述', index, item.status, '2026-01-01 00:00:00', '2026-02-01 00:00:00'],
      );
    }
    const readItems = async () => (await connection.query('SELECT * FROM equipments ORDER BY id'))[0];
    const before = await readItems();

    await t.test('adding the column also backfills only exact legacy name/image pairs', async () => {
      await applySchema(connection);
      assert.deepEqual(await readItems(), before.map((item, index) => ({
        ...item, series_code: index < 6 ? 'eclipse_relics' : null,
      })));
      const [[{ total }]] = await connection.query("SELECT COUNT(*) AS total FROM equipments WHERE series_code = 'eclipse_relics' AND status = 'on_sale'");
      assert.equal(Number(total), 6);
    });

    await t.test('an already-added column is repaired without overwriting a nonempty classification', async () => {
      await connection.execute("UPDATE equipments SET series_code = NULL WHERE id = ?", [before[0].id]);
      await connection.execute("UPDATE equipments SET series_code = '' WHERE id = ?", [before[1].id]);
      await connection.execute("UPDATE equipments SET series_code = 'custom_series', price = 9876, stock = 2, status = 'off_sale' WHERE id = ?", [before[2].id]);
      const edited = await readItems();
      await applySchema(connection);
      const expected = edited.map((item, index) => index < 2 ? { ...item, series_code: 'eclipse_relics' } : item);
      assert.deepEqual(await readItems(), expected);
      await applySchema(connection);
      assert.deepEqual(await readItems(), expected);
    });
  } finally {
    try { if (created) await connection.query(`DROP DATABASE \`${databaseName}\``); }
    finally { await connection.end(); }
  }
});
