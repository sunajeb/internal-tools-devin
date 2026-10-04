import pg from 'pg';
import { databaseConfig } from '@internal-tools/foundation';

const { Pool } = pg;
export const pool = new Pool({
  ...databaseConfig(),
  max: 20,
  statement_timeout: 5_000,
});
