import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import {
  authorize,
  checkIdempotency,
  hashAuditEvent,
  genesisHash,
  requestHash,
  type ToolDefinition,
} from '@internal-tools/foundation';
import { refundsTool } from '@internal-tools/refunds';
import {
  randomBytes,
  timingSafeEqual,
  createHash,
  createHmac,
} from 'node:crypto';
import {
  Configuration,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { z } from 'zod';
import { appendAudit } from './audit.js';
import { pool, transaction } from './db.js';
import { toolRegistry } from './tool-registry.js';

interface SessionUser {
  id: string;
  displayName: string;
  roles: string[];
}

type ApiRequest = FastifyRequest & { user?: SessionUser };

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.url',
      'req.body.customer_email',
      'req.body.note',
    ],
  },
  requestIdHeader: 'x-request-id',
});

const protectedPermissions: Record<string, string> = {
  'GET /api/charges': 'charge.search',
  'GET /api/charges/:id': 'charge.search',
  'POST /api/charges/:id/reveal-email': 'customer.reveal',
  'POST /api/refunds': 'refund.request',
  'GET /api/refunds': 'refund.read',
  'GET /api/refunds/:id': 'refund.read',
  'GET /api/approvals': 'refund.approve',
  'POST /api/approvals/:id/approve': 'refund.approve',
  'GET /api/exceptions': 'exception.resolve',
  'POST /api/exceptions/:id/resolve': 'exception.resolve',
  'GET /api/audit': 'audit.read',
  'GET /api/audit/verify': 'audit.read',
  'GET /api/dashboard': 'dashboard.read',
  'POST /api/admin/pause': 'execution.pause',
  'POST /api/reconciliation/run': 'exception.resolve',
  // <DEVIN-TOOL-PERMISSIONS>
};

server.addHook('onRoute', (route) => {
  if (!route.url.startsWith('/api/')) return;
  const routeKey = `${route.method === 'HEAD' ? 'GET' : route.method} ${route.url}`;
  if (
    [
      'GET /api/session',
      'POST /api/logout',
      'POST /api/webhooks/simulator',
      'GET /api/registry',
    ].includes(routeKey)
  )
    return;
  const permission = protectedPermissions[routeKey];
  if (!permission)
    throw new Error(`API route ${route.method} ${route.url} has no permission`);
  const routeTool = route.url.startsWith('/api/tools/')
    ? toolRegistry.find(
        (tool) => tool.id === route.url.slice('/api/tools/'.length),
      )
    : undefined;
  const existing = route.preHandler;
  route.preHandler = [
    async (request, reply) => {
      await requirePermission(
        request as ApiRequest,
        reply,
        permission,
        routeTool ?? refundsTool,
      );
    },
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  ];
});

await server.register(cookie);
await server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
});
await server.register(rateLimit, { max: 200, timeWindow: '1 minute' });
await server.register(rawBody, {
  field: 'rawBody',
  global: false,
  encoding: false,
  runFirst: true,
});

const cookieName =
  process.env.COOKIE_NAME ??
  (process.env.NODE_ENV === 'production' ? '__Host-sid' : 'sid');
const sessionSecret =
  process.env.SESSION_SECRET ?? 'local-session-secret-change-before-deploy';
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set outside local development.');
}
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.OIDC_CLIENT_SECRET || !process.env.WEBHOOK_SECRET)
) {
  throw new Error(
    'OIDC_CLIENT_SECRET and WEBHOOK_SECRET must be set outside local development.',
  );
}
const rolesByGroup: Record<string, string> = {
  'refund-agent': 'agent',
  'refund-supervisor': 'supervisor',
  'refund-finance': 'finance',
  auditor: 'auditor',
  'platform-admin': 'platform_admin',
};
const oidcClientId = process.env.OIDC_CLIENT_ID ?? 'internal-tools';
const oidcClientSecret =
  process.env.OIDC_CLIENT_SECRET ?? 'local-client-secret';
const oidcIssuer =
  process.env.OIDC_ISSUER ?? 'http://localhost:8080/realms/internal-tools';
const oidcRedirectUri =
  process.env.OIDC_REDIRECT_URI ?? 'http://localhost:3000/auth/callback';
const pendingAuth = new Map<
  string,
  { verifier: string; nonce: string; createdAt: number }
>();
let oidcConfig: Awaited<ReturnType<typeof discovery>> | undefined;

async function discoverOidc() {
  const issuer = new URL(oidcIssuer);
  const allowLocalHttp =
    process.env.APP_ENV === 'LOCAL' && issuer.protocol === 'http:';
  const discovered = await discovery(
    issuer,
    oidcClientId,
    oidcClientSecret,
    undefined,
    allowLocalHttp ? { execute: [allowInsecureRequests] } : {},
  );
  const publicBase = process.env.OIDC_PUBLIC_BASE_URL;
  if (!allowLocalHttp || !publicBase) return discovered;

  const publicIssuer = new URL(issuer);
  const publicUrl = new URL(publicBase);
  publicIssuer.protocol = publicUrl.protocol;
  publicIssuer.host = publicUrl.host;
  const { supportsPKCE: _supportsPKCE, ...serverMetadata } =
    discovered.serverMetadata();
  void _supportsPKCE;
  const config = new Configuration(
    { ...serverMetadata, issuer: publicIssuer.href },
    oidcClientId,
    oidcClientSecret,
  );
  allowInsecureRequests(config);
  return config;
}

function parseGroups(groups: unknown): string[] {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((group) => rolesByGroup[String(group).replace(/^\//, '')])
    .filter((role): role is string => Boolean(role));
}

function safeEqual(first: string, second: string): boolean {
  const left = Buffer.from(first);
  const right = Buffer.from(second);
  return left.length === right.length && timingSafeEqual(left, right);
}

function csrfToken(sessionId: string): string {
  const nonce = randomBytes(24).toString('base64url');
  const signature = createHmac('sha256', sessionSecret)
    .update(`${sessionId}.${nonce}`)
    .digest('base64url');
  return `${nonce}.${signature}`;
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

async function currentUser(
  request: ApiRequest,
): Promise<SessionUser | undefined> {
  if (request.user) return request.user;
  const sessionId = request.cookies[cookieName];
  if (!sessionId) return undefined;
  const result = await pool.query(
    `SELECT user_id, display_name, roles, created_at, last_activity_at
     FROM foundation.sessions WHERE id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const now = Date.now();
  if (
    now - new Date(row.last_activity_at).getTime() > 30 * 60_000 ||
    now - new Date(row.created_at).getTime() > 8 * 60 * 60_000
  ) {
    await pool.query('DELETE FROM foundation.sessions WHERE id = $1', [
      sessionId,
    ]);
    return undefined;
  }
  await pool.query(
    'UPDATE foundation.sessions SET last_activity_at = now() WHERE id = $1',
    [sessionId],
  );
  return { id: row.user_id, displayName: row.display_name, roles: row.roles };
}

async function requirePermission(
  request: ApiRequest,
  reply: FastifyReply,
  permission: string,
  tool: ToolDefinition = refundsTool,
) {
  const user = await currentUser(request);
  if (!user) {
    reply.code(401).send({ error: 'Sign in to continue.' });
    return undefined;
  }
  if (!authorize(user, permission, tool)) {
    try {
      await transaction((client) =>
        appendAudit(client, {
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
    reply
      .code(403)
      .send({ error: 'You do not have permission to perform this action.' });
    return undefined;
  }
  request.user = user;
  return user;
}

server.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0] ?? request.url;
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
    url !== '/api/webhooks/simulator' &&
    url !== '/auth/callback'
  ) {
    const sessionId = request.cookies[cookieName];
    const cookieToken = request.cookies.csrf;
    const headerToken = request.headers['x-csrf-token'];
    const [nonce, signature] = cookieToken?.split('.') ?? [];
    const expected =
      sessionId && nonce
        ? createHmac('sha256', sessionSecret)
            .update(`${sessionId}.${nonce}`)
            .digest('base64url')
        : '';
    if (
      !sessionId ||
      !nonce ||
      !signature ||
      !safeEqual(signature, expected) ||
      typeof headerToken !== 'string' ||
      !safeEqual(cookieToken!, headerToken)
    ) {
      return reply.code(403).send({
        error: 'Refresh the page and try again. The security token is missing.',
      });
    }
  }
});

server.get('/health/live', async () => ({ status: 'ok' }));
// <DEVIN-TOOL-ROUTES>
server.get('/health/ready', async (_request, reply) => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ready' };
  } catch {
    return reply.code(503).send({ status: 'unavailable' });
  }
});

server.get('/auth/login', async (request, reply) => {
  try {
    const now = Date.now();
    for (const [state, auth] of pendingAuth) {
      if (now - auth.createdAt > 5 * 60_000) pendingAuth.delete(state);
    }
    oidcConfig ??= await discoverOidc();
    const verifier = randomPKCECodeVerifier();
    const nonce = randomNonce();
    const state = randomState();
    pendingAuth.set(state, { verifier, nonce, createdAt: Date.now() });
    const challenge = await calculatePKCECodeChallenge(verifier);
    const url = buildAuthorizationUrl(oidcConfig, {
      redirect_uri: oidcRedirectUri,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const publicBase = process.env.OIDC_PUBLIC_BASE_URL;
    if (publicBase) {
      const redirectUrl = new URL(url.href);
      const publicUrl = new URL(publicBase);
      redirectUrl.protocol = publicUrl.protocol;
      redirectUrl.host = publicUrl.host;
      return reply.redirect(redirectUrl.href);
    }
    return reply.redirect(url.href);
  } catch (error) {
    request.log.error({ error }, 'OIDC sign-in could not start');
    return reply
      .code(503)
      .send({ error: 'Sign-in service is not ready. Try again shortly.' });
  }
});

server.get('/auth/callback', async (request, reply) => {
  const state = (request.query as { state?: string }).state;
  const auth = state ? pendingAuth.get(state) : undefined;
  if (!auth) {
    return reply.code(400).send({ error: 'Sign-in expired. Start again.' });
  }
  pendingAuth.delete(state!);
  if (Date.now() - auth.createdAt > 5 * 60_000) {
    return reply.code(400).send({ error: 'Sign-in expired. Start again.' });
  }
  try {
    oidcConfig ??= await discoverOidc();
    const tokens = await authorizationCodeGrant(
      oidcConfig,
      new URL(request.url, oidcRedirectUri),
      {
        pkceCodeVerifier: auth.verifier,
        expectedState: state,
        expectedNonce: auth.nonce,
      },
    );
    const claims = tokens.claims();
    if (!claims?.sub) {
      return reply
        .code(401)
        .send({ error: 'Sign-in did not include a valid user subject.' });
    }
    const roles = parseGroups(claims.groups);
    const userId = String(claims.preferred_username ?? claims.sub);
    const displayName = String(claims.name ?? userId);
    const sessionId = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO foundation.sessions(id,user_id,display_name,roles) VALUES($1,$2,$3,$4)`,
      [sessionId, userId, displayName, roles],
    );
    reply.setCookie(cookieName, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    reply.setCookie('csrf', csrfToken(sessionId), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    });
    await transaction((client) =>
      appendAudit(client, {
        actorId: userId,
        actorRoles: roles,
        action: 'auth.sign_in',
        objectType: 'session',
        objectId: sessionId,
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    );
    return reply.redirect('/');
  } catch (error) {
    request.log.error({ error }, 'OIDC callback failed');
    return reply
      .code(401)
      .send({ error: 'Sign-in failed. Check your account and try again.' });
  }
});

server.get('/api/session', async (request) => {
  const user = await currentUser(request as ApiRequest);
  return user
    ? { authenticated: true, user, environment: process.env.APP_ENV ?? 'LOCAL' }
    : { authenticated: false, environment: process.env.APP_ENV ?? 'LOCAL' };
});

server.post('/api/logout', async (request, reply) => {
  const user = await currentUser(request as ApiRequest);
  const sessionId = request.cookies[cookieName];
  if (sessionId) {
    await pool.query('DELETE FROM foundation.sessions WHERE id = $1', [
      sessionId,
    ]);
    if (user) {
      await transaction((client) =>
        appendAudit(client, {
          actorId: user.id,
          actorRoles: user.roles,
          action: 'auth.sign_out',
          objectType: 'session',
          objectId: sessionId,
          requestId: request.id,
          sourceIp: request.ip,
          userAgent: request.headers['user-agent'],
        }),
      );
    }
  }
  reply.clearCookie(cookieName, { path: '/' });
  reply.clearCookie('csrf', { path: '/' });
  return { ok: true };
});

const SearchDate = z
  .string()
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  );

const ChargeQuery = z.object({
  q: z.string().trim().max(128).optional(),
  from: SearchDate.optional(),
  to: SearchDate.optional(),
  minMinor: z
    .string()
    .regex(/^\d{1,13}$/)
    .optional(),
  maxMinor: z
    .string()
    .regex(/^\d{1,13}$/)
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

server.get('/api/charges', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'charge.search',
  );
  if (!user) return;
  const parsed = ChargeQuery.safeParse(request.query);
  if (!parsed.success)
    return reply.code(400).send({ error: 'Search filters are not valid.' });
  const { q, from, to, minMinor, maxMinor, limit, cursor } = parsed.data;
  const values: unknown[] = [];
  const filters: string[] = [];
  if (q) {
    values.push(`%${q}%`);
    filters.push(
      `(id ILIKE $${values.length} OR customer_id ILIKE $${values.length} OR customer_email ILIKE $${values.length} OR card_last4 ILIKE $${values.length})`,
    );
  }
  if (from) {
    values.push(from);
    filters.push(`created_at >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`created_at < ($${values.length}::date + interval '1 day')`);
  }
  if (minMinor) {
    values.push(minMinor);
    filters.push(`amount_minor >= $${values.length}::bigint`);
  }
  if (maxMinor) {
    values.push(maxMinor);
    filters.push(`amount_minor <= $${values.length}::bigint`);
  }
  if (cursor) {
    const [createdAt, id] = cursor.split('~');
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
      return reply
        .code(400)
        .send({ error: 'The search page token is not valid.' });
    }
    values.push(createdAt, id);
    filters.push(
      `(created_at,id) < ($${values.length - 1}::timestamptz,$${values.length})`,
    );
  }
  values.push(limit + 1);
  const results = await pool.query(
    `SELECT id, customer_id, customer_email, card_brand, card_last4, amount_minor::text,
            currency, refunded_minor::text, created_at
     FROM refunds.charges ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
    values,
  );
  const hasMore = results.rows.length > limit;
  const charges = results.rows.slice(0, limit).map((row) => ({
    ...row,
    customer_email: '••••••••',
  }));
  const last = charges.at(-1);
  const nextCursor =
    hasMore && last
      ? `${new Date(last.created_at).toISOString()}~${last.id}`
      : null;
  return { items: charges, nextCursor };
});

server.post('/api/charges/:id/reveal-email', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'customer.reveal',
  );
  if (!user) return;
  const { id } = request.params as { id: string };
  const result = await pool.query(
    'SELECT customer_email FROM refunds.charges WHERE id=$1',
    [id],
  );
  if (!result.rows[0])
    return reply.code(404).send({ error: 'Payment not found.' });
  await transaction((client) =>
    appendAudit(client, {
      actorId: user.id,
      actorRoles: user.roles,
      action: 'customer.email_revealed',
      objectType: 'charge',
      objectId: id,
      after: { fields: ['customer_email'] },
      requestId: request.id,
      sourceIp: request.ip,
      userAgent: request.headers['user-agent'],
    }),
  );
  return { customerEmail: result.rows[0].customer_email };
});

server.get('/api/charges/:id', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'charge.search',
  );
  if (!user) return;
  const { id } = request.params as { id: string };
  const result = await pool.query(
    `SELECT id, customer_id, customer_email, card_brand, card_last4, amount_minor::text,
            currency, refunded_minor::text, created_at FROM refunds.charges WHERE id=$1`,
    [id],
  );
  if (!result.rows[0])
    return reply.code(404).send({ error: 'Payment not found.' });
  const charge = result.rows[0];
  charge.customer_email = '••••••••';
  const refunds = await pool.query(
    `SELECT id, amount_minor::text, currency, reason_code, status, tier, requester_id, created_at
     FROM refunds.refunds WHERE charge_id=$1 ORDER BY created_at DESC`,
    [id],
  );
  return {
    ...charge,
    refundable_minor: (
      BigInt(charge.amount_minor) - BigInt(charge.refunded_minor)
    ).toString(),
    refunds: refunds.rows,
  };
});

const RefundInput = z.object({
  chargeId: z.string().min(1).max(64),
  amountMinor: z.string().regex(/^[1-9]\d{0,12}$/),
  reasonCode: z.enum([
    'service_issue',
    'duplicate',
    'fraud_review',
    'goodwill',
    'other',
  ]),
  note: z.string().trim().min(10).max(1000),
});

server.post('/api/refunds', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'refund.request',
  );
  if (!user) return;
  const parsed = RefundInput.safeParse(request.body);
  if (!parsed.success)
    return reply
      .code(400)
      .send({ error: 'Enter a valid amount, reason, and note.' });
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 16 || key.length > 200) {
    return reply
      .code(400)
      .send({ error: 'Submit again with a valid request key.' });
  }
  const input = parsed.data;
  const bodyHash = requestHash(input);
  try {
    const refund = await transaction(async (client) => {
      const lock = await client.query(
        'SELECT id, amount_minor::text, refunded_minor::text, currency FROM refunds.charges WHERE id=$1 FOR UPDATE',
        [input.chargeId],
      );
      const charge = lock.rows[0];
      if (!charge)
        throw Object.assign(new Error('Payment not found.'), {
          statusCode: 404,
        });
      const keyInsert = await client.query(
        `INSERT INTO foundation.idempotency_keys(actor_id,route,key,request_hash)
         VALUES($1,'refund.create',$2,$3) ON CONFLICT DO NOTHING RETURNING key`,
        [user.id, key, bodyHash],
      );
      if (!keyInsert.rowCount) {
        const existing = await client.query(
          `SELECT request_hash,response_code,response_body FROM foundation.idempotency_keys
           WHERE actor_id=$1 AND route='refund.create' AND key=$2`,
          [user.id, key],
        );
        const check = checkIdempotency(
          existing.rows[0]?.request_hash,
          bodyHash,
          Boolean(existing.rows[0]?.response_body),
        );
        if (check.action === 'conflict')
          throw Object.assign(
            new Error('This request key was used with different details.'),
            { statusCode: 422 },
          );
        if (check.action === 'replay')
          return { replay: existing.rows[0].response_body };
        throw Object.assign(
          new Error(
            'This request is still being processed. Try again shortly.',
          ),
          { statusCode: 409 },
        );
      }
      const amount = BigInt(input.amountMinor);
      const remaining =
        BigInt(charge.amount_minor) - BigInt(charge.refunded_minor);
      if (amount > remaining)
        throw new Error('Amount exceeds refundable balance.');
      if (charge.currency !== 'USD')
        throw new Error('Refund currency must match the payment currency.');
      const autoLimit = 25_000n;
      const supervisorLimit = 500_000n;
      const tier =
        amount <= autoLimit
          ? 'auto'
          : amount <= supervisorLimit
            ? 'supervisor'
            : 'dual';
      if (tier === 'dual' && !user.roles.includes('supervisor')) {
        throw Object.assign(
          new Error('Only a Supervisor can request a refund above $5,000.'),
          { statusCode: 403 },
        );
      }
      if (tier === 'auto') {
        const daily = await client.query(
          `INSERT INTO refunds.agent_daily_totals(agent_id,day,auto_minor) VALUES($1,current_date,$2)
           ON CONFLICT(agent_id,day) DO UPDATE SET auto_minor=refunds.agent_daily_totals.auto_minor + EXCLUDED.auto_minor
           WHERE refunds.agent_daily_totals.auto_minor + EXCLUDED.auto_minor <= 200000
           RETURNING auto_minor`,
          [user.id, amount.toString()],
        );
        if (!daily.rowCount)
          throw new Error(
            'This request exceeds the daily instant-refund limit.',
          );
      }
      await client.query(
        'UPDATE refunds.charges SET refunded_minor=refunded_minor+$2::bigint WHERE id=$1',
        [input.chargeId, amount.toString()],
      );
      const status = tier === 'auto' ? 'approved' : 'pending_approval';
      const steps =
        tier === 'auto'
          ? []
          : tier === 'supervisor'
            ? [['supervisor']]
            : [['supervisor'], ['finance']];
      const contentHash = createHash('sha256')
        .update(JSON.stringify(input))
        .digest('hex');
      const inserted = await client.query(
        `INSERT INTO refunds.refunds(charge_id,amount_minor,currency,reason_code,note,requester_id,status,tier,policy_version)
         VALUES($1,$2::bigint,$3,$4,$5,$6,$7,$8,1)
         RETURNING id,charge_id,amount_minor::text,currency,reason_code,note,requester_id,status,tier,created_at`,
        [
          input.chargeId,
          amount.toString(),
          charge.currency,
          input.reasonCode,
          input.note,
          user.id,
          status,
          tier,
        ],
      );
      const row = inserted.rows[0];
      if (status === 'pending_approval') {
        const approval = await client.query(
          `INSERT INTO foundation.approval_requests(tool_id,action,object_type,object_id,requester_id,tier,
           policy_version,content_hash,steps,status,expires_at)
           VALUES('refunds','refund.execute','refund',$1,$2,$3,1,$4,$5,'pending',now()+interval '72 hours')
           RETURNING id`,
          [
            row.id,
            user.id,
            tier,
            contentHash,
            JSON.stringify(
              steps.map((roles: string[]) => ({ roles, approvals: [] })),
            ),
          ],
        );
        await client.query(
          'UPDATE refunds.refunds SET approval_request_id=$2 WHERE id=$1',
          [row.id, approval.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO foundation.outbox(tool_id,kind,payload,idempotency_key,status)
           VALUES('refunds','refund.execute',$1,$2,'pending')`,
          [JSON.stringify({ refundId: row.id }), row.id],
        );
      }
      await appendAudit(client, {
        actorId: user.id,
        actorRoles: user.roles,
        action: 'refund.requested',
        objectType: 'refund',
        objectId: row.id,
        after: { amountMinor: amount.toString(), status, tier },
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      });
      const response = {
        ...row,
        amount_minor: amount.toString(),
        approvalSteps: steps,
      };
      await client.query(
        `UPDATE foundation.idempotency_keys SET response_code=201,response_body=$4
         WHERE actor_id=$1 AND route='refund.create' AND key=$2 AND request_hash=$3`,
        [user.id, key, bodyHash, JSON.stringify(response)],
      );
      return { refund: response };
    });
    return refund.replay ? refund.replay : reply.code(201).send(refund.refund);
  } catch (error) {
    const cause = error as Error & { statusCode?: number };
    const status =
      cause.statusCode ?? (cause.message.includes('exceeds') ? 409 : 400);
    return reply.code(status).send({ error: cause.message });
  }
});

server.get('/api/refunds', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'refund.read',
  );
  if (!user) return;
  if ((request.query as { format?: string }).format === 'csv') {
    if (!authorize(user, 'refund.export', refundsTool)) {
      return reply
        .code(403)
        .send({ error: 'You do not have permission to export refunds.' });
    }
    const exported = await pool.query(
      `SELECT r.id,r.charge_id,r.amount_minor::text,r.currency,r.reason_code,r.status,r.tier,
              r.requester_id,r.created_at FROM refunds.refunds r ORDER BY r.created_at DESC LIMIT 10000`,
    );
    await transaction((client) =>
      appendAudit(client, {
        actorId: user.id,
        actorRoles: user.roles,
        action: 'refund.exported',
        objectType: 'refund_export',
        objectId: request.id,
        after: { rowCount: exported.rowCount },
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    );
    const columns = [
      'id',
      'charge_id',
      'amount_minor',
      'currency',
      'reason_code',
      'status',
      'tier',
      'requester_id',
      'created_at',
    ];
    reply.type('text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="refunds.csv"');
    return [
      columns,
      ...exported.rows.map((row) => columns.map((key) => row[key])),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
  }
  const result = await pool.query(
    `SELECT r.id,r.charge_id,r.amount_minor::text,r.currency,r.reason_code,r.status,r.tier,
            r.requester_id,r.created_at,a.id AS approval_id
     FROM refunds.refunds r LEFT JOIN foundation.approval_requests a ON a.id=r.approval_request_id
     ORDER BY r.created_at DESC LIMIT 100`,
  );
  return { items: result.rows };
});

server.get('/api/approvals', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'refund.approve',
  );
  if (!user) return;
  const result = await pool.query(
    `SELECT a.id AS approval_id,a.tier,a.steps,a.created_at,r.id AS refund_id,r.charge_id,
            r.amount_minor::text,r.currency,r.reason_code,r.note,r.requester_id,r.status
     FROM foundation.approval_requests a JOIN refunds.refunds r ON r.id::text=a.object_id
     WHERE a.tool_id='refunds' AND a.status='pending'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(a.steps) WITH ORDINALITY AS candidate(step,step_number)
         WHERE jsonb_array_length(candidate.step->'approvals')=0
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(a.steps) WITH ORDINALITY AS previous(step,step_number)
             WHERE previous.step_number<candidate.step_number
               AND jsonb_array_length(previous.step->'approvals')=0
           )
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(candidate.step->'roles') AS allowed(role)
             WHERE allowed.role=ANY($1::text[])
           )
       )
     ORDER BY a.created_at ASC`,
    [user.roles],
  );
  return { items: result.rows };
});

server.post('/api/approvals/:id/approve', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'refund.approve',
  );
  if (!user) return;
  const body = z
    .object({
      stepIndex: z.number().int().min(0),
      decision: z.enum(['approve', 'reject']).default('approve'),
      reason: z.string().max(500).optional(),
    })
    .safeParse(request.body);
  if (!body.success)
    return reply.code(400).send({ error: 'Choose a valid approval step.' });
  const approvalId = (request.params as { id: string }).id;
  try {
    const result = await transaction(async (client) => {
      const found = await client.query(
        'SELECT * FROM foundation.approval_requests WHERE id=$1 FOR UPDATE',
        [approvalId],
      );
      const approval = found.rows[0];
      if (!approval || approval.status !== 'pending')
        throw Object.assign(new Error('This approval is no longer open.'), {
          statusCode: 409,
        });
      if (approval.requester_id === user.id) {
        await appendAudit(client, {
          actorId: user.id,
          actorRoles: user.roles,
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
      const steps = approval.steps as Array<{
        roles: string[];
        approvals: Array<{ userId: string; role: string }>;
      }>;
      const step = steps[body.data.stepIndex];
      const role = step?.roles.find((candidate) =>
        user.roles.includes(candidate),
      );
      if (!step || !role)
        throw Object.assign(
          new Error('Your role is not allowed for this approval step.'),
          { statusCode: 403 },
        );
      if (
        steps
          .slice(0, body.data.stepIndex)
          .some((previous) => !previous.approvals.length)
      ) {
        throw Object.assign(
          new Error('Complete the earlier approval steps first.'),
          { statusCode: 409 },
        );
      }
      const prior = await client.query(
        'SELECT 1 FROM foundation.approvals WHERE approval_request_id=$1 AND approver_id=$2',
        [approvalId, user.id],
      );
      if (prior.rowCount)
        throw Object.assign(
          new Error('You have already approved this request.'),
          { statusCode: 409 },
        );
      const decision = body.data.decision;
      await client.query(
        `INSERT INTO foundation.approvals(approval_request_id,step_index,approver_id,approver_role,decision,reason)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          approvalId,
          body.data.stepIndex,
          user.id,
          role,
          decision,
          body.data.reason ?? null,
        ],
      );
      if (decision === 'reject') {
        await client.query(
          "UPDATE foundation.approval_requests SET status='rejected',decided_at=now() WHERE id=$1",
          [approvalId],
        );
        await client.query(
          "UPDATE refunds.refunds SET status='rejected' WHERE id::text=$1",
          [approval.object_id],
        );
      } else {
        steps[body.data.stepIndex]!.approvals = [{ userId: user.id, role }];
        await client.query(
          'UPDATE foundation.approval_requests SET steps=$2 WHERE id=$1',
          [approvalId, JSON.stringify(steps)],
        );
        if (steps.every((item) => item.approvals.length > 0)) {
          await client.query(
            "UPDATE foundation.approval_requests SET status='approved',decided_at=now() WHERE id=$1",
            [approvalId],
          );
          await client.query(
            "UPDATE refunds.refunds SET status='approved' WHERE id::text=$1",
            [approval.object_id],
          );
          await client.query(
            `INSERT INTO foundation.outbox(tool_id,kind,payload,idempotency_key,status)
             VALUES('refunds','refund.execute',$1,$2,'pending') ON CONFLICT DO NOTHING`,
            [
              JSON.stringify({ refundId: approval.object_id }),
              approval.object_id,
            ],
          );
        }
      }
      await appendAudit(client, {
        actorId: user.id,
        actorRoles: user.roles,
        action:
          decision === 'approve' ? 'approval.approved' : 'approval.rejected',
        objectType: 'approval_request',
        objectId: approvalId,
        before: { status: approval.status },
        after: { decision, stepIndex: body.data.stepIndex },
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      });
      await appendAudit(client, {
        actorId: user.id,
        actorRoles: user.roles,
        action: 'refund.approval_recorded',
        objectType: 'refund',
        objectId: approval.object_id,
        before: { status: 'pending_approval' },
        after: { decision, stepIndex: body.data.stepIndex },
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return { denied: false as const, status: decision };
    });
    if (result.denied)
      return reply
        .code(403)
        .send({ error: 'You cannot approve a request that you submitted.' });
    return result;
  } catch (error) {
    const cause = error as Error & { statusCode?: number };
    return reply.code(cause.statusCode ?? 400).send({ error: cause.message });
  }
});

server.get('/api/refunds/:id', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'refund.read',
  );
  if (!user) return;
  const { id } = request.params as { id: string };
  const result = await pool.query(
    `SELECT r.*, r.amount_minor::text FROM refunds.refunds r WHERE r.id=$1`,
    [id],
  );
  if (!result.rows[0])
    return reply.code(404).send({ error: 'Refund not found.' });
  const audit = await pool.query(
    `SELECT event_data FROM foundation.audit_events WHERE object_type='refund' AND object_id=$1 ORDER BY seq`,
    [id],
  );
  return {
    ...result.rows[0],
    timeline: audit.rows.map((row) => row.event_data),
  };
});

server.post('/api/reconciliation/run', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'exception.resolve',
  );
  if (!user) return;
  const jobId = randomBytes(16).toString('hex');
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO foundation.outbox(tool_id,kind,payload,idempotency_key,status)
       VALUES('refunds','reconciliation.run',$1,$2,'pending')`,
      [JSON.stringify({ requestedBy: user.id }), `reconciliation:${jobId}`],
    );
    await appendAudit(client, {
      actorId: user.id,
      actorRoles: user.roles,
      action: 'reconciliation.started',
      objectType: 'tool',
      objectId: 'refunds',
      requestId: request.id,
      sourceIp: request.ip,
      userAgent: request.headers['user-agent'],
    });
  });
  return reply.code(202).send({ queued: true });
});

server.get('/api/exceptions', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'exception.resolve',
  );
  if (!user) return;
  const result = await pool.query(
    'SELECT * FROM refunds.reconciliation_exceptions WHERE status=$1 ORDER BY created_at ASC LIMIT 100',
    [
      (request.query as { status?: string }).status === 'resolved'
        ? 'resolved'
        : 'open',
    ],
  );
  return { items: result.rows };
});

server.post('/api/exceptions/:id/resolve', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'exception.resolve',
  );
  if (!user) return;
  const body = z
    .object({
      resolutionCode: z.string().trim().min(2).max(64),
      note: z.string().trim().min(10).max(1000),
    })
    .safeParse(request.body);
  if (!body.success)
    return reply.code(400).send({ error: 'Enter a resolution code and note.' });
  const id = (request.params as { id: string }).id;
  try {
    await transaction(async (client) => {
      const before = await client.query(
        'SELECT status FROM refunds.reconciliation_exceptions WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!before.rowCount)
        throw Object.assign(new Error('Reconciliation exception not found.'), {
          statusCode: 404,
        });
      if (before.rows[0].status !== 'open')
        throw Object.assign(new Error('This exception is already resolved.'), {
          statusCode: 409,
        });
      await client.query(
        `UPDATE refunds.reconciliation_exceptions SET status='resolved',resolution_code=$2,resolution_note=$3,
         resolved_by=$4,resolved_at=now() WHERE id=$1`,
        [id, body.data.resolutionCode, body.data.note, user.id],
      );
      await appendAudit(client, {
        actorId: user.id,
        actorRoles: user.roles,
        action: 'reconciliation.exception_resolved',
        objectType: 'reconciliation_exception',
        objectId: id,
        before: before.rows[0],
        after: { status: 'resolved', ...body.data },
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      });
    });
  } catch (error) {
    const cause = error as Error & { statusCode?: number };
    return reply.code(cause.statusCode ?? 500).send({
      error: cause.statusCode
        ? cause.message
        : 'The exception could not be resolved.',
    });
  }
  return { ok: true };
});

server.get('/api/audit', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'audit.read',
  );
  if (!user) return;
  const result = await pool.query(
    "SELECT seq,event_data,encode(hash,'hex') AS hash FROM foundation.audit_events ORDER BY seq DESC LIMIT 100",
  );
  if ((request.query as { format?: string }).format === 'csv') {
    await transaction((client) =>
      appendAudit(client, {
        actorId: user.id,
        actorRoles: user.roles,
        action: 'audit.exported',
        objectType: 'audit_export',
        objectId: request.id,
        after: { rowCount: result.rowCount },
        requestId: request.id,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    );
    const columns = ['seq', 'event_data', 'hash'];
    reply.type('text/csv; charset=utf-8');
    reply.header(
      'content-disposition',
      'attachment; filename="audit-events.csv"',
    );
    return [
      columns,
      ...result.rows.map((row) => columns.map((key) => row[key])),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
  }
  return { items: result.rows };
});

server.get('/api/audit/verify', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'audit.read',
  );
  if (!user) return;
  const result = await pool.query(
    'SELECT event_data,prev_hash,hash FROM foundation.audit_events ORDER BY seq',
  );
  let previous = genesisHash();
  for (const row of result.rows) {
    const expected = hashAuditEvent(previous, row.event_data);
    if (!row.prev_hash.equals(previous) || !row.hash.equals(expected)) {
      return { valid: false, firstBrokenEventId: row.event_data.id };
    }
    previous = row.hash;
  }
  return {
    valid: true,
    eventCount: result.rowCount,
    verifiedAt: new Date().toISOString(),
  };
});

server.get('/api/dashboard', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'dashboard.read',
  );
  if (!user) return;
  const [states, approvals, exceptions, setting] = await Promise.all([
    pool.query(
      'SELECT status,count(*)::int AS count FROM refunds.refunds GROUP BY status',
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM foundation.approval_requests WHERE status='pending'",
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM refunds.reconciliation_exceptions WHERE status='open'",
    ),
    pool.query(
      "SELECT execution_paused FROM foundation.tool_settings WHERE tool_id='refunds'",
    ),
  ]);
  return {
    states: states.rows,
    pendingApprovals: approvals.rows[0]?.count ?? 0,
    openExceptions: exceptions.rows[0]?.count ?? 0,
    executionPaused: setting.rows[0]?.execution_paused ?? false,
  };
});

server.post('/api/admin/pause', async (request, reply) => {
  const user = await requirePermission(
    request as ApiRequest,
    reply,
    'execution.pause',
  );
  if (!user) return;
  const parsed = z.object({ paused: z.boolean() }).safeParse(request.body);
  if (!parsed.success)
    return reply.code(400).send({ error: 'Choose pause or resume.' });
  await transaction(async (client) => {
    await client.query(
      `UPDATE foundation.tool_settings SET execution_paused=$1,changed_by=$2,changed_at=now() WHERE tool_id='refunds'`,
      [parsed.data.paused, user.id],
    );
    await appendAudit(client, {
      actorId: user.id,
      actorRoles: user.roles,
      action: parsed.data.paused ? 'execution.paused' : 'execution.resumed',
      objectType: 'tool',
      objectId: 'refunds',
      after: { executionPaused: parsed.data.paused },
      requestId: request.id,
      sourceIp: request.ip,
      userAgent: request.headers['user-agent'],
    });
  });
  return { paused: parsed.data.paused };
});

server.get('/api/registry', async () => ({
  tools: toolRegistry.map((tool) => ({
    id: tool.id,
    name: tool.name,
    owner: tool.owner,
    dataClass: tool.dataClass,
    roles: Object.keys(tool.roles),
    permissions: tool.permissions,
  })),
}));

server.get('/metrics', async (_request, reply) => {
  const result = await pool.query(
    `SELECT (SELECT count(*) FROM foundation.outbox WHERE status='pending') AS outbox_depth,
     (SELECT count(*) FROM foundation.approval_requests WHERE status='pending') AS approvals_pending,
     (SELECT count(*) FROM refunds.reconciliation_exceptions WHERE status='open') AS exceptions_open,
     (SELECT execution_paused::int FROM foundation.tool_settings WHERE tool_id='refunds') AS execution_paused`,
  );
  const metrics = result.rows[0];
  reply.type('text/plain; version=0.0.4');
  return `# TYPE approvals_pending gauge\napprovals_pending{tool="refunds"} ${metrics.approvals_pending}\n# TYPE outbox_depth gauge\noutbox_depth{tool="refunds"} ${metrics.outbox_depth}\n# TYPE reconciliation_exceptions_open gauge\nreconciliation_exceptions_open{type="all"} ${metrics.exceptions_open}\n# TYPE execution_paused gauge\nexecution_paused{tool="refunds"} ${metrics.execution_paused}\n`;
});

server.post(
  '/api/webhooks/simulator',
  {
    config: { rawBody: true },
  },
  async (request, reply) => {
    const raw = (request as ApiRequest & { rawBody?: Buffer }).rawBody;
    if (!raw)
      return reply.code(400).send({ error: 'Webhook body is missing.' });
    const signature = request.headers['sim-signature'];
    const match =
      typeof signature === 'string' &&
      /^t=(\d+),v1=([a-f0-9]+)$/.exec(signature);
    if (!match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) {
      return reply
        .code(401)
        .send({ error: 'Webhook signature is invalid or expired.' });
    }
    const expected = createHmac(
      'sha256',
      process.env.WEBHOOK_SECRET ?? 'local-webhook-secret-change-before-deploy',
    )
      .update(`${match[1]}.${raw.toString('utf8')}`)
      .digest('hex');
    if (!safeEqual(match[2]!, expected))
      return reply.code(401).send({ error: 'Webhook signature is invalid.' });
    const payload = JSON.parse(raw.toString('utf8')) as {
      id: string;
      type: string;
    };
    await pool.query(
      `INSERT INTO foundation.inbound_events(provider,event_id,event_type,payload)
     VALUES('simulator',$1,$2,$3) ON CONFLICT DO NOTHING`,
      [payload.id, payload.type, JSON.stringify(payload)],
    );
    return reply.code(200).send({ received: true });
  },
);

server.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'Unhandled API error');
  return reply
    .code(500)
    .send({ error: 'The request could not be completed. Try again.' });
});

const port = Number(process.env.PORT ?? 3000);
await server.listen({ host: '0.0.0.0', port });
