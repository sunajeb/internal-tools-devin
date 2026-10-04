import { describe, expect, it, vi } from 'vitest';
import {
  databaseConfig,
  entraDatabaseScope,
  localDatabaseUrl,
} from './database.js';

describe('databaseConfig', () => {
  it('uses DATABASE_URL when it is set', () => {
    const config = databaseConfig({
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:secret@db:5432/app',
        PGHOST: 'ignored.postgres.database.azure.com',
      },
    });
    expect(config).toEqual({
      connectionString: 'postgres://user:secret@db:5432/app',
    });
  });

  it('uses the first URL variable that is set', () => {
    const config = databaseConfig({
      env: {
        MIGRATION_DATABASE_URL: 'postgres://owner@db/app',
        DATABASE_URL: 'postgres://runtime@db/app',
      },
      urlVariables: ['MIGRATION_DATABASE_URL', 'DATABASE_URL'],
    });
    expect(config.connectionString).toBe('postgres://owner@db/app');
  });

  it('uses PGHOST settings and an Entra token as the password', async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce({ token: 'token-1' })
      .mockResolvedValueOnce({ token: 'token-2' });
    const credential = vi.fn(() => ({ getToken }));
    const config = databaseConfig({
      env: {
        NODE_ENV: 'production',
        PGHOST: 'server.postgres.database.azure.com',
        PGUSER: 'itf-prod-web',
        PGDATABASE: 'internal_tools',
        PGPORT: '6432',
      },
      credential,
    });
    expect(config).toMatchObject({
      host: 'server.postgres.database.azure.com',
      port: 6432,
      user: 'itf-prod-web',
      database: 'internal_tools',
      ssl: { rejectUnauthorized: true },
    });
    expect(config.connectionString).toBeUndefined();
    expect(credential).not.toHaveBeenCalled();
    const password = config.password as () => Promise<string>;
    await expect(password()).resolves.toBe('token-1');
    await expect(password()).resolves.toBe('token-2');
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledWith(entraDatabaseScope);
  });

  it('uses port 5432 when PGPORT is not set', () => {
    const config = databaseConfig({
      env: { PGHOST: 'server', PGUSER: 'app', PGDATABASE: 'app' },
      credential: () => ({ getToken: async () => ({ token: 't' }) }),
    });
    expect(config.port).toBe(5432);
  });

  it('rejects when the credential returns no token', async () => {
    const config = databaseConfig({
      env: { PGHOST: 'server', PGUSER: 'app', PGDATABASE: 'app' },
      credential: () => ({ getToken: async () => null }),
    });
    const password = config.password as () => Promise<string>;
    await expect(password()).rejects.toThrow('No Entra access token');
  });

  it('requires PGUSER and PGDATABASE with PGHOST', () => {
    expect(() =>
      databaseConfig({ env: { PGHOST: 'server', PGDATABASE: 'app' } }),
    ).toThrow('PGUSER must be set when PGHOST is set.');
    expect(() =>
      databaseConfig({ env: { PGHOST: 'server', PGUSER: 'app' } }),
    ).toThrow('PGDATABASE must be set when PGHOST is set.');
  });

  it('rejects an invalid PGPORT', () => {
    expect(() =>
      databaseConfig({
        env: {
          PGHOST: 'server',
          PGUSER: 'app',
          PGDATABASE: 'app',
          PGPORT: 'abc',
        },
      }),
    ).toThrow('PGPORT must be a positive integer.');
  });

  it('fails fast in production when no database setting is present', () => {
    expect(() => databaseConfig({ env: { NODE_ENV: 'production' } })).toThrow(
      'Database settings are missing.',
    );
  });

  it('uses the local database outside production', () => {
    expect(databaseConfig({ env: { NODE_ENV: 'development' } })).toEqual({
      connectionString: localDatabaseUrl,
    });
    expect(databaseConfig({ env: {} })).toEqual({
      connectionString: localDatabaseUrl,
    });
  });
});
