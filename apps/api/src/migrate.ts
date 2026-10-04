import { readFile } from 'node:fs/promises';
import { pool } from './db.js';

const migration = await readFile(
  new URL('../db/001_foundation_refunds.sql', import.meta.url),
  'utf8',
);
await pool.query(migration);
await pool.end();
console.log('Foundation and refunds schema is ready.');
