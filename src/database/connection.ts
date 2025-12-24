import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export const connectDatabase = async (): Promise<void> => {
  try {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const isNeonDb = connectionString.includes('neon.tech');
    const isProduction = process.env.NODE_ENV === 'production';

    pool = new Pool({
      connectionString,
      ssl: (isProduction || isNeonDb) ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test the connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now, current_database() as db');
    client.release();

    logger.info('PostgreSQL connected successfully', {
      database: result.rows[0].db,
      serverTime: result.rows[0].now,
      ssl: isProduction || isNeonDb
    });
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL:', error);
    throw error;
  }
};

export const getPool = (): Pool => {
  if (!pool) {
    throw new Error('Database pool not initialized. Call connectDatabase() first.');
  }
  return pool;
};

export const query = async <T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> => {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      logger.warn('Slow query detected', { duration, query: text.substring(0, 100) });
    }
    
    return result;
  } catch (error) {
    logger.error('Query error', { query: text.substring(0, 100), error });
    throw error;
  }
};

export const getClient = async (): Promise<PoolClient> => {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  return pool.connect();
};

export const transaction = async <T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> => {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const closeDatabase = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection closed');
  }
};

export default {
  connectDatabase,
  getPool,
  query,
  getClient,
  transaction,
  closeDatabase
};
