import { adminFeaturePending } from '../pending.js';
import { withConnection } from '../../../config/database.js';
import { equipmentSorts, parseEquipmentId } from '../../equipments/equipment.validation.js';
import { AppError } from '../../../utils/errors.js';
import { parseAdminEquipmentQuery, parseEquipmentCreate } from './equipment.validation.js';

// Editing excludes stock; adjustStock needs an idempotency key; remove is a guarded soft delete.
export function createAdminEquipmentService({ runWithConnection = withConnection } = {}) {
  return {
    async list(query) {
      const filters = parseAdminEquipmentQuery(query);
      const conditions = [filters.status ? 'status = ?' : "status <> 'deleted'"];
      const values = filters.status ? [filters.status] : [];
      if (filters.keyword) {
        conditions.push("name LIKE ? ESCAPE '!'");
        values.push(`%${filters.keyword.replace(/[!%_]/g, (character) => `!${character}`)}%`);
      }
      if (filters.category) { conditions.push('category = ?'); values.push(filters.category); }
      if (filters.rarities.length) {
        conditions.push(`rarity IN (${filters.rarities.map(() => '?').join(', ')})`);
        values.push(...filters.rarities);
      }
      if (filters.series) { conditions.push('series_code = ?'); values.push(filters.series); }
      if (filters.inStock) conditions.push('stock > 0');
      const where = conditions.join(' AND ');
      const { page, pageSize, sort } = filters;
      return runWithConnection(async (connection) => {
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
          const [[{ total }]] = await connection.execute(`SELECT COUNT(*) AS total FROM equipments WHERE ${where}`, values);
          const [items] = await connection.execute(
            `SELECT id, name, price, rarity, category, image, attack, defense, description,
                    stock, status, series_code, new_until,
                    (new_until IS NOT NULL AND new_until > UTC_TIMESTAMP()) AS is_new,
                    created_at, updated_at
             FROM equipments WHERE ${where}
             ORDER BY ${equipmentSorts[sort]} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values,
          );
          await connection.commit();
          return { items, total, page, page_size: pageSize };
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      });
    },
    async get(value) {
      const id = parseEquipmentId(value);
      return runWithConnection(async (connection) => {
        const [[equipment]] = await connection.execute(
          `SELECT id, name, price, rarity, category, image, attack, defense, description,
                  stock, status, series_code, new_until,
                  (new_until IS NOT NULL AND new_until > UTC_TIMESTAMP()) AS is_new,
                  created_at, updated_at
           FROM equipments WHERE id = ?`, [id],
        );
        if (!equipment) throw new AppError(404, 10004, '装备不存在');
        return equipment;
      });
    },
    async create(_actorId, body) {
      const equipment = parseEquipmentCreate(body);
      return runWithConnection(async (connection) => {
        await connection.beginTransaction();
        try {
          const fields = Object.keys(equipment);
          const [result] = await connection.execute(
            `INSERT INTO equipments (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, Object.values(equipment),
          );
          const [[created]] = await connection.execute(
            `SELECT id, name, price, rarity, category, image, attack, defense, description,
                    stock, status, series_code, new_until,
                    (new_until IS NOT NULL AND new_until > UTC_TIMESTAMP()) AS is_new,
                    created_at, updated_at FROM equipments WHERE id = ?`, [result.insertId],
          );
          await connection.commit();
          return created;
        } catch (error) { await connection.rollback(); throw error; }
      });
    },
    update: adminFeaturePending,
    adjustStock: adminFeaturePending,
    remove: adminFeaturePending,
  };
}
