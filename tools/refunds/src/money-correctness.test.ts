import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refundsTool } from './registry.js';
import { createPaymentProvider, type PaymentProvider } from './provider.js';
import { createRefundWorkerRegistration } from './worker.js';
import { dailyAutoRefundLimitMinor } from './domain.js';

// Integration tests against the docker compose stack (API, worker, Postgres,
// payment simulator). They skip when the stack is not reachable.
const apiUrl = process.env.INTEGRATION_API_URL ?? 'http://localhost:3000';
const simulatorUrl =
  process.env.INTEGRATION_SIMULATOR_URL ?? 'http://localhost:4000';
const ownerDatabaseUrl =
  process.env.INTEGRATION_OWNER_DATABASE_URL ??
  'postgres://tools:local-development-only@localhost:5432/internal_tools';
const runtimeDatabaseUrl =
  process.env.INTEGRATION_RUNTIME_DATABASE_URL ??
  'postgres://app_runtime:local-runtime-only@localhost:5432/internal_tools';
const sessionSecret =
  process.env.SESSION_SECRET ?? 'local-session-secret-change-before-deploy';
const webhookSecret =
  process.env.WEBHOOK_SECRET ?? 'local-webhook-secret-change-before-deploy';
const simulatorAdminToken =
  process.env.SIM_ADMIN_TOKEN ?? 'local-simulator-admin';

async function reachable(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function databaseReachable(url: string) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM refunds.charges LIMIT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const stackAvailable =
  (await reachable(`${apiUrl}/health/ready`)) &&
  (await reachable(`${simulatorUrl}/health`)) &&
  (await databaseReachable(ownerDatabaseUrl)) &&
  (await databaseReachable(runtimeDatabaseUrl));
if (!stackAvailable) {
  console.warn(
    'Money-correctness integration tests skipped: start the stack with `docker compose up -d --build --wait`.',
  );
}

const run = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
let owner: pg.Pool;
let runtime: pg.Pool;
let chargeCounter = 0;
const sessionIds: string[] = [];

interface ApiResponse {
  status: number;
  body: any;
}

interface ApiClient {
  userId: string;
  call: (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<ApiResponse>;
}

async function signIn(name: string, roles: string[]): Promise<ApiClient> {
  const userId = `mc-${run}-${name}`;
  const sessionId = randomBytes(32).toString('base64url');
  await owner.query(
    `INSERT INTO foundation.sessions(id,user_id,display_name,roles)
     VALUES($1,$2,$3,$4)`,
    [sessionId, userId, `Test ${name}`, roles],
  );
  sessionIds.push(sessionId);
  const nonce = randomBytes(24).toString('base64url');
  const signature = createHmac('sha256', sessionSecret)
    .update(`${sessionId}.${nonce}`)
    .digest('base64url');
  const csrf = `${nonce}.${signature}`;
  return {
    userId,
    call: async (method, path, body, headers = {}) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          cookie: `sid=${sessionId}; csrf=${csrf}`,
          'x-csrf-token': csrf,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Keep the raw text for non-JSON responses.
      }
      return { status: response.status, body: parsed };
    },
  };
}

async function createCharge(amountMinor: number) {
  chargeCounter += 1;
  const id = `ch_mc_${run}_${chargeCounter}`;
  await owner.query(
    `INSERT INTO refunds.charges(id,customer_id,customer_email,card_brand,card_last4,amount_minor,currency)
     VALUES($1,$2,$3,'visa','4242',$4,'USD')`,
    [id, `cus_mc_${run}`, `mc-${run}@example.test`, amountMinor],
  );
  return id;
}

function refundBody(chargeId: string, amountMinor: number | string) {
  return {
    chargeId,
    amountMinor: String(amountMinor),
    reasonCode: 'service_issue',
    note: 'Money-correctness integration test refund.',
  };
}

function requestRefund(
  client: ApiClient,
  chargeId: string,
  amountMinor: number | string,
  key: string = randomUUID(),
) {
  return client.call(
    'POST',
    '/api/refunds',
    refundBody(chargeId, amountMinor),
    {
      'idempotency-key': key,
    },
  );
}

async function waitFor<T>(
  description: string,
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const started = Date.now();
  let value = await probe();
  while (!done(value)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out waiting for ${description}. Last value: ${JSON.stringify(value)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await probe();
  }
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refundRow(id: string) {
  const result = await owner.query(
    `SELECT id::text,status,tier,policy_version,provider_refund_id,failure_code,
            amount_minor::text,approval_request_id::text
     FROM refunds.refunds WHERE id=$1`,
    [id],
  );
  return result.rows[0];
}

async function chargeRow(id: string) {
  const result = await owner.query(
    'SELECT amount_minor::text,refunded_minor::text FROM refunds.charges WHERE id=$1',
    [id],
  );
  return result.rows[0] as { amount_minor: string; refunded_minor: string };
}

async function outboxRow(refundId: string) {
  const result = await owner.query(
    `SELECT status,attempts,last_error FROM foundation.outbox
     WHERE kind='refund.execute' AND idempotency_key=$1`,
    [refundId],
  );
  return result.rows[0] as
    { status: string; attempts: number; last_error: string | null } | undefined;
}

async function auditCount(refundId: string, action: string) {
  const result = await owner.query(
    `SELECT count(*)::int AS count FROM foundation.audit_events
     WHERE object_type='refund' AND object_id=$1 AND action=$2`,
    [refundId, action],
  );
  return result.rows[0].count as number;
}

async function providerRefunds(idempotencyKey: string) {
  const response = await fetch(`${simulatorUrl}/v1/refunds`);
  const body = (await response.json()) as {
    data: Array<{ id: string; idempotencyKey: string; amountMinor: string }>;
  };
  return body.data.filter((refund) => refund.idempotencyKey === idempotencyKey);
}

async function simulatorAdmin(path: string, body: unknown) {
  const response = await fetch(`${simulatorUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': simulatorAdminToken,
    },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json() as Promise<Record<string, unknown>>;
}

async function postWebhook(event: {
  id: string;
  type: string;
  data: Record<string, unknown>;
}) {
  const payload = JSON.stringify({
    ...event,
    created: Math.floor(Date.now() / 1000),
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  const response = await fetch(`${apiUrl}/api/webhooks/simulator`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sim-signature': `t=${timestamp},v1=${signature}`,
    },
    body: payload,
  });
  expect(response.status).toBe(200);
}

async function webhookProcessed(eventIds: string[]) {
  const result = await owner.query(
    `SELECT count(*)::int AS count FROM foundation.inbound_events
     WHERE provider='simulator' AND event_id=ANY($1) AND processed_at IS NOT NULL`,
    [eventIds],
  );
  return (result.rows[0].count as number) === eventIds.length;
}

function simulatorProvider(): PaymentProvider {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  process.env.SIMULATOR_URL ??= simulatorUrl;
  try {
    return createPaymentProvider();
  } finally {
    if (stripeKey) process.env.STRIPE_SECRET_KEY = stripeKey;
  }
}

describe.skipIf(!stackAvailable)(
  'Refunds money correctness (stack)',
  { timeout: 90_000 },
  () => {
    let agent: ApiClient;
    let supervisor: ApiClient;
    let supervisorTwo: ApiClient;
    let finance: ApiClient;
    let supervisorFinance: ApiClient;
    let auditor: ApiClient;
    let admin: ApiClient;

    async function setPaused(paused: boolean) {
      const response = await admin.call('POST', '/api/admin/pause', { paused });
      expect(response.status).toBe(200);
    }

    beforeAll(async () => {
      owner = new pg.Pool({ connectionString: ownerDatabaseUrl, max: 4 });
      runtime = new pg.Pool({ connectionString: runtimeDatabaseUrl, max: 4 });
      agent = await signIn('agent', ['agent']);
      supervisor = await signIn('supervisor', ['supervisor']);
      supervisorTwo = await signIn('supervisor-two', ['supervisor']);
      finance = await signIn('finance', ['finance']);
      supervisorFinance = await signIn('supervisor-finance', [
        'supervisor',
        'finance',
      ]);
      auditor = await signIn('auditor', ['auditor']);
      admin = await signIn('platform-admin', ['platform_admin']);
      await simulatorAdmin('/admin/faults', { clear: true });
      await setPaused(false);
    });

    afterAll(async () => {
      if (admin) await setPaused(false).catch(() => undefined);
      await simulatorAdmin('/admin/faults', { clear: true }).catch(
        () => undefined,
      );
      if (owner) {
        await owner.query('DELETE FROM foundation.sessions WHERE id=ANY($1)', [
          sessionIds,
        ]);
        await owner.end();
      }
      if (runtime) await runtime.end();
    });

    it('C1 idempotency: same key and body replays one refund; a different body returns 422', async () => {
      const chargeId = await createCharge(100_000);
      const key = randomUUID();
      const first = await requestRefund(agent, chargeId, 30_000, key);
      const replay = await requestRefund(agent, chargeId, 30_000, key);
      expect(first.status).toBe(201);
      expect(replay.status).toBe(first.status);
      expect(replay.body).toEqual(first.body);
      const conflict = await requestRefund(agent, chargeId, 30_001, key);
      expect(conflict.status).toBe(422);

      const concurrentKey = randomUUID();
      const concurrent = await Promise.all(
        Array.from({ length: 5 }, () =>
          requestRefund(agent, chargeId, 40_000, concurrentKey),
        ),
      );
      const created = concurrent.filter((response) => response.status === 201);
      expect(created.length).toBeGreaterThanOrEqual(1);
      expect(new Set(created.map((response) => response.body.id)).size).toBe(1);
      for (const response of concurrent) {
        expect([201, 409]).toContain(response.status);
      }

      const rows = await owner.query(
        `SELECT amount_minor::text FROM refunds.refunds WHERE charge_id=$1 ORDER BY amount_minor`,
        [chargeId],
      );
      expect(rows.rows.map((row) => row.amount_minor)).toEqual([
        '30000',
        '40000',
      ]);
      expect((await chargeRow(chargeId)).refunded_minor).toBe('70000');
    });

    it('C2 concurrency: 20 parallel requests never refund more than the charge', async () => {
      const chargeId = await createCharge(1_000_000);
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          requestRefund(supervisor, chargeId, 150_000),
        ),
      );
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses.filter((status) => status === 201)).toHaveLength(6);
      expect(statuses.filter((status) => status === 409)).toHaveLength(14);
      const charge = await chargeRow(chargeId);
      expect(charge.refunded_minor).toBe('900000');
      const active = await owner.query(
        `SELECT coalesce(sum(amount_minor),0)::text AS total FROM refunds.refunds
       WHERE charge_id=$1 AND status NOT IN ('failed','rejected','cancelled','expired')`,
        [chargeId],
      );
      expect(active.rows[0].total).toBe('900000');

      // The CHECK constraint holds even when an owner disables triggers.
      const client = await owner.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL session_replication_role = 'replica'");
        await expect(
          client.query(
            'UPDATE refunds.charges SET refunded_minor=amount_minor+1 WHERE id=$1',
            [chargeId],
          ),
        ).rejects.toThrow(/check constraint/);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      await expect(
        runtime.query(
          'UPDATE refunds.charges SET refunded_minor=amount_minor+1 WHERE id=$1',
          [chargeId],
        ),
      ).rejects.toThrow(/refundable balance|check constraint/);
    });

    it('C3 daily limit: auto-tier refunds stop at 2,000.00 for each agent, also under concurrency', async () => {
      const dailyAgent = await signIn('daily-agent', ['agent']);
      // The tier counts the total refunded on a charge, so each auto-tier
      // request uses its own charge.
      const chargeIds = await Promise.all(
        Array.from({ length: 12 }, () => createCharge(1_000_000)),
      );
      const responses = await Promise.all(
        chargeIds
          .slice(0, 10)
          .map((chargeId) => requestRefund(dailyAgent, chargeId, 25_000)),
      );
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(8);
      expect(statuses.filter((status) => status === 422)).toHaveLength(2);
      const extra = await requestRefund(dailyAgent, chargeIds[10]!, 1);
      expect(extra.status).toBe(422);
      const totals = await owner.query(
        `SELECT auto_minor::text FROM refunds.agent_daily_totals
       WHERE agent_id=$1 AND day=current_date`,
        [dailyAgent.userId],
      );
      expect(totals.rows[0].auto_minor).toBe('200000');
      const refunded = await Promise.all(
        chargeIds
          .slice(0, 10)
          .map(async (id) => BigInt((await chargeRow(id)).refunded_minor)),
      );
      expect(refunded.reduce((sum, value) => sum + value, 0n)).toBe(200_000n);
      // Supervisor-tier requests do not count toward the auto-tier limit.
      const supervisorTier = await requestRefund(
        dailyAgent,
        chargeIds[11]!,
        25_001,
      );
      expect(supervisorTier.status).toBe(201);
      expect(supervisorTier.body.status).toBe('pending_approval');
    });

    it('C4 policy tiers at the boundaries and two different approvers for dual tier', async () => {
      // The tier counts the total refunded on a charge, so each boundary
      // request uses its own charge.
      const chargeId = await createCharge(2_000_000);
      const auto = await requestRefund(
        supervisor,
        await createCharge(2_000_000),
        25_000,
      );
      const low = await requestRefund(
        supervisor,
        await createCharge(2_000_000),
        25_001,
      );
      const high = await requestRefund(
        supervisor,
        await createCharge(2_000_000),
        500_000,
      );
      const dual = await requestRefund(supervisor, chargeId, 500_001);
      expect([auto.status, low.status, high.status, dual.status]).toEqual([
        201, 201, 201, 201,
      ]);
      expect([auto.body.tier, auto.body.status]).toEqual(['auto', 'approved']);
      expect([low.body.tier, low.body.status]).toEqual([
        'supervisor',
        'pending_approval',
      ]);
      expect([high.body.tier, high.body.status]).toEqual([
        'supervisor',
        'pending_approval',
      ]);
      expect([dual.body.tier, dual.body.status]).toEqual([
        'dual',
        'pending_approval',
      ]);
      expect(dual.body.approvalSteps).toEqual([['supervisor'], ['finance']]);
      const agentDual = await requestRefund(agent, chargeId, 500_001);
      expect(agentDual.status).toBe(403);

      const policyVersion = (
        refundsTool.approvalRules['refund.execute'] as { version: number }
      ).version;
      const dualRow = await refundRow(dual.body.id);
      expect(dualRow.policy_version).toBe(policyVersion);
      const approval = await owner.query(
        `SELECT id::text,policy_version,
              round(extract(epoch FROM expires_at-created_at)/3600)::int AS hours
       FROM foundation.approval_requests WHERE id=$1`,
        [dualRow.approval_request_id],
      );
      expect(approval.rows[0].policy_version).toBe(policyVersion);
      expect(approval.rows[0].hours).toBe(72);
      const approvalId = approval.rows[0].id as string;

      // Requester cannot approve. Finance cannot go first.
      expect(
        (
          await supervisor.call(
            'POST',
            `/api/approvals/${approvalId}/approve`,
            {},
          )
        ).status,
      ).toBe(403);
      expect(
        (await finance.call('POST', `/api/approvals/${approvalId}/approve`, {}))
          .status,
      ).toBe(403);
      expect(
        (
          await finance.call('POST', `/api/approvals/${approvalId}/approve`, {
            stepIndex: 1,
          })
        ).status,
      ).toBe(409);
      // One user with both roles can approve only one step.
      const firstStep = await supervisorFinance.call(
        'POST',
        `/api/approvals/${approvalId}/approve`,
        {},
      );
      expect(firstStep.body).toEqual({ status: 'pending' });
      expect((await refundRow(dual.body.id)).status).toBe('pending_approval');
      const sameUser = await supervisorFinance.call(
        'POST',
        `/api/approvals/${approvalId}/approve`,
        { stepIndex: 1 },
      );
      expect(sameUser.status).toBe(409);
      expect(
        (
          await supervisorTwo.call(
            'POST',
            `/api/approvals/${approvalId}/approve`,
            {
              stepIndex: 1,
            },
          )
        ).status,
      ).toBe(403);
      const secondStep = await finance.call(
        'POST',
        `/api/approvals/${approvalId}/approve`,
        {},
      );
      expect(secondStep.body).toEqual({ status: 'approved' });
      const decisions = await owner.query(
        `SELECT step_index,approver_id,approver_role FROM foundation.approvals
       WHERE approval_request_id=$1 ORDER BY step_index`,
        [approvalId],
      );
      expect(decisions.rows).toEqual([
        {
          step_index: 0,
          approver_id: supervisorFinance.userId,
          approver_role: 'supervisor',
        },
        {
          step_index: 1,
          approver_id: finance.userId,
          approver_role: 'finance',
        },
      ]);
      await waitFor(
        'dual-tier refund to succeed',
        () => refundRow(dual.body.id),
        (row) => row.status === 'succeeded',
      );
      expect(await providerRefunds(dual.body.id)).toHaveLength(1);
    });

    it('C5 provider timeout then retry creates exactly one provider refund', async () => {
      // The fault applies to the next provider call. Wait until no earlier
      // refund of this run can take it.
      await waitFor(
        'earlier refund executions to finish',
        async () =>
          (
            await owner.query(
              `SELECT count(*)::int AS count FROM foundation.outbox o
               JOIN refunds.refunds r ON r.id::text=o.idempotency_key
               WHERE o.kind='refund.execute' AND o.status NOT IN ('done','failed')
                 AND r.requester_id LIKE $1`,
              [`mc-${run}-%`],
            )
          ).rows[0].count as number,
        (count) => count === 0,
      );
      // a) Injected transient timeout (HTTP 503) before the provider records the refund.
      await simulatorAdmin('/admin/faults', { fault: 'timeout-then-succeed' });
      const chargeId = await createCharge(100_000);
      const created = await requestRefund(agent, chargeId, 10_000);
      expect(created.status).toBe(201);
      const refundId = created.body.id as string;
      await waitFor(
        'refund to succeed after the retry',
        () => refundRow(refundId),
        (row) => row.status === 'succeeded',
        45_000,
      );
      expect(await providerRefunds(refundId)).toHaveLength(1);
      const outbox = await outboxRow(refundId);
      expect(outbox).toMatchObject({ status: 'done', attempts: 1 });
      expect(await auditCount(refundId, 'refund.execution_started')).toBe(1);
      expect(await auditCount(refundId, 'refund.execution_completed')).toBe(1);

      // b) The provider records the refund but the response is lost (client timeout).
      await setPaused(true);
      try {
        const lostCharge = await createCharge(100_000);
        const lost = await requestRefund(agent, lostCharge, 11_000);
        expect(lost.status).toBe(201);
        const lostId = lost.body.id as string;
        const real = simulatorProvider();
        let calls = 0;
        const lossy: PaymentProvider = {
          listRefunds: () => real.listRefunds(),
          async createRefund(input) {
            calls += 1;
            const result = await real.createRefund(input);
            if (calls === 1) {
              throw new Error('The operation was aborted due to timeout');
            }
            return result;
          },
        };
        const execute = createRefundWorkerRegistration(runtime, lossy)
          .outboxHandlers!['refund.execute']!;
        await expect(execute({}, { refundId: lostId })).rejects.toThrow(
          /timeout/,
        );
        await execute({}, { refundId: lostId });
        await waitFor(
          'lost-response refund to succeed',
          () => refundRow(lostId),
          (row) => row.status === 'succeeded',
        );
        expect(await providerRefunds(lostId)).toHaveLength(1);
        expect((await refundRow(lostId)).provider_refund_id).toBe(
          (await providerRefunds(lostId))[0]!.id,
        );
      } finally {
        await setPaused(false);
      }
    });

    it('C6 duplicate webhooks apply once; out-of-order webhooks cannot move state backward', async () => {
      await setPaused(true);
      try {
        const chargeId = await createCharge(100_000);
        const created = await requestRefund(agent, chargeId, 12_000);
        const refundId = created.body.id as string;
        const providerRefundId = `pr_mc_${randomUUID()}`;
        const pending: PaymentProvider = {
          listRefunds: async () => [],
          createRefund: async () => ({
            id: providerRefundId,
            status: 'pending',
          }),
        };
        const execute = createRefundWorkerRegistration(runtime, pending)
          .outboxHandlers!['refund.execute']!;
        expect(await execute({}, { refundId })).toEqual({
          retryAfterMs: 30_000,
        });
        expect((await refundRow(refundId)).status).toBe('executing');

        const data = { refundId, providerRefundId };
        const first = randomUUID();
        const second = randomUUID();
        await postWebhook({
          id: first,
          type: 'refund.succeeded',
          data: { ...data, status: 'succeeded' },
        });
        await postWebhook({
          id: first,
          type: 'refund.succeeded',
          data: { ...data, status: 'succeeded' },
        });
        await postWebhook({
          id: second,
          type: 'refund.succeeded',
          data: { ...data, status: 'succeeded' },
        });
        const stored = await owner.query(
          `SELECT count(*)::int AS count FROM foundation.inbound_events
         WHERE provider='simulator' AND event_id=$1`,
          [first],
        );
        expect(stored.rows[0].count).toBe(1);
        await waitFor(
          'duplicate webhooks to be processed',
          () => webhookProcessed([first, second]),
          Boolean,
        );
        expect((await refundRow(refundId)).status).toBe('succeeded');
        expect(await auditCount(refundId, 'refund.execution_completed')).toBe(
          1,
        );
        const refundedBefore = (await chargeRow(chargeId)).refunded_minor;

        const late = [randomUUID(), randomUUID()];
        await postWebhook({
          id: late[0]!,
          type: 'refund.failed',
          data: { ...data, status: 'failed' },
        });
        await postWebhook({
          id: late[1]!,
          type: 'refund.pending',
          data: { ...data, status: 'pending' },
        });
        await waitFor(
          'late webhooks to be processed',
          () => webhookProcessed(late),
          Boolean,
        );
        expect((await refundRow(refundId)).status).toBe('succeeded');
        expect(await auditCount(refundId, 'refund.execution_failed')).toBe(0);
        expect((await chargeRow(chargeId)).refunded_minor).toBe(refundedBefore);
      } finally {
        await setPaused(false);
      }
    });

    it('C6 a webhook that cannot apply does not block later webhooks', async () => {
      await setPaused(true);
      let approvedId = '';
      try {
        const chargeId = await createCharge(100_000);
        const approved = await requestRefund(agent, chargeId, 5_000);
        approvedId = approved.body.id as string;
        const unexpected = randomUUID();
        await postWebhook({
          id: unexpected,
          type: 'refund.succeeded',
          data: {
            refundId: approvedId,
            providerRefundId: `pr_mc_${randomUUID()}`,
            status: 'succeeded',
          },
        });

        const executing = await requestRefund(agent, chargeId, 6_000);
        const executingId = executing.body.id as string;
        const providerRefundId = `pr_mc_${randomUUID()}`;
        const execute = createRefundWorkerRegistration(runtime, {
          listRefunds: async () => [],
          createRefund: async () => ({
            id: providerRefundId,
            status: 'pending',
          }),
        }).outboxHandlers!['refund.execute']!;
        await execute({}, { refundId: executingId });
        const later = randomUUID();
        await postWebhook({
          id: later,
          type: 'refund.succeeded',
          data: {
            refundId: executingId,
            providerRefundId,
            status: 'succeeded',
          },
        });
        await waitFor(
          'the later webhook to be processed',
          () => webhookProcessed([later]),
          Boolean,
          15_000,
        );
        expect((await refundRow(executingId)).status).toBe('succeeded');
        expect((await refundRow(approvedId)).status).toBe('approved');
      } finally {
        await setPaused(false);
      }
      await waitFor(
        'the approved refund to execute after resume',
        () => refundRow(approvedId),
        (row) => row.status === 'succeeded',
      );
      expect(await providerRefunds(approvedId)).toHaveLength(1);
    });

    it('C7 reconciliation finds a provider-only refund and raises an exception', async () => {
      const chargeId = await createCharge(100_000);
      const ghost = await simulatorAdmin('/admin/ghost-refund', {
        chargeId,
        amountMinor: '4321',
        currency: 'USD',
      });
      const ghostId = ghost.id as string;
      const started = await finance.call('POST', '/api/reconciliation/run');
      expect(started.status).toBe(202);
      const exception = await waitFor(
        'a missing_internal exception',
        async () =>
          (
            await owner.query(
              `SELECT exception_type,status,details FROM refunds.reconciliation_exceptions
             WHERE reconciliation_key=$1`,
              [ghostId],
            )
          ).rows[0],
        Boolean,
      );
      expect(exception).toMatchObject({
        exception_type: 'missing_internal',
        status: 'open',
        details: { providerRefundId: ghostId, chargeId, amountMinor: '4321' },
      });
      const listed = await finance.call('GET', '/api/exceptions');
      expect(
        listed.body.items.some(
          (item: { reconciliation_key: string }) =>
            item.reconciliation_key === ghostId,
        ),
      ).toBe(true);
    });

    it('C7 each reconciliation request queues a run, even when the request ID repeats', async () => {
      const countRuns = async () =>
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM foundation.outbox WHERE kind='reconciliation.run'",
          )
        ).rows[0].count as number;
      const before = await countRuns();
      const requestId = `mc-${run}-reconcile`;
      for (let index = 0; index < 2; index += 1) {
        const response = await finance.call(
          'POST',
          '/api/reconciliation/run',
          undefined,
          { 'x-request-id': requestId },
        );
        expect(response.status).toBe(202);
      }
      expect(await countRuns()).toBe(before + 2);
    });

    it('C8 audit tampering by the database owner is detected by /api/audit/verify', async () => {
      const verify = async () =>
        (await auditor.call('GET', '/api/audit/verify')).body;
      expect(await verify()).toMatchObject({ valid: true });
      const target = await owner.query(
        `SELECT seq,id::text,event_data::text AS data FROM foundation.audit_events
       ORDER BY seq DESC OFFSET 10 LIMIT 1`,
      );
      const { seq, id, data } = target.rows[0];

      await expect(
        runtime.query(
          'UPDATE foundation.audit_events SET actor_id=actor_id WHERE seq=$1',
          [seq],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        owner.query(
          'UPDATE foundation.audit_events SET actor_id=actor_id WHERE seq=$1',
          [seq],
        ),
      ).rejects.toThrow(/append-only/);

      const client = await owner.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL session_replication_role = 'replica'");
        await client.query(
          `UPDATE foundation.audit_events
         SET event_data=jsonb_set(event_data,'{actorId}','"mallory"') WHERE seq=$1`,
          [seq],
        );
        await client.query('COMMIT');
        expect(await verify()).toMatchObject({
          valid: false,
          firstBrokenEventId: id,
        });

        await client.query('BEGIN');
        await client.query("SET LOCAL session_replication_role = 'replica'");
        await client.query(
          'UPDATE foundation.audit_events SET event_data=$2::jsonb WHERE seq=$1',
          [seq, data],
        );
        await client.query(
          'CREATE TEMP TABLE audit_backup ON COMMIT DROP AS SELECT * FROM foundation.audit_events WHERE false',
        );
        await client.query(
          'INSERT INTO audit_backup SELECT * FROM foundation.audit_events WHERE seq=$1',
          [seq],
        );
        await client.query('DELETE FROM foundation.audit_events WHERE seq=$1', [
          seq,
        ]);
        const deletedView = await client.query(
          `SELECT id::text FROM foundation.audit_events WHERE seq>$1 ORDER BY seq LIMIT 1`,
          [seq],
        );
        await client.query('SAVEPOINT before_verify');
        // The verify endpoint reads committed data, so check the deletion with
        // the shared verifier on this transaction's view.
        const { verifyAuditChain } = await import('@internal-tools/foundation');
        const rows = await client.query(
          'SELECT event_data,prev_hash,hash FROM foundation.audit_events ORDER BY seq',
        );
        const result = verifyAuditChain(
          rows.rows.map((row) => ({
            event: row.event_data,
            prevHash: row.prev_hash,
            hash: row.hash,
          })),
        );
        expect(result).toEqual({
          valid: false,
          firstBrokenEventId: deletedView.rows[0].id,
        });
        await client.query(
          'INSERT INTO foundation.audit_events SELECT * FROM audit_backup',
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        // Restore the original event if a step failed after the tamper commit.
        await client.query('BEGIN');
        await client.query("SET LOCAL session_replication_role = 'replica'");
        await client.query(
          'UPDATE foundation.audit_events SET event_data=$2::jsonb WHERE seq=$1',
          [seq, data],
        );
        await client.query('COMMIT');
        client.release();
      }
      expect(await verify()).toMatchObject({ valid: true });
    });

    it('C9 the kill switch holds approved refunds; resume executes each once', async () => {
      expect(
        (await agent.call('POST', '/api/admin/pause', { paused: true })).status,
      ).toBe(403);
      await setPaused(true);
      let autoId = '';
      let approvedId = '';
      try {
        const chargeId = await createCharge(500_000);
        const auto = await requestRefund(agent, chargeId, 7_000);
        autoId = auto.body.id as string;
        const pending = await requestRefund(agent, chargeId, 30_000);
        approvedId = pending.body.id as string;
        const approvalId = (await refundRow(approvedId))
          .approval_request_id as string;
        const decision = await supervisor.call(
          'POST',
          `/api/approvals/${approvalId}/approve`,
          {},
        );
        expect(decision.body).toEqual({ status: 'approved' });
        expect(
          (await admin.call('GET', '/api/dashboard')).body.executionPaused,
        ).toBe(true);
        await sleep(5_000);
        for (const id of [autoId, approvedId]) {
          expect((await refundRow(id)).status).toBe('approved');
          expect((await outboxRow(id))?.status).toBe('pending');
          expect(await providerRefunds(id)).toHaveLength(0);
        }
      } finally {
        await setPaused(false);
      }
      for (const id of [autoId, approvedId]) {
        await waitFor(
          'paused refund to execute after resume',
          () => refundRow(id),
          (row) => row.status === 'succeeded',
        );
      }
      await sleep(2_000);
      for (const id of [autoId, approvedId]) {
        expect(await providerRefunds(id)).toHaveLength(1);
        expect((await outboxRow(id))?.status).toBe('done');
        expect(await auditCount(id, 'refund.execution_started')).toBe(1);
      }
    });

    it('C10 the database and API reject invalid refund state transitions', async () => {
      const statuses = [
        'pending_approval',
        'approved',
        'rejected',
        'cancelled',
        'expired',
        'executing',
        'succeeded',
        'failed',
        'reconciled',
      ];
      const allowed: Record<string, string[]> = {
        pending_approval: ['approved', 'rejected', 'cancelled', 'expired'],
        approved: ['executing'],
        executing: ['succeeded', 'failed'],
        succeeded: ['reconciled'],
      };
      const chargeId = await createCharge(1_000_000);
      await owner.query(
        'UPDATE refunds.charges SET refunded_minor=$2 WHERE id=$1',
        [chargeId, statuses.length * 100],
      );
      const ids: Record<string, string> = {};
      for (const status of statuses) {
        const inserted = await owner.query(
          `INSERT INTO refunds.refunds(charge_id,amount_minor,currency,reason_code,note,
           requester_id,status,tier,policy_version)
         VALUES($1,100,'USD','service_issue','Transition matrix test row.',$2,$3,'auto',1)
         RETURNING id::text`,
          [chargeId, agent.userId, status],
        );
        ids[status] = inserted.rows[0].id;
      }
      const client = await runtime.connect();
      const outcomes: string[] = [];
      try {
        await client.query('BEGIN');
        for (const from of statuses) {
          for (const to of statuses) {
            if (from === to) continue;
            await client.query('SAVEPOINT transition');
            let accepted = true;
            try {
              await client.query(
                'UPDATE refunds.refunds SET status=$2 WHERE id=$1',
                [ids[from], to],
              );
            } catch (error) {
              accepted = false;
              expect(String(error)).toMatch(/invalid refund transition/);
            }
            await client.query('ROLLBACK TO SAVEPOINT transition');
            const expected = (allowed[from] ?? []).includes(to);
            if (accepted !== expected) {
              outcomes.push(`${from} -> ${to}: accepted=${accepted}`);
            }
          }
        }
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect(outcomes).toEqual([]);

      // API: a rejected refund cannot be approved; the worker does not execute it.
      const apiCharge = await createCharge(100_000);
      const pending = await requestRefund(agent, apiCharge, 30_000);
      const approvalId = (await refundRow(pending.body.id))
        .approval_request_id as string;
      expect((await chargeRow(apiCharge)).refunded_minor).toBe('30000');
      const rejected = await supervisor.call(
        'POST',
        `/api/approvals/${approvalId}/reject`,
        {},
      );
      expect(rejected.body).toEqual({ status: 'rejected' });
      expect((await refundRow(pending.body.id)).status).toBe('rejected');
      expect((await chargeRow(apiCharge)).refunded_minor).toBe('0');
      const approveAfter = await supervisorTwo.call(
        'POST',
        `/api/approvals/${approvalId}/approve`,
        {},
      );
      expect(approveAfter.status).toBe(409);
      let providerCalls = 0;
      const execute = createRefundWorkerRegistration(runtime, {
        listRefunds: async () => [],
        createRefund: async () => {
          providerCalls += 1;
          return { id: 'unused', status: 'succeeded' };
        },
      }).outboxHandlers!['refund.execute']!;
      await execute({}, { refundId: pending.body.id });
      expect(providerCalls).toBe(0);
      expect((await refundRow(pending.body.id)).status).toBe('rejected');
    });

    it('R policy_versions has refund policy version 3 as the only active version', async () => {
      const policy = refundsTool.approvalRules['refund.execute'] as {
        version: number;
        expiresAfterHours: number;
      };
      const versions = await owner.query(
        `SELECT version,state,configuration FROM foundation.policy_versions
         WHERE tool_id='refunds' ORDER BY version`,
      );
      const active = versions.rows.filter((row) => row.state === 'active');
      expect(active.map((row) => row.version)).toEqual([policy.version]);
      expect(active[0].configuration).toMatchObject({
        autoLimitMinor: 25_000,
        supervisorLimitMinor: 500_000,
        dailyLimitMinor: Number(dailyAutoRefundLimitMinor),
        expiresAfterHours: policy.expiresAfterHours,
      });
      const known = new Set(versions.rows.map((row) => row.version));
      const stored = await owner.query(
        `SELECT DISTINCT policy_version FROM refunds.refunds WHERE requester_id LIKE $1`,
        [`mc-${run}-%`],
      );
      expect(stored.rows.length).toBeGreaterThan(0);
      for (const row of stored.rows) {
        expect(known.has(row.policy_version)).toBe(true);
      }
    });
  },
);

describe('Refunds approval policy matches the system design', () => {
  it('uses policy version 3: auto <= 25000, supervisor <= 500000, dual otherwise, 72 hour expiry', () => {
    const policy = refundsTool.approvalRules['refund.execute'] as {
      version: number;
      expiresAfterHours: number;
      tiers: Array<{
        name: string;
        steps: string[][];
        when: (request: { amountMinor: bigint }) => boolean;
      }>;
    };
    expect(policy.version).toBe(3);
    expect(policy.expiresAfterHours).toBe(72);
    expect(policy.tiers.map((tier) => [tier.name, tier.steps])).toEqual([
      ['auto', []],
      ['supervisor', [['supervisor']]],
      ['dual', [['supervisor'], ['finance']]],
    ]);
    const tierFor = (amountMinor: bigint) =>
      policy.tiers.find((tier) => tier.when({ amountMinor }))?.name;
    expect(tierFor(1n)).toBe('auto');
    expect(tierFor(25_000n)).toBe('auto');
    expect(tierFor(25_001n)).toBe('supervisor');
    expect(tierFor(500_000n)).toBe('supervisor');
    expect(tierFor(500_001n)).toBe('dual');
  });
});

describe('Refunds webhook processing after errors', () => {
  function webhookRun(lookupError: Error) {
    const updates: string[] = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM foundation.inbound_events')) {
          return {
            rows: ['1', '2'].map((index) => ({
              provider: 'simulator',
              event_id: `evt-${index}`,
              event_type: 'refund.succeeded',
              payload: { data: { refundId: `refund-${index}` } },
            })),
          };
        }
        if (sql.includes('FROM refunds.refunds') && params[0] === 'refund-1') {
          throw lookupError;
        }
        if (sql.includes('UPDATE foundation.inbound_events')) {
          updates.push(
            `${sql.includes('error=') ? 'error' : 'processed'}:${String(params[1])}`,
          );
        }
        return { rows: [] };
      },
    } as unknown as pg.Pool;
    const run = createRefundWorkerRegistration(pool, {
      listRefunds: async () => [],
      createRefund: async () => ({ id: 'unused', status: 'pending' }),
    }).reconcilers!['refunds.webhooks']!;
    return { run, updates };
  }

  it('keeps an event for retry after a transient error and processes later events', async () => {
    const { run, updates } = webhookRun(
      new Error('Connection terminated unexpectedly'),
    );
    await expect(run(undefined)).rejects.toThrow(/Connection terminated/);
    expect(updates).toEqual(['processed:evt-2']);
  });

  it('records a permanent error, skips the event, and processes later events', async () => {
    const { run, updates } = webhookRun(
      Object.assign(
        new Error('invalid refund transition: approved -> succeeded'),
        { code: 'P0001' },
      ),
    );
    await run(undefined);
    expect(updates).toEqual(['error:evt-1', 'processed:evt-2']);
  });
});
