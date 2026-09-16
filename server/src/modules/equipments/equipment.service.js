import { withConnection } from '../../config/database.js';
import { AppError, validationError } from '../../utils/errors.js';
import { equipmentSorts, parseEquipmentId, parseEquipmentQuery } from './equipment.validation.js';

export { parseEquipmentId, parseEquipmentQuery, parsePagination } from './equipment.validation.js';

const publicColumns = 'id, name, price, rarity, category, image, attack, defense, new_until, (new_until IS NOT NULL AND new_until > UTC_TIMESTAMP()) AS is_new, series_code, description, stock';

function normalizeFilters({ page = 1, pageSize = 12, keyword = '', rarities = [], category = '', sort = 'newest', inStock = false, series = '' } = {}) {
  if (!Array.isArray(rarities)) throw validationError('rarities', '稀有度必须是数组');
  if (typeof inStock !== 'boolean') throw validationError('in_stock', '内部库存筛选必须是布尔值');
  return parseEquipmentQuery({ page: String(page), page_size: String(pageSize), keyword, rarities: rarities.join(','), category, sort, in_stock: inStock ? '1' : '0', series });
}

function buildWhere({ keyword, rarities, category, inStock, series }) {
  const conditions = ["status = 'on_sale'"];
  const parameters = [];
  if (inStock) conditions.push('stock > 0');
  if (keyword) {
    conditions.push("name LIKE ? ESCAPE '!'");
    // An explicit escape character leaves backslashes literal in the bound pattern.
    parameters.push(`%${keyword.replace(/[!%_]/g, (character) => `!${character}`)}%`);
  }
  if (rarities.length) {
    conditions.push(`rarity IN (${rarities.map(() => '?').join(', ')})`);
    parameters.push(...rarities);
  }
  if (category) {
    conditions.push('category = ?');
    parameters.push(category);
  }
  if (series) {
    conditions.push('series_code = ?');
    parameters.push(series);
  }
  return { sql: conditions.join(' AND '), parameters };
}

export function createEquipmentService({ runWithConnection = withConnection } = {}) {
  return {
    async listEquipments(filters) {
      const normalized = normalizeFilters(filters);
      const { page, pageSize, sort } = normalized;
      const where = buildWhere(normalized);
      return runWithConnection(async (connection) => {
        // Both reads see one snapshot even if the server's default isolation level changes.
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
          const [[{ total }]] = await connection.execute(`SELECT COUNT(*) AS total FROM equipments WHERE ${where.sql}`, where.parameters);
          // Only validated integer pagination values and a fixed sort clause enter SQL text.
          const [items] = await connection.execute(
            `SELECT ${publicColumns} FROM equipments WHERE ${where.sql}
             ORDER BY ${equipmentSorts[sort]} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
            where.parameters,
          );
          await connection.commit();
          return { items, page, page_size: pageSize, total };
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      });
    },

    async getEquipmentById(value) {
      const id = parseEquipmentId(typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value);
      return runWithConnection(async (connection) => {
        const [[equipment]] = await connection.execute(
          `SELECT ${publicColumns} FROM equipments WHERE id = ? AND status = 'on_sale'`,
          [id],
        );
        if (!equipment) throw new AppError(404, 10004, '装备不存在或已下架');
        return equipment;
      });
    },
  };
}

const defaultService = createEquipmentService();
export const listEquipments = (filters) => defaultService.listEquipments(filters);
export const getEquipmentById = (id) => defaultService.getEquipmentById(id);
