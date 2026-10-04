import { createHash, randomUUID } from 'node:crypto';
import {
  defineRoute,
  type ApprovalHandler,
  type ToolRegistration,
} from '@internal-tools/foundation';
import type pg from 'pg';
import { z } from 'zod';
import {
  environments,
  featureFlagsTool,
  featureFlagsToolId,
  productionChangeAction,
} from './registry.js';

const basePath = '/api/tools/feature-flags';
const flagKeyPattern = /^[a-z][a-z0-9_.-]{2,63}$/;

const KeyParams = z.object({ key: z.string().regex(flagKeyPattern) });
const EnvironmentParams = KeyParams.extend({
  environment: z.enum(environments),
});
const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  after: z.string().regex(flagKeyPattern).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const HistoryQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const ChangeBody = z.object({
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100),
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().max(500).optional(),
});

type Queryable = Pick<pg.PoolClient, 'query'>;

function statusError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function productionChangeHash(change: {
  changeRequestId: string;
  flagKey: string;
  enabled: boolean;
  rolloutPercent: number;
  baseVersion: number;
}) {
  return createHash('sha256')
    .update(
      [
        change.changeRequestId,
        change.flagKey,
        'production',
        String(change.enabled),
        String(change.rolloutPercent),
        String(change.baseVersion),
      ].join('|'),
      'utf8',
    )
    .digest('hex');
}

async function findFlagId(tx: Queryable, key: string): Promise<string> {
  const result = await tx.query(
    'SELECT id FROM feature_flags.flags WHERE key=$1',
    [key],
  );
  const id = result.rows[0]?.id as string | undefined;
  if (!id) throw statusError('The flag does not exist.', 404);
  return id;
}

async function lockEnvironment(
  tx: Queryable,
  flagId: string,
  environment: string,
) {
  const result = await tx.query(
    `SELECT enabled,rollout_percent,version FROM feature_flags.flag_environments
     WHERE flag_id=$1 AND environment=$2 FOR UPDATE`,
    [flagId, environment],
  );
  const row = result.rows[0] as
    { enabled: boolean; rollout_percent: number; version: number } | undefined;
  if (!row) throw statusError('The flag environment does not exist.', 404);
  return {
    enabled: row.enabled,
    rolloutPercent: row.rollout_percent,
    version: row.version,
  };
}

async function updateEnvironment(
  tx: Queryable,
  flagId: string,
  environment: string,
  state: { enabled: boolean; rolloutPercent: number },
  actorId: string,
): Promise<number> {
  const result = await tx.query(
    `UPDATE feature_flags.flag_environments
     SET enabled=$3,rollout_percent=$4,version=version+1,updated_by=$5,updated_at=now()
     WHERE flag_id=$1 AND environment=$2 RETURNING version`,
    [flagId, environment, state.enabled, state.rolloutPercent, actorId],
  );
  return result.rows[0].version as number;
}

const environmentsJson = `jsonb_object_agg(e.environment, jsonb_build_object(
  'enabled', e.enabled, 'rolloutPercent', e.rollout_percent, 'version', e.version,
  'updatedBy', e.updated_by, 'updatedAt', e.updated_at))`;

export const featureFlagsRoutes = [
  defineRoute({
    method: 'GET',
    path: `${basePath}/flags`,
    permission: 'feature-flags.read',
    query: ListQuery,
    handler: async ({ tx, query }) => {
      const limit = query.limit ?? 50;
      const pattern = query.search
        ? `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
        : null;
      const result = await tx.query(
        `SELECT f.key,f.description,f.owner,${environmentsJson} AS environments,
           EXISTS(SELECT 1 FROM feature_flags.change_requests c
                  WHERE c.flag_id=f.id AND c.status='pending') AS pending_production_change
         FROM feature_flags.flags f
         JOIN feature_flags.flag_environments e ON e.flag_id=f.id
         WHERE ($1::text IS NULL OR f.key ILIKE $1 OR f.description ILIKE $1 OR f.owner ILIKE $1)
           AND ($2::text IS NULL OR f.key > $2)
         GROUP BY f.id ORDER BY f.key LIMIT $3`,
        [pattern, query.after ?? null, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      return {
        items: rows.map((row) => ({
          key: row.key,
          description: row.description,
          owner: row.owner,
          environments: row.environments,
          pendingProductionChange: row.pending_production_change,
        })),
        nextCursor:
          result.rows.length > limit ? rows[rows.length - 1]?.key : null,
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: `${basePath}/flags/:key`,
    permission: 'feature-flags.read',
    params: KeyParams,
    handler: async ({ tx, params }) => {
      const flag = await tx.query(
        `SELECT f.id,f.key,f.description,f.owner,f.created_at,${environmentsJson} AS environments
         FROM feature_flags.flags f
         JOIN feature_flags.flag_environments e ON e.flag_id=f.id
         WHERE f.key=$1 GROUP BY f.id`,
        [params.key],
      );
      const row = flag.rows[0];
      if (!row) throw statusError('The flag does not exist.', 404);
      const pending = await tx.query(
        `SELECT id,environment,enabled,rollout_percent,base_version,reason,requester_id,
                approval_request_id,created_at
         FROM feature_flags.change_requests c
         WHERE flag_id=$1 AND status='pending'
           AND EXISTS (SELECT 1 FROM foundation.approval_requests a
                       WHERE a.id=c.approval_request_id AND a.status='pending'
                         AND a.expires_at>now())
         ORDER BY created_at`,
        [row.id],
      );
      return {
        key: row.key,
        description: row.description,
        owner: row.owner,
        createdAt: row.created_at,
        environments: row.environments,
        pendingChanges: pending.rows.map((change) => ({
          changeRequestId: change.id,
          environment: change.environment,
          enabled: change.enabled,
          rolloutPercent: change.rollout_percent,
          baseVersion: change.base_version,
          reason: change.reason,
          requesterId: change.requester_id,
          approvalRequestId: change.approval_request_id,
          createdAt: change.created_at,
        })),
      };
    },
  }),
  defineRoute({
    method: 'PUT',
    path: `${basePath}/flags/:key/environments/:environment`,
    permission: 'feature-flags.write',
    params: EnvironmentParams,
    body: ChangeBody,
    idempotent: true,
    handler: async ({ tx, params, body, user, audit, approvals }) => {
      const { key, environment } = params;
      const flagId = await findFlagId(tx, key);
      const current = await lockEnvironment(tx, flagId, environment);
      if (current.version !== body.expectedVersion) {
        throw statusError(
          'Another person changed this flag. Reload the flag and try again.',
          409,
        );
      }
      const before = {
        enabled: current.enabled,
        rolloutPercent: current.rolloutPercent,
      };
      const after = {
        enabled: body.enabled,
        rolloutPercent: body.rolloutPercent,
      };
      if (
        before.enabled === after.enabled &&
        before.rolloutPercent === after.rolloutPercent
      ) {
        throw statusError(
          'The new state is the same as the current state.',
          400,
        );
      }

      if (environment !== 'production') {
        const version = await updateEnvironment(
          tx,
          flagId,
          environment,
          after,
          user.id,
        );
        await audit({
          action: 'feature-flags.environment_changed',
          objectType: 'flag',
          objectId: key,
          before: { environment, ...before, version: current.version },
          after: {
            environment,
            ...after,
            version,
            ...(body.reason ? { reason: body.reason } : {}),
          },
        });
        return { flagKey: key, environment, status: 'applied', version };
      }

      if (!body.reason || body.reason.length < 10) {
        throw statusError(
          'Give a reason of 10 or more characters for a production change.',
          400,
        );
      }
      const expired = await tx.query(
        `UPDATE feature_flags.change_requests c SET status='expired',decided_at=now()
         FROM foundation.approval_requests a
         WHERE a.id=c.approval_request_id AND c.flag_id=$1 AND c.status='pending'
           AND (a.status<>'pending' OR a.expires_at<=now())
         RETURNING c.id,c.approval_request_id`,
        [flagId],
      );
      for (const change of expired.rows) {
        await audit({
          action: 'feature-flags.production_change_expired',
          objectType: 'flag',
          objectId: key,
          before: { status: 'pending' },
          after: {
            status: 'expired',
            changeRequestId: change.id,
            approvalRequestId: change.approval_request_id,
          },
        });
      }
      const open = await tx.query(
        `SELECT 1 FROM feature_flags.change_requests
         WHERE flag_id=$1 AND environment='production' AND status='pending'`,
        [flagId],
      );
      if (open.rowCount) {
        throw statusError(
          'A production change for this flag already waits for approval.',
          409,
        );
      }
      const changeRequestId = randomUUID();
      const approvalRequestId = await approvals.create({
        action: productionChangeAction,
        objectType: 'flag',
        objectId: key,
        tier: 'flag_approver',
        policyVersion: 1,
        contentHash: productionChangeHash({
          changeRequestId,
          flagKey: key,
          ...after,
          baseVersion: current.version,
        }),
        steps: [{ roles: ['flag_approver'], approvals: [] }],
        summary: {
          flagKey: key,
          environment,
          changeRequestId,
          current: before,
          proposed: after,
          reason: body.reason,
        },
      });
      await tx.query(
        `INSERT INTO feature_flags.change_requests(
           id,flag_id,environment,enabled,rollout_percent,base_version,reason,
           requester_id,approval_request_id
         ) VALUES($1,$2,'production',$3,$4,$5,$6,$7,$8)`,
        [
          changeRequestId,
          flagId,
          after.enabled,
          after.rolloutPercent,
          current.version,
          body.reason,
          user.id,
          approvalRequestId,
        ],
      );
      await audit({
        action: 'feature-flags.production_change_requested',
        objectType: 'flag',
        objectId: key,
        before: { environment, ...before, version: current.version },
        after: {
          environment,
          ...after,
          reason: body.reason,
          changeRequestId,
          approvalRequestId,
        },
      });
      return {
        statusCode: 202,
        body: {
          flagKey: key,
          environment,
          status: 'pending_approval',
          changeRequestId,
          approvalRequestId,
        },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: `${basePath}/flags/:key/history`,
    permission: 'feature-flags.read',
    params: KeyParams,
    query: HistoryQuery,
    handler: async ({ tx, params, query }) => {
      const limit = query.limit ?? 100;
      await findFlagId(tx, params.key);
      const result = await tx.query(
        `SELECT a.seq,a.occurred_at,a.actor_id,a.action,a.object_type,a.result,
                a.event_data->'before' AS before,a.event_data->'after' AS after
         FROM foundation.audit_events a
         WHERE a.tool_id=$1
           AND ((a.object_type='flag' AND a.object_id=$2)
             OR (a.object_type='approval_request' AND a.object_id IN (
                   SELECT c.approval_request_id::text
                   FROM feature_flags.change_requests c
                   JOIN feature_flags.flags f ON f.id=c.flag_id
                   WHERE f.key=$2 AND c.approval_request_id IS NOT NULL)))
           AND ($3::bigint IS NULL OR a.seq < $3)
         ORDER BY a.seq DESC LIMIT $4`,
        [featureFlagsToolId, params.key, query.before ?? null, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      return {
        items: rows.map((row) => ({
          seq: String(row.seq),
          occurredAt: row.occurred_at,
          actorId: row.actor_id,
          action: row.action,
          objectType: row.object_type,
          result: row.result,
          before: row.before,
          after: row.after,
        })),
        nextCursor:
          result.rows.length > limit
            ? String(rows[rows.length - 1]?.seq)
            : null,
      };
    },
  }),
];

const decideProductionChange: ApprovalHandler = async (
  { tx, user, audit },
  approval,
  decision,
) => {
  const found = await tx.query(
    `SELECT c.*,f.key FROM feature_flags.change_requests c
     JOIN feature_flags.flags f ON f.id=c.flag_id
     WHERE c.approval_request_id=$1 FOR UPDATE OF c`,
    [approval.id],
  );
  const change = found.rows[0];
  if (!change || change.status !== 'pending') {
    throw statusError('This change request is no longer open.', 409);
  }
  const proposed = {
    enabled: change.enabled as boolean,
    rolloutPercent: change.rollout_percent as number,
  };
  const hash = productionChangeHash({
    changeRequestId: change.id,
    flagKey: change.key,
    ...proposed,
    baseVersion: change.base_version,
  });
  if (hash !== approval.content_hash) {
    throw statusError(
      'The change request does not match the approval. Reject the approval.',
      409,
    );
  }
  const context = {
    environment: 'production',
    changeRequestId: change.id,
    approvalRequestId: approval.id,
    requesterId: change.requester_id,
    approverId: user.id,
  };

  if (decision === 'reject') {
    await tx.query(
      `UPDATE feature_flags.change_requests
       SET status='rejected',decided_by=$2,decided_at=now() WHERE id=$1`,
      [change.id, user.id],
    );
    await audit({
      action: 'feature-flags.production_change_rejected',
      objectType: 'flag',
      objectId: change.key,
      after: { ...context, ...proposed },
    });
    return;
  }

  const current = await lockEnvironment(tx, change.flag_id, 'production');
  if (current.version !== change.base_version) {
    throw statusError(
      'The production state changed after the request. Reject this request and ask for a new one.',
      409,
    );
  }
  const version = await updateEnvironment(
    tx,
    change.flag_id,
    'production',
    proposed,
    user.id,
  );
  await tx.query(
    `UPDATE feature_flags.change_requests
     SET status='applied',decided_by=$2,decided_at=now() WHERE id=$1`,
    [change.id, user.id],
  );
  await audit({
    action: 'feature-flags.environment_changed',
    objectType: 'flag',
    objectId: change.key,
    before: {
      environment: 'production',
      enabled: current.enabled,
      rolloutPercent: current.rolloutPercent,
      version: current.version,
    },
    after: { ...context, ...proposed, version, reason: change.reason },
  });
};

export const featureFlagsRegistration: ToolRegistration = {
  tool: featureFlagsTool,
  routes: featureFlagsRoutes,
  approvalHandlers: { [productionChangeAction]: decideProductionChange },
};
