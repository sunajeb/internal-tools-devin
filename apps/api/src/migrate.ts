import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { databaseConfig } from '@internal-tools/foundation';

const runtimeRole = 'app_runtime';
const pool = new pg.Pool(
  databaseConfig({ urlVariables: ['MIGRATION_DATABASE_URL', 'DATABASE_URL'] }),
);

async function sqlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory).catch(() => [] as string[]);
  return entries
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((entry) => join(directory, entry));
}

const coreDirectory = fileURLToPath(new URL('../db', import.meta.url));
const toolsDirectory = fileURLToPath(
  new URL('../../../tools', import.meta.url),
);
const toolIds = (await readdir(toolsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const files = [
  ...(await sqlFiles(coreDirectory)),
  ...(
    await Promise.all(
      toolIds.map((id) => sqlFiles(join(toolsDirectory, id, 'migrations'))),
    )
  ).flat(),
];
for (const file of files) {
  await pool.query(await readFile(file, 'utf8'));
}

const runtimePassword = process.env.RUNTIME_DB_PASSWORD;
if (runtimePassword) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query(
      'SELECT 1 FROM pg_roles WHERE rolname=$1',
      [runtimeRole],
    );
    const password = client.escapeLiteral(runtimePassword);
    await client.query(
      exists.rowCount
        ? `ALTER ROLE ${runtimeRole} LOGIN PASSWORD ${password}`
        : `CREATE ROLE ${runtimeRole} LOGIN PASSWORD ${password}`,
    );
    const schemas = await client.query<{ name: string }>(
      `SELECT nspname AS name FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema','public')`,
    );
    for (const { name } of schemas.rows) {
      const schema = client.escapeIdentifier(name);
      await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole}`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${runtimeRole}`,
      );
      await client.query(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${runtimeRole}`,
      );
      await client.query(
        `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${runtimeRole}`,
      );
    }
    await client.query(
      `REVOKE UPDATE, DELETE, TRUNCATE ON foundation.audit_events FROM ${runtimeRole}`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

await pool.end();
console.log(
  `Applied ${files.length} migration files${runtimePassword ? ` and granted ${runtimeRole}` : ''}.`,
);
