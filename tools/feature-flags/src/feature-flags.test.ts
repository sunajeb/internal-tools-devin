import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authorize,
  configureFoundation,
  hashAuditEvent,
  registerTool,
  type FoundationUser,
} from '@internal-tools/foundation';
import { permissionMatrix } from '@internal-tools/testing';
import { featureFlagsRegistration, featureFlagsRoutes } from './api.js';
import { featureFlagsTool, productionChangeAction } from './registry.js';

const expectedPermissions: Record<string, string[]> = {
  'feature-flags.read': [
    'flag_editor',
    'flag_approver',
    'auditor',
    'platform_admin',
  ],
  'feature-flags.write': ['flag_editor'],
  'feature-flags.approve': ['flag_approver'],
};

describe('Feature-Flag Panel registry', () => {
  it('grants each permission only to the expected roles', () => {
    const matrix = permissionMatrix(featureFlagsTool);
    expect(matrix).toHaveLength(4 * Object.keys(expectedPermissions).length);
    for (const row of matrix) {
      const allowed = expectedPermissions[row.permission]!.includes(row.role);
      expect(row.expected, `${row.role} ${row.permission}`).toBe(allowed);
      expect(
        authorize(
          { id: 'u', roles: [row.role] },
          row.permission,
          featureFlagsTool,
        ),
      ).toBe(allowed);
    }
  });

  it('declares every route permission in the matrix and maps the approval', () => {
    for (const route of featureFlagsRoutes) {
      expect(Object.keys(featureFlagsTool.permissions)).toContain(
        route.permission,
      );
      if (route.method !== 'GET') {
        expect(route.permission).toBe('feature-flags.write');
        expect(route.idempotent).toBe(true);
      }
    }
    expect(featureFlagsTool.approvalPermissions?.[productionChangeAction]).toBe(
      'feature-flags.approve',
    );
  });
});

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('Feature-Flag Panel API with PostgreSQL', () => {
  const run = randomUUID().replaceAll('-', '').slice(0, 10);
  const prefix = `test.${run}`;
  const userFor = (name: string, roles: string[]): FoundationUser => ({
    id: `ff-${name}-${run}`,
    displayName: name,
    roles,
  });
  const users: Record<string, FoundationUser | undefined> = {
    editor: userFor('editor', ['flag_editor']),
    approver: userFor('approver', ['flag_approver']),
    dual: userFor('dual', ['flag_editor', 'flag_approver']),
    auditor: userFor('auditor', ['auditor']),
    platformAdmin: userFor('platform-admin', ['platform_admin']),
    outsider: userFor('outsider', ['agent']),
    anonymous: undefined,
  };
  const roleNames = Object.keys(users).filter((name) => name !== 'dual');
  const readers = ['editor', 'approver', 'auditor', 'platformAdmin'];

  let pool: pg.Pool;
  let app: FastifyInstance;

  const send = (
    user: string,
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: {
        'x-test-user': user,
        'x-csrf-token': 'valid',
        'idempotency-key': randomUUID(),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const createFlag = async (name: string) => {
    const key = `${prefix}.${name}`;
    await pool.query(
      `WITH flag AS (
         INSERT INTO feature_flags.flags(key,description,owner)
         VALUES($1,'Synthetic test flag.','test-owner@example.test') RETURNING id
       )
       INSERT INTO feature_flags.flag_environments(flag_id,environment,updated_by)
       SELECT flag.id, env, 'test' FROM flag,
         unnest(ARRAY['development','staging','production']) env`,
      [key],
    );
    return key;
  };

  const stateOf = async (key: string, environment: string) => {
    const result = await pool.query(
      `SELECT e.enabled,e.rollout_percent,e.version FROM feature_flags.flag_environments e
       JOIN feature_flags.flags f ON f.id=e.flag_id
       WHERE f.key=$1 AND e.environment=$2`,
      [key, environment],
    );
    return result.rows[0] as {
      enabled: boolean;
      rollout_percent: number;
      version: number;
    };
  };

  const envUrl = (key: string, environment: string) =>
    `/api/tools/feature-flags/flags/${key}/environments/${environment}`;

  const requestProduction = async (
    key: string,
    user = 'editor',
    rolloutPercent = 40,
  ) => {
    const { version } = await stateOf(key, 'production');
    const response = await send(user, 'PUT', envUrl(key, 'production'), {
      enabled: true,
      rolloutPercent,
      expectedVersion: version,
      reason: 'Start the production rollout for the test.',
    });
    expect(response.statusCode, response.body).toBe(202);
    return response.json() as {
      approvalRequestId: string;
      changeRequestId: string;
    };
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: databaseUrl });
    app = Fastify();
    configureFoundation(app, {
      pool,
      currentUser: async (request) =>
        users[String(request.headers['x-test-user'])],
      verifyCsrf: (request) => request.headers['x-csrf-token'] === 'valid',
    });
    registerTool(app, featureFlagsRegistration);
    await app.ready();
  });

  afterAll(async () => {
    const approvals = await pool.query(
      `SELECT id FROM foundation.approval_requests
       WHERE tool_id='feature-flags' AND object_id LIKE $1`,
      [`${prefix}.%`],
    );
    const ids = approvals.rows.map((row) => row.id as string);
    await pool.query('DELETE FROM feature_flags.flags WHERE key LIKE $1', [
      `${prefix}.%`,
    ]);
    await pool.query(
      'DELETE FROM foundation.approvals WHERE approval_request_id = ANY($1::uuid[])',
      [ids],
    );
    await pool.query(
      'DELETE FROM foundation.approval_requests WHERE id = ANY($1::uuid[])',
      [ids],
    );
    await app.close();
    await pool.end();
  });

  it('applies the permission matrix to every tool route and role', async () => {
    const key = await createFlag('matrix');
    const readUrls = [
      '/api/tools/feature-flags/flags',
      `/api/tools/feature-flags/flags?search=${prefix}`,
      `/api/tools/feature-flags/flags/${key}`,
      `/api/tools/feature-flags/flags/${key}/history`,
    ];
    for (const role of roleNames) {
      for (const url of readUrls) {
        const response = await send(role, 'GET', url);
        const expected =
          role === 'anonymous' ? 401 : readers.includes(role) ? 200 : 403;
        expect(response.statusCode, `${role} GET ${url}`).toBe(expected);
      }
      for (const environment of ['development', 'staging', 'production']) {
        const current = await stateOf(key, environment);
        const response = await send(role, 'PUT', envUrl(key, environment), {
          enabled: !current.enabled,
          rolloutPercent: 10,
          expectedVersion: current.version,
          reason: 'Matrix test change with a reason.',
        });
        const expected =
          role === 'anonymous'
            ? 401
            : role !== 'editor'
              ? 403
              : environment === 'production'
                ? 202
                : 200;
        expect(response.statusCode, `${role} PUT ${environment}`).toBe(
          expected,
        );
      }
    }
  });

  it('applies the permission matrix to the Foundation approval routes', async () => {
    const key = await createFlag('approval-matrix');
    const { approvalRequestId } = await requestProduction(key);
    for (const role of roleNames) {
      const list = await send(role, 'GET', '/api/approvals?tool=feature-flags');
      expect(list.statusCode, `${role} list approvals`).toBe(
        role === 'anonymous' ? 401 : 200,
      );
      if (role !== 'anonymous') {
        const ids = (
          list.json() as { items: Array<{ approval_id: string }> }
        ).items.map((item) => item.approval_id);
        expect(ids.includes(approvalRequestId), `${role} sees approval`).toBe(
          role === 'approver',
        );
      }
    }
    for (const role of roleNames.filter((name) => name !== 'approver')) {
      for (const decision of ['approve', 'reject']) {
        const response = await send(
          role,
          'POST',
          `/api/approvals/${approvalRequestId}/${decision}`,
          {},
        );
        expect(response.statusCode, `${role} ${decision}`).toBe(
          role === 'anonymous' ? 401 : 403,
        );
      }
    }
    expect((await stateOf(key, 'production')).enabled).toBe(false);
    const approved = await send(
      'approver',
      'POST',
      `/api/approvals/${approvalRequestId}/approve`,
      {},
    );
    expect(approved.statusCode, approved.body).toBe(200);
  });

  it('applies development and staging changes at once with an audit event', async () => {
    const key = await createFlag('direct');
    const response = await send('editor', 'PUT', envUrl(key, 'staging'), {
      enabled: true,
      rolloutPercent: 35,
      expectedVersion: 1,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: 'applied', version: 2 });
    expect(await stateOf(key, 'staging')).toEqual({
      enabled: true,
      rollout_percent: 35,
      version: 2,
    });
    const audit = await pool.query(
      `SELECT actor_id,event_data FROM foundation.audit_events
       WHERE tool_id='feature-flags' AND object_type='flag' AND object_id=$1
         AND action='feature-flags.environment_changed'`,
      [key],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(users.editor!.id);
    expect(audit.rows[0].event_data.before).toEqual({
      environment: 'staging',
      enabled: false,
      rolloutPercent: 0,
      version: 1,
    });
    expect(audit.rows[0].event_data.after).toMatchObject({
      environment: 'staging',
      enabled: true,
      rolloutPercent: 35,
      version: 2,
    });
  });

  it('applies a production change only after a flag approver approves it', async () => {
    const key = await createFlag('production');
    const { approvalRequestId, changeRequestId } = await requestProduction(
      key,
      'editor',
      60,
    );
    expect(await stateOf(key, 'production')).toEqual({
      enabled: false,
      rollout_percent: 0,
      version: 1,
    });
    const detail = await send(
      'auditor',
      'GET',
      `/api/tools/feature-flags/flags/${key}`,
    );
    expect(detail.json().pendingChanges).toEqual([
      expect.objectContaining({ changeRequestId, rolloutPercent: 60 }),
    ]);

    const approved = await send(
      'approver',
      'POST',
      `/api/approvals/${approvalRequestId}/approve`,
      {},
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toEqual({ status: 'approved' });
    expect(await stateOf(key, 'production')).toEqual({
      enabled: true,
      rollout_percent: 60,
      version: 2,
    });
    const change = await pool.query(
      'SELECT status,decided_by FROM feature_flags.change_requests WHERE id=$1',
      [changeRequestId],
    );
    expect(change.rows[0]).toEqual({
      status: 'applied',
      decided_by: users.approver!.id,
    });

    const history = await send(
      'platformAdmin',
      'GET',
      `/api/tools/feature-flags/flags/${key}/history`,
    );
    expect(history.statusCode).toBe(200);
    const actions = (
      history.json() as { items: Array<{ action: string; actorId: string }> }
    ).items.map((item) => `${item.action}:${item.actorId}`);
    expect(actions).toEqual([
      `approval.approved:${users.approver!.id}`,
      `feature-flags.environment_changed:${users.approver!.id}`,
      `feature-flags.production_change_requested:${users.editor!.id}`,
    ]);
  });

  it('blocks self-approval of a production change', async () => {
    const key = await createFlag('self-approval');
    const { approvalRequestId } = await requestProduction(key, 'dual');
    const response = await send(
      'dual',
      'POST',
      `/api/approvals/${approvalRequestId}/approve`,
      {},
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/cannot approve a request/i);
    expect((await stateOf(key, 'production')).enabled).toBe(false);
    const denied = await pool.query(
      `SELECT 1 FROM foundation.audit_events
       WHERE action='approval.self_approval_denied' AND object_id=$1 AND actor_id=$2`,
      [approvalRequestId, users.dual!.id],
    );
    expect(denied.rowCount).toBe(1);
  });

  it('does not let an editor approve or an auditor write', async () => {
    const key = await createFlag('refusals');
    const { approvalRequestId } = await requestProduction(key);
    const editorApproval = await send(
      'editor',
      'POST',
      `/api/approvals/${approvalRequestId}/approve`,
      {},
    );
    expect(editorApproval.statusCode).toBe(403);
    const auditorWrite = await send('auditor', 'PUT', envUrl(key, 'staging'), {
      enabled: true,
      rolloutPercent: 5,
      expectedVersion: 1,
    });
    expect(auditorWrite.statusCode).toBe(403);
    expect(await stateOf(key, 'staging')).toMatchObject({ version: 1 });
    expect((await stateOf(key, 'production')).enabled).toBe(false);
    const denied = await pool.query(
      `SELECT object_id FROM foundation.audit_events
       WHERE tool_id='feature-flags' AND action='permission.denied' AND actor_id=$1`,
      [users.auditor!.id],
    );
    expect(denied.rows.map((row) => row.object_id)).toContain(
      'feature-flags.write',
    );
  });

  it('keeps production unchanged when an approver rejects the change', async () => {
    const key = await createFlag('rejected');
    const { approvalRequestId, changeRequestId } = await requestProduction(key);
    const rejected = await send(
      'approver',
      'POST',
      `/api/approvals/${approvalRequestId}/reject`,
      {},
    );
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toEqual({ status: 'rejected' });
    expect(await stateOf(key, 'production')).toMatchObject({
      enabled: false,
      version: 1,
    });
    const change = await pool.query(
      'SELECT status FROM feature_flags.change_requests WHERE id=$1',
      [changeRequestId],
    );
    expect(change.rows[0].status).toBe('rejected');
  });

  it('refuses a second pending production change and a stale approval', async () => {
    const key = await createFlag('conflicts');
    const { approvalRequestId } = await requestProduction(key);
    const second = await send('editor', 'PUT', envUrl(key, 'production'), {
      enabled: true,
      rolloutPercent: 80,
      expectedVersion: 1,
      reason: 'A second production change for the test.',
    });
    expect(second.statusCode).toBe(409);

    await pool.query(
      `UPDATE feature_flags.flag_environments e SET version=version+1
       FROM feature_flags.flags f
       WHERE f.id=e.flag_id AND f.key=$1 AND e.environment='production'`,
      [key],
    );
    const stale = await send(
      'approver',
      'POST',
      `/api/approvals/${approvalRequestId}/approve`,
      {},
    );
    expect(stale.statusCode).toBe(409);
    expect(await stateOf(key, 'production')).toMatchObject({
      enabled: false,
      version: 2,
    });
    const status = await pool.query(
      'SELECT status FROM foundation.approval_requests WHERE id=$1',
      [approvalRequestId],
    );
    expect(status.rows[0].status).toBe('pending');
  });

  it('validates input and requires a reason for production', async () => {
    const key = await createFlag('validation');
    const tooHigh = await send('editor', 'PUT', envUrl(key, 'development'), {
      enabled: true,
      rolloutPercent: 101,
      expectedVersion: 1,
    });
    expect(tooHigh.statusCode).toBe(400);
    const badEnvironment = await send('editor', 'PUT', envUrl(key, 'qa'), {
      enabled: true,
      rolloutPercent: 1,
      expectedVersion: 1,
    });
    expect(badEnvironment.statusCode).toBe(400);
    const noReason = await send('editor', 'PUT', envUrl(key, 'production'), {
      enabled: true,
      rolloutPercent: 1,
      expectedVersion: 1,
    });
    expect(noReason.statusCode).toBe(400);
    const missing = await send(
      'editor',
      'GET',
      `/api/tools/feature-flags/flags/${prefix}.missing`,
    );
    expect(missing.statusCode).toBe(404);
    await expect(
      pool.query(
        `UPDATE feature_flags.flag_environments e SET rollout_percent=101
         FROM feature_flags.flags f WHERE f.id=e.flag_id AND f.key=$1`,
        [key],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      pool.query(
        `INSERT INTO feature_flags.flags(key,description,owner)
         VALUES('Bad Key','Synthetic test flag.','test-owner@example.test')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('replays a retried request and refuses a concurrent stale change', async () => {
    const key = await createFlag('concurrency');
    const idempotencyKey = randomUUID();
    const body = { enabled: true, rolloutPercent: 20, expectedVersion: 1 };
    const first = await send(
      'editor',
      'PUT',
      envUrl(key, 'development'),
      body,
      {
        'idempotency-key': idempotencyKey,
      },
    );
    const retry = await send(
      'editor',
      'PUT',
      envUrl(key, 'development'),
      body,
      {
        'idempotency-key': idempotencyKey,
      },
    );
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect((await stateOf(key, 'development')).version).toBe(2);

    const results = await Promise.all(
      [30, 40].map((rolloutPercent) =>
        send('editor', 'PUT', envUrl(key, 'development'), {
          enabled: true,
          rolloutPercent,
          expectedVersion: 2,
        }),
      ),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect((await stateOf(key, 'development')).version).toBe(3);
  });

  it('writes audit events that keep a valid hash chain', async () => {
    const events = await pool.query(
      `SELECT event_data,prev_hash,hash FROM foundation.audit_events
       WHERE tool_id='feature-flags' AND actor_id LIKE $1 ORDER BY seq`,
      [`%-${run}`],
    );
    expect(events.rowCount).toBeGreaterThan(10);
    for (const row of events.rows) {
      expect(
        (row.hash as Buffer).equals(
          hashAuditEvent(row.prev_hash as Buffer, row.event_data),
        ),
        `${row.event_data.action} ${row.event_data.objectId}`,
      ).toBe(true);
    }
  });
});
