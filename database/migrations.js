async function hasTable(connection, table) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  return Number(rows[0].total) > 0;
}

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  return Number(rows[0].total) > 0;
}

export async function runMigrations(connection) {
  const applied = [];

  if (await hasTable(connection, 'equipments')) {
    if (!(await hasColumn(connection, 'equipments', 'new_until'))) {
      await connection.query('ALTER TABLE equipments ADD COLUMN new_until DATETIME NULL');
      applied.push('equipments.new_until');
    }
    if (!(await hasColumn(connection, 'equipments', 'series_code'))) {
      await connection.query('ALTER TABLE equipments ADD COLUMN series_code VARCHAR(64) NULL');
      applied.push('equipments.series_code');
    }
  }

  if (await hasTable(connection, 'orders')) {
    if (!(await hasColumn(connection, 'orders', 'character_id'))) {
      await connection.query('ALTER TABLE orders ADD COLUMN character_id INT UNSIGNED NULL');
      applied.push('orders.character_id');
    }
    const [keys] = await connection.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'character_id' AND REFERENCED_TABLE_NAME = 'game_characters'");
    if (!keys.length) await connection.query('ALTER TABLE orders ADD CONSTRAINT fk_orders_character FOREIGN KEY (character_id) REFERENCES game_characters (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
  }
  return { applied };
}

// Keep legacy identities fixed: future edits to seed data must not retarget this backfill.
const legacyEclipseEquipment = [
  ['日蚀刃', '/images/equipments/eclipse-blade.png'],
  ['赫利俄斯长枪', '/images/equipments/helios-lance.png'],
  ['曜日壁垒', '/images/equipments/solar-bulwark.png'],
  ['日冕指环', '/images/equipments/corona-ring.png'],
  ['黎明核心', '/images/equipments/dawn-core.png'],
  ['天穹圣器', '/images/equipments/celestial-relic.png'],
];

export async function backfillEquipmentSeries(connection) {
  const identities = legacyEclipseEquipment.map(() => '(name = ? AND image = ?)').join(' OR ');
  // One atomic statement; retain existing classifications and all business fields/timestamps.
  const [result] = await connection.execute(
    `UPDATE equipments SET series_code = ?, updated_at = updated_at
     WHERE (series_code IS NULL OR series_code = '') AND (${identities})`,
    ['eclipse_relics', ...legacyEclipseEquipment.flat()],
  );
  return result.affectedRows;
}
