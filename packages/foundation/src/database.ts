import type { PoolConfig } from 'pg';

export const entraDatabaseScope =
  'https://ossrdbms-aad.database.windows.net/.default';
export const localDatabaseUrl =
  'postgres://tools:local-development-only@localhost:5432/internal_tools';

export interface DatabaseTokenCredential {
  getToken(scope: string): Promise<{ token: string } | null>;
}

export interface DatabaseConfigOptions {
  env?: NodeJS.ProcessEnv;
  urlVariables?: string[];
  credential?: () => DatabaseTokenCredential | Promise<DatabaseTokenCredential>;
}

let defaultCredential: Promise<DatabaseTokenCredential> | undefined;

function azureCredential(): Promise<DatabaseTokenCredential> {
  defaultCredential ??= import('@azure/identity').then(
    ({ DefaultAzureCredential }) => new DefaultAzureCredential(),
    (error: unknown) => {
      defaultCredential = undefined;
      throw error;
    },
  );
  return defaultCredential;
}

function requiredSetting(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} must be set when PGHOST is set.`);
  }
  return value;
}

export function databaseConfig(
  options: DatabaseConfigOptions = {},
): PoolConfig {
  const env = options.env ?? process.env;
  const urlVariables = options.urlVariables ?? ['DATABASE_URL'];
  const connectionString = urlVariables
    .map((name) => env[name])
    .find((value) => value);
  if (connectionString) return { connectionString };

  if (env.PGHOST) {
    const port = Number(env.PGPORT ?? 5432);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error('PGPORT must be a positive integer.');
    }
    const credential = options.credential ?? azureCredential;
    return {
      host: env.PGHOST,
      port,
      user: requiredSetting(env, 'PGUSER'),
      database: requiredSetting(env, 'PGDATABASE'),
      ssl: { rejectUnauthorized: true },
      password: async () => {
        const accessToken = await (
          await credential()
        ).getToken(entraDatabaseScope);
        if (!accessToken?.token) {
          throw new Error('No Entra access token for PostgreSQL.');
        }
        return accessToken.token;
      },
    };
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      `Database settings are missing. Set ${urlVariables.join(' or ')}, or set PGHOST, PGUSER and PGDATABASE for Entra authentication.`,
    );
  }
  return { connectionString: localDatabaseUrl };
}
