import mysql from 'mysql2/promise';
import { env } from './env.js';

const connectionOptions = {
  ...env.db,
  charset: 'utf8mb4',
  timezone: 'Z',
  connectTimeout: 4000,
  multipleStatements: false,
};

const pool = mysql.createPool({ ...connectionOptions, connectionLimit: 5, waitForConnections: true, queueLimit: 20 });

export async function withConnection(callback) {
  const connection = await pool.getConnection();
  try {
    // Driver date conversion and MySQL CURRENT_TIMESTAMP must both use UTC.
    await connection.query("SET time_zone = '+00:00'");
    return await callback(connection);
  } finally {
    connection.release();
  }
}

export async function withTransaction(callback) {
  return withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}

export async function createConnection({ withoutDatabase = false, multipleStatements = false } = {}) {
  const options = { ...connectionOptions, multipleStatements };
  if (withoutDatabase) delete options.database;
  const connection = await mysql.createConnection(options);
  try {
    await connection.query("SET time_zone = '+00:00'");
    return connection;
  } catch (error) {
    await connection.end();
    throw error;
  }
}

export const closePool = () => pool.end();
