const columns = {
  game_characters: 'id user_id server character_name created_at',
  inventory_adjustments: 'request_id actor_id equipment_id delta stock_before stock_after outcome rejection_reason created_at',
  order_requests: 'request_id user_id payload_hash order_id created_at',
  cart_merge_receipts: 'merge_id user_id payload_hash adjustments created_at',
  users: 'id username email password_hash avatar role status created_at updated_at',
  equipments: 'id name price rarity category image attack defense new_until series_code description stock status created_at updated_at',
  carts: 'id user_id updated_at',
  cart_items: 'id cart_id equipment_id quantity created_at updated_at',
  orders: 'id order_no user_id total discount actual_total character_id character_name server remark status payment_time cancelled_at completed_at created_at updated_at',
  order_items: 'id order_id equipment_id equipment_name equipment_image rarity price quantity',
};
export const requiredTables = Object.keys(columns);
const uniqueKeys = {
  game_characters: ['id', 'user_id,server'],
  inventory_adjustments: ['request_id'],
  order_requests: ['request_id', 'order_id'],
  cart_merge_receipts: ['merge_id'],
  users: ['id', 'username', 'email'], equipments: ['id'], carts: ['id', 'user_id'],
  cart_items: ['id', 'cart_id,equipment_id'], orders: ['id', 'order_no'], order_items: ['id', 'order_id,equipment_id'],
};
const foreignKeys = [
  'game_characters.user_id:users.id', 'orders.character_id:game_characters.id',
  'inventory_adjustments.actor_id:users.id', 'inventory_adjustments.equipment_id:equipments.id',
  'order_requests.user_id:users.id', 'order_requests.order_id:orders.id',
  'cart_merge_receipts.user_id:users.id',
  'carts.user_id:users.id', 'cart_items.cart_id:carts.id', 'cart_items.equipment_id:equipments.id',
  'orders.user_id:users.id', 'order_items.order_id:orders.id', 'order_items.equipment_id:equipments.id',
];
const checks = [
  'ck_inventory_delta', 'ck_game_characters_name',
  'ck_users_username_length', 'ck_equipments_price', 'ck_cart_items_quantity',
  'ck_orders_amount', 'ck_orders_character', 'ck_order_items_price', 'ck_order_items_quantity',
];
const unsignedColumns = new Set(['price', 'stock', 'stock_before', 'stock_after', 'attack', 'defense', 'quantity', 'total', 'discount', 'actual_total']);

export async function inspectSchema(connection) {
  const [tables] = await connection.query('SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const tableMap = new Map(tables.map((table) => [table.name, table.engine]));
  const missing = requiredTables.filter((table) => !tableMap.has(table));
  if (missing.length) return { status: 'not_initialized', issues: missing.map((name) => `缺少表 ${name}`) };
  const issues = [];
  for (const table of requiredTables) if (tableMap.get(table) !== 'InnoDB') issues.push(`${table} 需要 InnoDB`);
  const [fields] = await connection.query('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
  const fieldMap = new Map(fields.map((field) => [`${field.table_name}.${field.name}`, field]));
  const delta = fieldMap.get('inventory_adjustments.delta');
  if (delta && (delta.data_type !== 'bigint' || delta.column_type.includes('unsigned'))) issues.push('inventory_adjustments.delta 需要 BIGINT 有符号整数');
  for (const [table, names] of Object.entries(columns)) {
    for (const name of names.split(' ')) {
      const field = fieldMap.get(`${table}.${name}`);
      if (!field) issues.push(`缺少字段 ${table}.${name}`);
      else if ((!['merge_id', 'request_id'].includes(name) && (name === 'id' || name.endsWith('_id') || unsignedColumns.has(name))) && (field.data_type !== 'int' || !field.column_type.includes('unsigned'))) issues.push(`${table}.${name} 需要 INT UNSIGNED`);
    }
  }
  const [indexes] = await connection.query('SELECT TABLE_NAME AS table_name, INDEX_NAME AS name, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX');
  const grouped = new Map();
  for (const index of indexes) {
    const key = `${index.table_name}.${index.name}`;
    if (!grouped.has(key)) grouped.set(key, { table: index.table_name, names: [] });
    grouped.get(key).names.push(index.column_name);
  }
  const uniqueSignatures = new Set([...grouped.values()].map((index) => `${index.table}:${index.names.join(',')}`));
  for (const [table, keys] of Object.entries(uniqueKeys)) {
    for (const key of keys) if (!uniqueSignatures.has(`${table}:${key}`)) issues.push(`缺少唯一约束 ${table}(${key})`);
  }
  const [references] = await connection.query(`SELECT k.TABLE_NAME AS table_name, k.COLUMN_NAME AS column_name,
    k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column, r.DELETE_RULE AS delete_rule
    FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
    ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
  const referenceSignatures = new Set(references.filter((ref) => ['RESTRICT', 'NO ACTION'].includes(ref.delete_rule)).map((ref) => `${ref.table_name}.${ref.column_name}:${ref.ref_table}.${ref.ref_column}`));
  for (const key of foreignKeys) if (!referenceSignatures.has(key)) issues.push(`缺少限制删除的外键 ${key}`);
  const [constraints] = await connection.query("SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES'");
  const enforcedChecks = new Set(constraints.map((constraint) => constraint.name));
  for (const name of checks) if (!enforcedChecks.has(name)) issues.push(`缺少已启用约束 ${name}`);
  return { status: issues.length ? 'schema_mismatch' : 'ready', issues };
}
