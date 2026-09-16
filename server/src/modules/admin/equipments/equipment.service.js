import { adminFeaturePending } from '../pending.js';
import { createHash } from 'node:crypto';
import { withConnection } from '../../../config/database.js';
import { equipmentSorts, parseEquipmentId } from '../../equipments/equipment.validation.js';
import { AppError } from '../../../utils/errors.js';
import { parseAdminEquipmentQuery, parseEquipmentCreate, parseEquipmentUpdate, parseStockAdjustment } from './equipment.validation.js';

function withEditVersion(equipment) {
  // Stock/time changes caused by checkout must not invalidate a metadata edit.
  const values = ['id', 'name', 'price', 'rarity', 'category', 'image', 'attack', 'defense', 'description', 'status', 'series_code', 'new_until'].map((key) => equipment[key]);
  return { ...equipment, edit_version: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
}

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
        return withEditVersion(equipment);
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
    async update(_actorId, value, body) {
      const id = parseEquipmentId(value);
      const { equipment, version } = parseEquipmentUpdate(body);
      return runWithConnection(async (connection) => {
        await connection.beginTransaction();
        try {
          const columns = `id, name, price, rarity, category, image, attack, defense, description,
            stock, status, series_code, new_until, (new_until IS NOT NULL AND new_until > UTC_TIMESTAMP()) AS is_new, created_at, updated_at`;
          const [[previous]] = await connection.execute(`SELECT ${columns} FROM equipments WHERE id = ? FOR UPDATE`, [id]);
          if (!previous) throw new AppError(404, 10004, '装备不存在');
          if (previous.status === 'deleted') throw new AppError(409, 10009, '已删除装备不能编辑或重新上架');
          if (withEditVersion(previous).edit_version !== version) throw new AppError(409, 10009, '装备资料已变化，请重新加载后再编辑');
          const keys = Object.keys(equipment);
          await connection.execute(`UPDATE equipments SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [...Object.values(equipment), id]);
          const [[updated]] = await connection.execute(`SELECT ${columns} FROM equipments WHERE id = ?`, [id]);
          await connection.commit();
          return withEditVersion(updated);
        } catch (error) { await connection.rollback(); throw error; }
      });
    },
    async adjustStock(actorId, value, body) {
      const id = parseEquipmentId(value);
      const { requestId, delta } = parseStockAdjustment(body);
      return runWithConnection(async (connection) => {
        await connection.beginTransaction();
        try {
          // Match checkout/cancellation's equipment row lock; metadata is never overwritten.
          const [[equipment]] = await connection.execute('SELECT id, stock, status FROM equipments WHERE id = ? FOR UPDATE', [id]);
          if (!equipment) throw new AppError(404, 10004, '装备不存在');
          let inserted = true;
          try {
            await connection.execute(`INSERT INTO inventory_adjustments
              (request_id, actor_id, equipment_id, delta, stock_before, stock_after, outcome)
              VALUES (?, ?, ?, ?, ?, ?, 'pending')`, [requestId, actorId, id, delta, equipment.stock, equipment.stock]);
          } catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; inserted = false; }
          const [[receipt]] = await connection.execute('SELECT * FROM inventory_adjustments WHERE request_id = ? FOR UPDATE', [requestId]);
          if (receipt.actor_id !== actorId || receipt.equipment_id !== id || Number(receipt.delta) !== delta) throw new AppError(409, 10012, '操作编号与原账号、装备或数量不一致');
          if (receipt.outcome !== 'pending') {
            await connection.commit();
            return { ...receipt, delta: Number(receipt.delta), replayed: true };
          }
          // An uncommitted placeholder is invisible to retries; committed pending data is invalid.
          if (!inserted) throw new AppError(503, 10011, '库存回执异常，请联系维护人员');
          const next = equipment.stock + delta;
          const reason = equipment.status === 'deleted' ? 'deleted' : next < 0 ? 'insufficient_stock' : next > 4294967295 ? 'stock_overflow' : null;
          if (!reason) await connection.execute('UPDATE equipments SET stock = ? WHERE id = ?', [next, id]);
          await connection.execute('UPDATE inventory_adjustments SET outcome = ?, stock_after = ?, rejection_reason = ? WHERE request_id = ?',
            [reason ? 'rejected' : 'applied', reason ? equipment.stock : next, reason, requestId]);
          const [[completed]] = await connection.execute('SELECT * FROM inventory_adjustments WHERE request_id = ?', [requestId]);
          await connection.commit();
          return { ...completed, delta: Number(completed.delta), replayed: false };
        } catch (error) { await connection.rollback(); throw error; }
      });
    },
    remove: adminFeaturePending,
  };
}
