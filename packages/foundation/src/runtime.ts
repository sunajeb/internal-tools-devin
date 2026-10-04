import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { appendAudit, type AuditInput } from './audit-store.js';
import { checkIdempotency, requestHash } from './idempotency.js';
import { maskValue, type FieldClass } from './masking.js';
import {
  authorize,
  type RouteDefinition,
  type ToolDefinition,
} from './registry.js';

export interface FoundationUser {
  id: string;
  displayName: string;
  roles: string[];
}

export interface FoundationContext<
  Params = unknown,
  Query = unknown,
  Body = unknown,
> {
  user: FoundationUser;
  tx: pg.PoolClient;
  params: Params;
  query: Query;
  body: Body;
  requestId: string;
  log: FastifyRequest['log'];
  audit: (
    event: Omit<
      AuditInput,
      | 'actorId'
      | 'actorRoles'
      | 'toolId'
      | 'requestId'
      | 'sourceIp'
      | 'userAgent'
    >,
  ) => Promise<unknown>;
  approvals: {
    create: (input: ApprovalCreateInput) => Promise<string>;
  };
  outbox: {
    enqueue: (
      kind: string,
      payload: Record<string, unknown>,
      idempotencyKey: string,
    ) => Promise<void>;
  };
  mask: (value: string | null, dataClass: FieldClass) => string | null;
}

export interface ApprovalCreateInput {
  action: string;
  objectType: string;
  objectId: string;
  tier: string;
  policyVersion: number;
  contentHash: string;
  steps: Array<{ roles: string[]; approvals: Array<unknown> }>;
  expiresAt?: Date;
  summary?: Record<string, unknown>;
}

export type FoundationRoute<
  Params = unknown,
  Query = unknown,
  Body = unknown,
> = RouteDefinition<Params, Query, Body>;

export interface ApprovalRequestRecord {
  id: string;
  tool_id: string;
  action: string;
  object_type: string;
  object_id: string;
  requester_id: string;
  tier: string;
  policy_version: number;
  content_hash: string;
  steps: Array<{
    roles: string[];
    approvals: Array<{ userId: string; role: string }>;
  }>;
  status: string;
  summary?: Record<string, unknown>;
}

export type ApprovalHandler = (
  context: FoundationContext,
  approval: ApprovalRequestRecord,
  decision: 'approve' | 'reject',
) => void | Promise<void>;

export interface OutboxHandlerResult {
  retryAfterMs?: number;
  failed?: string;
}

export interface ToolRegistration {
  tool: ToolDefinition;
  routes: FoundationRoute[];
  approvalHandlers?: Record<string, ApprovalHandler>;
  outboxHandlers?: Record<
    string,
    (
      context: unknown,
      payload: Record<string, unknown>,
    ) => Promise<void | OutboxHandlerResult>
  >;
  reconcilers?: Record<string, (context: unknown) => Promise<void>>;
  reconcilerIntervals?: Record<string, number>;
  pausedKinds?: string[];
}

export interface FoundationOptions {
  pool: pg.Pool;
  currentUser: (request: FastifyRequest) => Promise<FoundationUser | undefined>;
  verifyCsrf: (request: FastifyRequest) => boolean;
}

interface RuntimeState extends FoundationOptions {
  registrations: Map<string, ToolRegistration>;
}

export interface RouteResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

const states = new WeakMap<FastifyInstance, RuntimeState>();

export class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const genericFailureMessage = 'The request could not be completed. Try again.';

function sendRouteError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  request.log.error({ err: error }, 'Foundation route failed');
  return reply.code(500).send({ error: genericFailureMessage });
}

async function transaction<T>(
  pool: pg.Pool,
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

function normalizedSchema<T>(schema: z.ZodType<T> | undefined, value: unknown) {
  if (!schema) return { success: true as const, data: value as T };
  return schema.safeParse(value);
}

function routeResponse(value: unknown): RouteResponse {
  if (
    value !== null &&
    typeof value === 'object' &&
    'statusCode' in value &&
    'body' in value
  ) {
    return value as RouteResponse;
  }
  return { statusCode: 200, body: value };
}

function buildContext(
  request: FastifyRequest,
  client: pg.PoolClient,
  registration: ToolRegistration,
  user: FoundationUser,
  parsed: { params: unknown; query: unknown; body: unknown },
): FoundationContext {
  return {
    user,
    tx: client,
    params: parsed.params,
    query: parsed.query,
    body: parsed.body,
    requestId: request.id,
    log: request.log,
    audit: (event) =>
      appendAudit(client, {
        ...event,
        toolId: registration.tool.id,
        actorId: user.id,
        actorRoles: user.roles,
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    approvals: {
      create: async (input) => {
        const result = await client.query(
          `INSERT INTO foundation.approval_requests(
             tool_id,action,object_type,object_id,requester_id,tier,policy_version,
             content_hash,steps,status,expires_at,summary
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)
           RETURNING id`,
          [
            registration.tool.id,
            input.action,
            input.objectType,
            input.objectId,
            user.id,
            input.tier,
            input.policyVersion,
            input.contentHash,
            JSON.stringify(input.steps),
            input.expiresAt ?? new Date(Date.now() + 72 * 60 * 60_000),
            JSON.stringify(input.summary ?? {}),
          ],
        );
        return String(result.rows[0].id);
      },
    },
    outbox: {
      enqueue: async (kind, payload, idempotencyKey) => {
        await client.query(
          `INSERT INTO foundation.outbox(tool_id,kind,payload,idempotency_key,status)
           VALUES($1,$2,$3,$4,'pending') ON CONFLICT(idempotency_key) DO NOTHING`,
          [registration.tool.id, kind, JSON.stringify(payload), idempotencyKey],
        );
      },
    },
    mask: (value, dataClass) => maskValue(value, dataClass, false),
  };
}

const permissionDeniedMessage =
  'You do not have permission to perform this action.';

async function auditPermissionDenial(
  state: RuntimeState,
  request: FastifyRequest,
  tool: ToolDefinition,
  user: FoundationUser,
  permission: string,
) {
  try {
    await transaction(state.pool, (client) =>
      appendAudit(client, {
        toolId: tool.id,
        actorId: user.id,
        actorRoles: user.roles,
        action: 'permission.denied',
        objectType: 'permission',
        objectId: permission,
        result: 'denied',
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    );
  } catch (error) {
    request.log.error(
      { error },
      'Could not write authorization denial audit event',
    );
  }
}

async function authorizeRequest(
  state: RuntimeState,
  request: FastifyRequest,
  reply: FastifyReply,
  tool: ToolDefinition,
  permission: string,
): Promise<FoundationUser | undefined> {
  const user = await state.currentUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Sign in to continue.' });
    return undefined;
  }
  if (!authorize(user, permission, tool)) {
    await auditPermissionDenial(state, request, tool, user, permission);
    reply.code(403).send({ error: permissionDeniedMessage });
    return undefined;
  }
  return user;
}

async function runRegisteredRoute(
  state: RuntimeState,
  registration: ToolRegistration,
  route: FoundationRoute,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const user = await state.currentUser(request);
  if (!user) return reply.code(401).send({ error: 'Sign in to continue.' });
  if (request.method !== 'GET' && !state.verifyCsrf(request)) {
    return reply.code(403).send({
      error: 'Refresh the page and try again. The security token is missing.',
    });
  }

  const params = normalizedSchema(route.params, request.params);
  const query = normalizedSchema(route.query, request.query);
  const body = normalizedSchema(route.body, request.body);
  if (!params.success || !query.success || !body.success) {
    return reply.code(400).send({
      error: 'Request validation failed.',
      details: [
        ...(!params.success ? params.error.issues : []),
        ...(!query.success ? query.error.issues : []),
        ...(!body.success ? body.error.issues : []),
      ].map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }

  if (!authorize(user, route.permission, registration.tool)) {
    await auditPermissionDenial(
      state,
      request,
      registration.tool,
      user,
      route.permission,
    );
    return reply.code(403).send({ error: permissionDeniedMessage });
  }

  const parsed = {
    params: params.data,
    query: query.data,
    body: body.data,
  };
  try {
    const result: RouteResponse = await transaction(
      state.pool,
      async (client) => {
        let idempotency: { key: string } | undefined;
        if (route.idempotent) {
          const key = request.headers['idempotency-key'];
          if (typeof key !== 'string' || !key.trim()) {
            throw new HttpError('An Idempotency-Key header is required.', 400);
          }
          const inputHash = requestHash(parsed);
          const routeKey = `${route.method} ${route.path}`;
          const inserted = await client.query(
            `INSERT INTO foundation.idempotency_keys(actor_id,route,key,request_hash)
           VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING key`,
            [user.id, routeKey, key, inputHash],
          );
          if (!inserted.rowCount) {
            const existing = await client.query(
              `SELECT request_hash,response_code,response_body
             FROM foundation.idempotency_keys
             WHERE actor_id=$1 AND route=$2 AND key=$3 FOR UPDATE`,
              [user.id, routeKey, key],
            );
            const record = existing.rows[0];
            const checked = checkIdempotency(
              record?.request_hash,
              inputHash,
              record?.response_code !== null &&
                record?.response_code !== undefined,
            );
            if (checked.action === 'conflict') {
              throw new HttpError(
                'This request key was used with different details.',
                422,
              );
            }
            if (checked.action === 'replay') {
              return {
                statusCode: Number(record.response_code),
                body: record.response_body,
              };
            }
            throw new HttpError(
              'This request is still being processed. Try again shortly.',
              409,
            );
          }
          idempotency = { key };
        }
        const context = buildContext(
          request,
          client,
          registration,
          user,
          parsed,
        );
        let auditEvents = 0;
        const writeAudit = context.audit;
        context.audit = (event) => {
          auditEvents += 1;
          return writeAudit(event);
        };
        const response = routeResponse(await route.handler(context));
        if (
          route.method !== 'GET' &&
          response.statusCode < 400 &&
          auditEvents === 0
        ) {
          throw new Error(
            `${route.method} ${route.path} changed state without an audit event.`,
          );
        }
        if (idempotency) {
          await client.query(
            `UPDATE foundation.idempotency_keys
           SET response_code=$4,response_body=$5
           WHERE actor_id=$1 AND route=$2 AND key=$3`,
            [
              user.id,
              `${route.method} ${route.path}`,
              idempotency.key,
              response.statusCode,
              JSON.stringify(response.body),
            ],
          );
        }
        return response;
      },
    );
    reply.code(result.statusCode);
    for (const [name, value] of Object.entries(result.headers ?? {})) {
      reply.header(name, value);
    }
    return reply.send(result.body);
  } catch (error) {
    return sendRouteError(request, reply, error);
  }
}

function approvalPermission(tool: ToolDefinition, action: string) {
  return (
    tool.approvalPermissions?.[action] ??
    `${action.split('.')[0] ?? action}.approve`
  );
}

function nextApprovalStep(
  steps: ApprovalRequestRecord['steps'],
  roles: string[],
) {
  return steps.findIndex(
    (step, index) =>
      step.approvals.length === 0 &&
      steps
        .slice(0, index)
        .every((previous) => previous.approvals.length > 0) &&
      step.roles.some((role) => roles.includes(role)),
  );
}

function approvalContext(
  state: RuntimeState,
  request: FastifyRequest,
  client: pg.PoolClient,
  registration: ToolRegistration,
  user: FoundationUser,
): FoundationContext {
  return buildContext(request, client, registration, user, {
    params: {},
    query: {},
    body: {},
  });
}

function registerApprovalRoutes(app: FastifyInstance, state: RuntimeState) {
  app.get('/api/approvals', async (request, reply) => {
    const user = await state.currentUser(request);
    if (!user) return reply.code(401).send({ error: 'Sign in to continue.' });
    const result = await state.pool.query(
      `SELECT id,tool_id,action,object_type,object_id,requester_id,tier,
              policy_version,content_hash,steps,status,created_at,summary
       FROM foundation.approval_requests WHERE status='pending'
       ORDER BY created_at ASC`,
    );
    const toolFilter = (request.query as { tool?: unknown }).tool;
    const items = result.rows.filter((row) => {
      if (typeof toolFilter === 'string' && row.tool_id !== toolFilter) {
        return false;
      }
      const registration = state.registrations.get(row.tool_id);
      if (!registration) return false;
      const permission = approvalPermission(registration.tool, row.action);
      if (!authorize(user, permission, registration.tool)) return false;
      const steps = row.steps as ApprovalRequestRecord['steps'];
      return nextApprovalStep(steps, user.roles) >= 0;
    });
    return {
      items: items.map((row) => ({
        approval_id: row.id,
        tool_id: row.tool_id,
        action: row.action,
        tier: row.tier,
        steps: row.steps,
        created_at: row.created_at,
        requester_id: row.requester_id,
        ...((row.summary ?? {}) as Record<string, unknown>),
      })),
    };
  });

  const decide = async (
    request: FastifyRequest,
    reply: FastifyReply,
    decision: 'approve' | 'reject',
  ) => {
    const user = await state.currentUser(request);
    if (!user) return reply.code(401).send({ error: 'Sign in to continue.' });
    if (!state.verifyCsrf(request)) {
      return reply.code(403).send({
        error: 'Refresh the page and try again. The security token is missing.',
      });
    }
    const body = z
      .object({
        stepIndex: z.number().int().min(0).optional(),
        reason: z.string().max(500).optional(),
        decision: z.enum(['approve', 'reject']).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Choose a valid approval step.' });
    }
    const approvalId = (request.params as { id: string }).id;
    const found = await state.pool.query(
      'SELECT * FROM foundation.approval_requests WHERE id=$1',
      [approvalId],
    );
    const row = found.rows[0] as ApprovalRequestRecord | undefined;
    const registration = row && state.registrations.get(row.tool_id);
    if (!row || !registration || row.status !== 'pending') {
      return reply
        .code(409)
        .send({ error: 'This approval is no longer open.' });
    }
    const permission = approvalPermission(registration.tool, row.action);
    const authorized = await authorizeRequest(
      state,
      request,
      reply,
      registration.tool,
      permission,
    );
    if (!authorized) return;
    if (body.data.decision && body.data.decision !== decision) {
      return reply
        .code(400)
        .send({ error: 'The decision does not match the request.' });
    }
    const effectiveDecision = decision;
    const requestedStep = body.data.stepIndex;
    const stepIndex =
      requestedStep ?? nextApprovalStep(row.steps, authorized.roles);
    if (stepIndex < 0) {
      return reply
        .code(403)
        .send({ error: 'Your role is not allowed for this approval step.' });
    }
    try {
      const result = await transaction(state.pool, async (client) => {
        const locked = await client.query(
          `SELECT *,expires_at <= now() AS expired
           FROM foundation.approval_requests WHERE id=$1 FOR UPDATE`,
          [approvalId],
        );
        const approval = locked.rows[0] as
          (ApprovalRequestRecord & { expired: boolean }) | undefined;
        if (!approval || approval.status !== 'pending') {
          throw new HttpError('This approval is no longer open.', 409);
        }
        if (approval.expired) {
          throw new HttpError('This approval has expired.', 409);
        }
        if (approval.requester_id === authorized.id) {
          await appendAudit(client, {
            toolId: approval.tool_id,
            actorId: authorized.id,
            actorRoles: authorized.roles,
            action: 'approval.self_approval_denied',
            objectType: 'approval_request',
            objectId: approvalId,
            result: 'denied',
            requestId: request.id,
            sourceIp: request.ip,
            userAgent: request.headers['user-agent'],
          });
          return { denied: true as const };
        }
        const steps = approval.steps;
        const step = steps[stepIndex];
        const role = step?.roles.find((candidate) =>
          authorized.roles.includes(candidate),
        );
        if (!step || !role) {
          throw new HttpError(
            'Your role is not allowed for this approval step.',
            403,
          );
        }
        if (
          steps
            .slice(0, stepIndex)
            .some((previous) => previous.approvals.length === 0)
        ) {
          throw new HttpError(
            'Complete the earlier approval steps first.',
            409,
          );
        }
        if (
          steps.some((item) =>
            item.approvals.some((entry) => entry.userId === authorized.id),
          )
        ) {
          throw new HttpError('You have already approved this request.', 409);
        }
        if (step.approvals.length) {
          throw new HttpError('This approval step is already complete.', 409);
        }
        await client.query(
          `INSERT INTO foundation.approvals(
             approval_request_id,step_index,approver_id,approver_role,decision,reason
           ) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            approvalId,
            stepIndex,
            authorized.id,
            role,
            effectiveDecision,
            body.data.reason ?? null,
          ],
        );
        step.approvals = [{ userId: authorized.id, role }];
        const finalDecision =
          effectiveDecision === 'reject' ||
          steps.every((item) => item.approvals.length > 0);
        const status =
          effectiveDecision === 'reject'
            ? 'rejected'
            : finalDecision
              ? 'approved'
              : 'pending';
        await client.query(
          `UPDATE foundation.approval_requests SET steps=$2,status=$3,
             decided_at=CASE WHEN $3='pending' THEN NULL ELSE now() END
           WHERE id=$1`,
          [approvalId, JSON.stringify(steps), status],
        );
        if (finalDecision) {
          const context = approvalContext(
            state,
            request,
            client,
            registration,
            authorized,
          );
          await registration.approvalHandlers?.[approval.action]?.(
            context,
            { ...approval, steps, status },
            effectiveDecision,
          );
        }
        await appendAudit(client, {
          toolId: approval.tool_id,
          actorId: authorized.id,
          actorRoles: authorized.roles,
          action:
            effectiveDecision === 'approve'
              ? 'approval.approved'
              : 'approval.rejected',
          objectType: 'approval_request',
          objectId: approvalId,
          before: { status: approval.status },
          after: { decision: effectiveDecision, stepIndex, status },
          requestId: request.id,
          sourceIp: request.ip,
          userAgent: request.headers['user-agent'],
        });
        return { denied: false as const, status };
      });
      if (result.denied) {
        return reply
          .code(403)
          .send({ error: 'You cannot approve a request that you submitted.' });
      }
      return { status: result.status };
    } catch (error) {
      return sendRouteError(request, reply, error);
    }
  };

  app.post('/api/approvals/:id/approve', async (request, reply) =>
    decide(request, reply, 'approve'),
  );
  app.post('/api/approvals/:id/reject', async (request, reply) =>
    decide(request, reply, 'reject'),
  );
}

export function configureFoundation(
  app: FastifyInstance,
  options: FoundationOptions,
) {
  if (states.has(app)) throw new Error('Foundation is already configured.');
  const state: RuntimeState = { ...options, registrations: new Map() };
  states.set(app, state);
  registerApprovalRoutes(app, state);
}

export function registerTool(
  app: FastifyInstance,
  registration: ToolRegistration,
) {
  const state = states.get(app);
  if (!state) throw new Error('Call configureFoundation before registerTool.');
  const { tool, routes } = registration;
  const missing = routes
    .filter(
      (route) =>
        !route.permission || !Object.hasOwn(tool.permissions, route.permission),
    )
    .map((route) => `${route.method} ${route.path}`);
  if (missing.length) {
    throw new Error(
      `Tool ${tool.id} routes require a declared permission: ${missing.join(', ')}`,
    );
  }
  if (state.registrations.has(tool.id)) {
    throw new Error(`Tool ${tool.id} is already registered.`);
  }
  state.registrations.set(tool.id, registration);
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (request, reply) =>
        runRegisteredRoute(state, registration, route, request, reply),
    });
  }
}

export function registeredTools(app: FastifyInstance): ToolRegistration[] {
  const state = states.get(app);
  return state ? [...state.registrations.values()] : [];
}
