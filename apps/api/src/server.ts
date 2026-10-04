import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import rawBody from 'fastify-raw-body';
import {
  appendAudit,
  authorize,
  configureFoundation,
  registerTool,
  verifyAuditChain,
  type FoundationUser,
} from '@internal-tools/foundation';
import {
  Configuration,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type pg from 'pg';
import { pool as defaultPool } from './db.js';
import { toolRegistry, toolRegistrations } from './tool-registry.js';
import { refundsTool } from '@internal-tools/refunds';

interface ApiRequest extends FastifyRequest {
  cookies: Record<string, string | undefined>;
}

export interface BuildServerOptions {
  pool?: pg.Pool;
  env?: NodeJS.ProcessEnv;
  logger?: boolean;
}

function safeEqual(first: string, second: string): boolean {
  const left = Buffer.from(first);
  const right = Buffer.from(second);
  return left.length === right.length && timingSafeEqual(left, right);
}

function csvCell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ''
      : typeof value === 'object' && !(value instanceof Date)
        ? JSON.stringify(value)
        : String(value);
  const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

async function inTransaction<T>(
  database: pg.Pool,
  run: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await database.connect();
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

export async function buildServer(options: BuildServerOptions = {}) {
  const env = options.env ?? process.env;
  const database = options.pool ?? defaultPool;
  const server = Fastify({
    logger: options.logger ?? {
      level: env.LOG_LEVEL ?? 'info',
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
    env.COOKIE_NAME ?? (env.NODE_ENV === 'production' ? '__Host-sid' : 'sid');
  const sessionSecret =
    env.SESSION_SECRET ?? 'local-session-secret-change-before-deploy';
  if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set outside local development.');
  }
  if (
    env.NODE_ENV === 'production' &&
    (!env.OIDC_CLIENT_SECRET || !env.WEBHOOK_SECRET)
  ) {
    throw new Error(
      'OIDC_CLIENT_SECRET and WEBHOOK_SECRET must be set outside local development.',
    );
  }

  const rolesByGroup: Record<string, string[]> = {};
  for (const tool of toolRegistry) {
    for (const [role, { idpGroup }] of Object.entries(tool.roles)) {
      rolesByGroup[idpGroup] = [...(rolesByGroup[idpGroup] ?? []), role];
    }
  }
  const parseGroups = (groups: unknown): string[] =>
    Array.isArray(groups)
      ? [
          ...new Set(
            groups.flatMap(
              (group) => rolesByGroup[String(group).replace(/^\//, '')] ?? [],
            ),
          ),
        ]
      : [];

  const oidcClientId = env.OIDC_CLIENT_ID ?? 'internal-tools';
  const oidcClientSecret = env.OIDC_CLIENT_SECRET ?? 'local-client-secret';
  const oidcIssuer =
    env.OIDC_ISSUER ?? 'http://localhost:8080/realms/internal-tools';
  const oidcRedirectUri =
    env.OIDC_REDIRECT_URI ?? 'http://localhost:3000/auth/callback';
  const pendingAuth = new Map<
    string,
    { verifier: string; nonce: string; createdAt: number }
  >();
  let oidcConfig: Awaited<ReturnType<typeof discovery>> | undefined;

  const publicOidcUrl = (url: URL) => {
    const publicBase = env.OIDC_PUBLIC_BASE_URL;
    if (!publicBase) return url;
    const rewritten = new URL(url.href);
    const publicUrl = new URL(publicBase);
    rewritten.protocol = publicUrl.protocol;
    rewritten.host = publicUrl.host;
    return rewritten;
  };
  const discoverOidc = async () => {
    const issuer = new URL(oidcIssuer);
    const allowLocalHttp =
      env.APP_ENV === 'LOCAL' && issuer.protocol === 'http:';
    const discovered = await discovery(
      issuer,
      oidcClientId,
      oidcClientSecret,
      undefined,
      allowLocalHttp ? { execute: [allowInsecureRequests] } : {},
    );
    const publicBase = env.OIDC_PUBLIC_BASE_URL;
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
  };

  const csrfToken = (sessionId: string) => {
    const nonce = randomBytes(24).toString('base64url');
    const signature = createHmac('sha256', sessionSecret)
      .update(`${sessionId}.${nonce}`)
      .digest('base64url');
    return `${nonce}.${signature}`;
  };
  const verifyCsrf = (request: FastifyRequest) => {
    const apiRequest = request as ApiRequest;
    const sessionId = apiRequest.cookies[cookieName];
    const cookieToken = apiRequest.cookies.csrf;
    const headerToken = request.headers['x-csrf-token'];
    const [nonce, signature] = cookieToken?.split('.') ?? [];
    const expected =
      sessionId && nonce
        ? createHmac('sha256', sessionSecret)
            .update(`${sessionId}.${nonce}`)
            .digest('base64url')
        : '';
    return Boolean(
      sessionId &&
      nonce &&
      signature &&
      safeEqual(signature, expected) &&
      typeof headerToken === 'string' &&
      typeof cookieToken === 'string' &&
      safeEqual(cookieToken, headerToken),
    );
  };

  const currentUser = async (
    request: FastifyRequest,
  ): Promise<FoundationUser | undefined> => {
    const sessionId = (request as ApiRequest).cookies[cookieName];
    if (!sessionId) return undefined;
    const result = await database.query(
      `SELECT user_id,display_name,roles,created_at,last_activity_at
       FROM foundation.sessions WHERE id=$1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const now = Date.now();
    if (
      now - new Date(row.last_activity_at).getTime() > 30 * 60_000 ||
      now - new Date(row.created_at).getTime() > 8 * 60 * 60_000
    ) {
      await database.query('DELETE FROM foundation.sessions WHERE id=$1', [
        sessionId,
      ]);
      return undefined;
    }
    await database.query(
      'UPDATE foundation.sessions SET last_activity_at=now() WHERE id=$1',
      [sessionId],
    );
    return {
      id: row.user_id,
      displayName: row.display_name,
      roles: row.roles,
    };
  };

  configureFoundation(server, {
    pool: database,
    currentUser,
    verifyCsrf,
  });
  for (const registration of toolRegistrations) {
    registerTool(server, registration);
  }

  server.get('/health/live', async () => ({ status: 'ok' }));
  server.get('/health/ready', async (_request, reply) => {
    try {
      await database.query('SELECT 1');
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
      return reply.redirect(publicOidcUrl(url).href);
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
    if (!state || !auth) {
      return reply.code(400).send({ error: 'Sign-in expired. Start again.' });
    }
    pendingAuth.delete(state);
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
      await database.query(
        `INSERT INTO foundation.sessions(id,user_id,display_name,roles,id_token)
         VALUES($1,$2,$3,$4,$5)`,
        [sessionId, userId, displayName, roles, tokens.id_token ?? null],
      );
      reply.setCookie(cookieName, sessionId, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
      reply.setCookie('csrf', csrfToken(sessionId), {
        httpOnly: false,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 8 * 60 * 60,
      });
      await inTransaction(database, (client) =>
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
    const user = await currentUser(request);
    return user
      ? { authenticated: true, user, environment: env.APP_ENV ?? 'LOCAL' }
      : { authenticated: false, environment: env.APP_ENV ?? 'LOCAL' };
  });

  server.post('/api/logout', async (request, reply) => {
    if (!verifyCsrf(request)) {
      return reply.code(403).send({
        error: 'Refresh the page and try again. The security token is missing.',
      });
    }
    const user = await currentUser(request);
    const sessionId = (request as ApiRequest).cookies[cookieName];
    let idToken: string | undefined;
    if (sessionId) {
      const deleted = await database.query<{ id_token: string | null }>(
        'DELETE FROM foundation.sessions WHERE id=$1 RETURNING id_token',
        [sessionId],
      );
      idToken = deleted.rows[0]?.id_token ?? undefined;
      if (user) {
        await inTransaction(database, (client) =>
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
    let logoutUrl: string | undefined;
    try {
      oidcConfig ??= await discoverOidc();
      logoutUrl = publicOidcUrl(
        buildEndSessionUrl(oidcConfig, {
          post_logout_redirect_uri: new URL('/', oidcRedirectUri).href,
          ...(idToken
            ? { id_token_hint: idToken }
            : { client_id: oidcClientId }),
        }),
      ).href;
    } catch (error) {
      request.log.warn({ error }, 'OIDC sign-out URL is not available');
    }
    return { ok: true, logoutUrl };
  });

  const auditUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentUser(request);
    if (!user) {
      reply.code(401).send({ error: 'Sign in to continue.' });
      return undefined;
    }
    if (!authorize(user, 'audit.read', refundsTool)) {
      try {
        await inTransaction(database, (client) =>
          appendAudit(client, {
            toolId: 'foundation',
            actorId: user.id,
            actorRoles: user.roles,
            action: 'permission.denied',
            objectType: 'permission',
            objectId: 'audit.read',
            result: 'denied',
            requestId: request.id,
            sourceIp: request.ip,
            userAgent: request.headers['user-agent'],
          }),
        );
      } catch (error) {
        request.log.error({ error }, 'Could not audit permission denial');
      }
      reply
        .code(403)
        .send({ error: 'You do not have permission to perform this action.' });
      return undefined;
    }
    return user;
  };

  server.get('/api/audit', async (request, reply) => {
    const user = await auditUser(request, reply);
    if (!user) return;
    const result = await database.query(
      `SELECT seq,event_data,encode(hash,'hex') AS hash
       FROM foundation.audit_events ORDER BY seq DESC LIMIT 100`,
    );
    if ((request.query as { format?: string }).format === 'csv') {
      await inTransaction(database, (client) =>
        appendAudit(client, {
          toolId: 'foundation',
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
    const user = await auditUser(request, reply);
    if (!user) return;
    const result = await database.query(
      'SELECT event_data,prev_hash,hash FROM foundation.audit_events ORDER BY seq',
    );
    const verification = verifyAuditChain(
      result.rows.map((row) => ({
        event: row.event_data,
        prevHash: row.prev_hash,
        hash: row.hash,
      })),
    );
    return {
      ...verification,
      eventCount: result.rowCount,
      verifiedAt: new Date().toISOString(),
    };
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
    const result = await database.query(
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
      onRequest: async (request, reply) => {
        const type = String(request.headers['content-type'] ?? '');
        if (!type.startsWith('application/json')) {
          return reply
            .code(415)
            .send({ error: 'Send the webhook as application/json.' });
        }
      },
    },
    async (request, reply) => {
      const raw = (request as ApiRequest & { rawBody?: Buffer }).rawBody;
      if (!raw) {
        return reply.code(400).send({ error: 'Webhook body is missing.' });
      }
      const signature = request.headers['sim-signature'];
      const match =
        typeof signature === 'string' &&
        /^t=(\d+),v1=([a-f0-9]+)$/.exec(signature);
      const signedAt = match ? match[1] : undefined;
      const digest = match ? match[2] : undefined;
      if (
        !signedAt ||
        !digest ||
        Math.abs(Date.now() / 1000 - Number(signedAt)) > 300
      ) {
        return reply
          .code(401)
          .send({ error: 'Webhook signature is invalid or expired.' });
      }
      const expected = createHmac(
        'sha256',
        env.WEBHOOK_SECRET ?? 'local-webhook-secret-change-before-deploy',
      )
        .update(`${signedAt}.${raw.toString('utf8')}`)
        .digest('hex');
      if (!safeEqual(digest, expected)) {
        return reply.code(401).send({ error: 'Webhook signature is invalid.' });
      }
      const payload = JSON.parse(raw.toString('utf8')) as {
        id: string;
        type: string;
      };
      await database.query(
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

  await server.ready();
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await buildServer();
  await server.listen({
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 3000),
  });
}
