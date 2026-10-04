import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgres://tools:tools@localhost:5432/internal_tools',
  max: 20,
  statement_timeout: 5_000,
});
export const orm = drizzle(pool, { schema });

export async function transaction<T>(
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
