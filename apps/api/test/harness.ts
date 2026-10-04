import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { buildServer } from '../src/server.js';

const sessionSecret = 'security-test-session-secret';
export const webhookSecret = 'security-test-webhook-secret';

const ownerUrl =
  process.env.DATABASE_URL ??
  'postgres://tools:local-development-only@localhost:5432/internal_tools';

function runtimeUrl() {
  if (process.env.RUNTIME_DATABASE_URL) return process.env.RUNTIME_DATABASE_URL;
  const url = new URL(ownerUrl);
  url.username = 'app_runtime';
  url.password = process.env.RUNTIME_DB_PASSWORD ?? 'local-runtime-only';
  return url.toString();
}

export function csrfToken(sessionId: string, secret = sessionSecret) {
  const nonce = randomBytes(24).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${sessionId}.${nonce}`)
    .digest('base64url');
  return `${nonce}.${signature}`;
}

export interface Persona {
  name: string;
  userId: string;
  roles: string[];
  sessionId: string;
  csrf: string;
  remoteAddress: string;
}

interface SendOptions {
  body?: unknown;
  headers?: Record<string, string>;
  cookie?: string;
  csrfHeader?: string | null;
}

type Server = Awaited<ReturnType<typeof buildServer>>;

export interface Harness {
  runId: string;
  app: Server;
  owner: pg.Pool;
  runtime: pg.Pool;
  persona(name: string, roles: string[]): Promise<Persona>;
  charge(amountMinor: bigint): Promise<string>;
  send(
    persona: Persona | undefined,
    method: string,
    url: string,
    options?: SendOptions,
  ): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const runId = randomUUID().slice(0, 8);
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 2 });
  const runtime = new pg.Pool({ connectionString: runtimeUrl(), max: 8 });
  const app = await buildServer({
    pool: runtime,
    logger: false,
    env: {
      APP_ENV: 'LOCAL',
      NODE_ENV: 'test',
      SESSION_SECRET: sessionSecret,
      WEBHOOK_SECRET: webhookSecret,
    },
  });
  await app.ready();
  let address = 10;
  let chargeCount = 0;

  return {
    runId,
    app,
    owner,
    runtime,
    async persona(name, roles) {
      const sessionId = randomBytes(32).toString('base64url');
      const userId = `sectest-${runId}-${name}`;
      await owner.query(
        `INSERT INTO foundation.sessions(id,user_id,display_name,roles)
         VALUES($1,$2,$3,$4)`,
        [sessionId, userId, `Security test ${name}`, roles],
      );
      return {
        name,
        userId,
        roles,
        sessionId,
        csrf: csrfToken(sessionId),
        remoteAddress: `10.77.0.${address++}`,
      };
    },
    async charge(amountMinor) {
      const id = `ch_sec_${runId}_${chargeCount++}`;
      await owner.query(
        `INSERT INTO refunds.charges(id,customer_id,customer_email,card_brand,card_last4,amount_minor,currency)
         VALUES($1,'cus_sec_test',$2,'visa','4242',$3,'USD')`,
        [id, `${id}@example.test`, amountMinor.toString()],
      );
      return id;
    },
    send(persona, method, url, options = {}) {
      const headers: Record<string, string> = { ...options.headers };
      if (options.cookie !== undefined) headers.cookie = options.cookie;
      else if (persona)
        headers.cookie = `sid=${persona.sessionId}; csrf=${persona.csrf}`;
      const csrfHeader =
        options.csrfHeader === undefined ? persona?.csrf : options.csrfHeader;
      if (method !== 'GET' && csrfHeader) headers['x-csrf-token'] = csrfHeader;
      return app.inject({
        method: method as 'GET' | 'POST',
        url,
        headers,
        remoteAddress: persona?.remoteAddress ?? '10.77.1.1',
        ...(options.body === undefined
          ? {}
          : { payload: options.body as object }),
      });
    },
    async close() {
      const like = `sectest-${runId}-%`;
      const charges = `ch_sec_${runId}_%`;
      const refunds = await owner.query<{
        id: string;
        approval: string | null;
      }>(
        `SELECT id::text, approval_request_id::text AS approval
         FROM refunds.refunds WHERE charge_id LIKE $1`,
        [charges],
      );
      const approvalIds = await owner.query<{ id: string }>(
        `SELECT id::text FROM foundation.approval_requests
         WHERE requester_id LIKE $1 OR object_id LIKE $2`,
        [like, `sec-${runId}-%`],
      );
      const ids = approvalIds.rows.map((row) => row.id);
      await owner.query(
        `DELETE FROM foundation.outbox WHERE payload->>'refundId' = ANY($1::text[])`,
        [refunds.rows.map((row) => row.id)],
      );
      await owner.query('DELETE FROM refunds.refunds WHERE charge_id LIKE $1', [
        charges,
      ]);
      await owner.query(
        'DELETE FROM foundation.approvals WHERE approval_request_id = ANY($1::uuid[])',
        [ids],
      );
      await owner.query(
        'DELETE FROM foundation.approval_requests WHERE id = ANY($1::uuid[])',
        [ids],
      );
      await owner.query('DELETE FROM refunds.charges WHERE id LIKE $1', [
        charges,
      ]);
      await owner.query(
        'DELETE FROM foundation.idempotency_keys WHERE actor_id LIKE $1',
        [like],
      );
      await owner.query(
        'DELETE FROM refunds.agent_daily_totals WHERE agent_id LIKE $1',
        [like],
      );
      await owner.query(
        'DELETE FROM foundation.sessions WHERE user_id LIKE $1',
        [like],
      );
      await owner.query(
        `DELETE FROM foundation.inbound_events WHERE event_id LIKE $1`,
        [`evt_sec_${runId}_%`],
      );
      await app.close();
      await runtime.end();
      await owner.end();
    },
  };
}
