import pg from 'pg';

const { Pool } = pg;
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgres://tools:tools@localhost:5432/internal_tools',
  max: 20,
  statement_timeout: 5_000,
});
