import { createHmac, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import {
  configureFoundation,
  defineRoute,
  registerTool,
  type FoundationRoute,
} from '@internal-tools/foundation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toolRegistrations } from '../src/tool-registry.js';
import {
  csrfToken,
  startHarness,
  webhookSecret,
  type Harness,
  type Persona,
} from './harness.js';

let harness: Harness;
let agent: Persona;
let supervisor: Persona;
let secondSupervisor: Persona;
let finance: Persona;
let dualRole: Persona;

beforeAll(async () => {
  harness = await startHarness();
  agent = await harness.persona('agent', ['agent']);
  supervisor = await harness.persona('supervisor', ['supervisor']);
  secondSupervisor = await harness.persona('supervisor-two', ['supervisor']);
  finance = await harness.persona('finance', ['finance']);
  dualRole = await harness.persona('agent-supervisor', ['agent', 'supervisor']);
});

afterAll(async () => {
  await harness?.close();
});

async function requestRefund(
  persona: Persona,
  chargeId: string,
  amountMinor: string,
  extra: Record<string, unknown> = {},
  key = randomUUID(),
) {
  return harness.send(persona, 'POST', '/api/refunds', {
    headers: { 'idempotency-key': key },
    body: {
      chargeId,
      amountMinor,
      reasonCode: 'goodwill',
      note: 'Security control test request.',
      ...extra,
    },
  });
}

async function approvalFor(refundId: string) {
  const result = await harness.owner.query<{ id: string }>(
    'SELECT approval_request_id::text AS id FROM refunds.refunds WHERE id=$1',
    [refundId],
  );
  return result.rows[0]!.id;
}

describe('route permission declaration', () => {
  const registration = toolRegistrations[0]!;
  const template = registration.routes[0]!;

  function freshApp() {
    const app = Fastify({ logger: false });
    configureFoundation(app, {
      pool: harness.runtime,
      currentUser: async () => undefined,
      verifyCsrf: () => false,
    });
    return app;
  }

  it('makes registerTool throw for a route without a permission', async () => {
    const app = freshApp();
    const route = {
      ...template,
      path: '/api/sec-no-permission',
      permission: undefined,
    } as unknown as FoundationRoute;
    expect(() =>
      registerTool(app, {
        ...registration,
        routes: [...registration.routes, route],
      }),
    ).toThrow(/GET \/api\/sec-no-permission/);
    await app.close();
  });

  it('makes registerTool throw for a permission outside the tool matrix', async () => {
    const app = freshApp();
    const route = {
      ...template,
      path: '/api/sec-undeclared',
      permission: 'refund.delete',
    } as FoundationRoute;
    expect(() =>
      registerTool(app, {
        ...registration,
        routes: [...registration.routes, route],
      }),
    ).toThrow(/require a declared permission/);
    await app.close();
  });

  it('makes defineRoute throw for a route without a permission', () => {
    expect(() =>
      defineRoute({
        method: 'GET',
        path: '/api/sec-define',
        permission: '',
        handler: async () => ({}),
      }),
    ).toThrow(/has no permission/);
  });
});

describe('mandatory audit', () => {
  it('rolls back and fails a mutating route that writes no audit event', async () => {
    const registration = toolRegistrations[0]!;
    const app = Fastify({ logger: false });
    configureFoundation(app, {
      pool: harness.runtime,
      currentUser: async () => ({
        id: 'audit-test-agent',
        displayName: 'Audit test agent',
        roles: ['agent'],
      }),
      verifyCsrf: () => true,
    });
    registerTool(app, {
      ...registration,
      routes: [
        defineRoute({
          method: 'POST',
          path: '/api/sec-unaudited',
          permission: 'refund.request',
          handler: async () => ({ ok: true }),
        }),
        defineRoute({
          method: 'POST',
          path: '/api/sec-audited',
          permission: 'refund.request',
          handler: async (ctx) => {
            await ctx.audit({
              action: 'test.audited',
              objectType: 'test',
              objectId: 'audit-test',
              result: 'success',
            });
            return { ok: true };
          },
        }),
      ],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/sec-unaudited',
    });
    expect(response.statusCode).toBe(500);
    const audited = await app.inject({
      method: 'POST',
      url: '/api/sec-audited',
    });
    expect(audited.statusCode).toBe(200);
    await app.close();
  });
});

describe('self-approval and approval steps', () => {
  it('denies self-approval by the dual-role user and audits it', async () => {
    const chargeId = await harness.charge(100_000n);
    const created = await requestRefund(dualRole, chargeId, '30000');
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'pending_approval',
      tier: 'supervisor',
      requester_id: dualRole.userId,
    });
    const approvalId = await approvalFor(created.json().id);

    for (const body of [{}, { stepIndex: 0 }, { decision: 'approve' }]) {
      const response = await harness.send(
        dualRole,
        'POST',
        `/api/approvals/${approvalId}/approve`,
        { body },
      );
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe(
        'You cannot approve a request that you submitted.',
      );
    }

    const audit = await harness.owner.query(
      `SELECT actor_roles FROM foundation.audit_events
       WHERE actor_id=$1 AND action='approval.self_approval_denied'
         AND object_id=$2 AND result='denied'`,
      [dualRole.userId, approvalId],
    );
    expect(audit.rowCount).toBe(3);
    const state = await harness.owner.query(
      `SELECT r.status, (SELECT count(*)::int FROM foundation.approvals a
         WHERE a.approval_request_id=r.id) AS decisions
       FROM foundation.approval_requests r WHERE r.id=$1`,
      [approvalId],
    );
    expect(state.rows[0]).toEqual({ status: 'pending', decisions: 0 });

    const rejected = await harness.send(
      supervisor,
      'POST',
      `/api/approvals/${approvalId}/reject`,
      { body: { reason: 'Security test cleanup.' } },
    );
    expect(rejected.statusCode, rejected.body).toBe(200);
    const charge = await harness.owner.query(
      'SELECT refunded_minor::text FROM refunds.charges WHERE id=$1',
      [chargeId],
    );
    expect(charge.rows[0].refunded_minor).toBe('0');
  });

  it('blocks Finance from skipping the Supervisor step on a dual approval', async () => {
    const chargeId = await harness.charge(1_000_000n);
    const created = await requestRefund(supervisor, chargeId, '600000');
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().tier).toBe('dual');
    const approvalId = await approvalFor(created.json().id);

    for (const body of [{}, { stepIndex: 1 }]) {
      const response = await harness.send(
        finance,
        'POST',
        `/api/approvals/${approvalId}/approve`,
        { body },
      );
      expect([403, 409], response.body).toContain(response.statusCode);
    }
    const wrongStep = await harness.send(
      secondSupervisor,
      'POST',
      `/api/approvals/${approvalId}/approve`,
      { body: { stepIndex: 1 } },
    );
    expect(wrongStep.statusCode).toBeGreaterThanOrEqual(400);
    const decisions = await harness.owner.query(
      'SELECT count(*)::int AS count FROM foundation.approvals WHERE approval_request_id=$1',
      [approvalId],
    );
    expect(decisions.rows[0].count).toBe(0);

    const rejected = await harness.send(
      secondSupervisor,
      'POST',
      `/api/approvals/${approvalId}/reject`,
      { body: { reason: 'Security test cleanup.' } },
    );
    expect(rejected.statusCode, rejected.body).toBe(200);
  });

  it('stops an Agent from splitting a large refund to avoid dual approval', async () => {
    const chargeId = await harness.charge(1_000_000n);
    const first = await requestRefund(agent, chargeId, '500000');
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().tier).toBe('supervisor');

    const second = await requestRefund(agent, chargeId, '500000');
    expect(second.statusCode, second.body).toBe(403);
    expect(second.json().error).toBe(
      'Only a Supervisor can request a refund above $5,000.',
    );

    const bySupervisor = await requestRefund(supervisor, chargeId, '1000');
    expect(bySupervisor.statusCode, bySupervisor.body).toBe(201);
    expect(bySupervisor.json().tier).toBe('dual');
  });
  it('rejects a decision on an expired approval', async () => {
    const chargeId = await harness.charge(100_000n);
    const created = await requestRefund(agent, chargeId, '30000');
    expect(created.statusCode, created.body).toBe(201);
    const approvalId = await approvalFor(created.json().id);
    await harness.owner.query(
      `UPDATE foundation.approval_requests
       SET expires_at=now()-interval '1 day' WHERE id=$1`,
      [approvalId],
    );
    const response = await harness.send(
      supervisor,
      'POST',
      `/api/approvals/${approvalId}/approve`,
      { body: {} },
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('This approval has expired.');
    const state = await harness.owner.query(
      `SELECT status, (SELECT count(*)::int FROM foundation.approvals a
         WHERE a.approval_request_id=r.id) AS decisions
       FROM foundation.approval_requests r WHERE r.id=$1`,
      [approvalId],
    );
    expect(state.rows[0]).toEqual({ status: 'pending', decisions: 0 });
  });
});

describe('mass assignment and idempotency', () => {
  it('ignores client-supplied refund state fields', async () => {
    const chargeId = await harness.charge(100_000n);
    const response = await requestRefund(agent, chargeId, '30000', {
      requesterId: supervisor.userId,
      requester_id: supervisor.userId,
      status: 'approved',
      tier: 'auto',
      policyVersion: 0,
      approvalSteps: [],
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      requester_id: agent.userId,
      status: 'pending_approval',
      tier: 'supervisor',
      approvalSteps: [['supervisor']],
    });
  });

  it('binds an idempotency key to the actor and the request body', async () => {
    const chargeId = await harness.charge(100_000n);
    const key = randomUUID();
    const first = await requestRefund(agent, chargeId, '30000', {}, key);
    expect(first.statusCode, first.body).toBe(201);
    const replay = await requestRefund(agent, chargeId, '30000', {}, key);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
    const changed = await requestRefund(agent, chargeId, '30001', {}, key);
    expect(changed.statusCode).toBe(422);
    const otherActor = await requestRefund(
      dualRole,
      chargeId,
      '30000',
      {},
      key,
    );
    expect(otherActor.statusCode, otherActor.body).toBe(201);
    expect(otherActor.json().id).not.toBe(first.json().id);
    const missing = await harness.send(agent, 'POST', '/api/refunds', {
      body: {
        chargeId,
        amountMinor: '30000',
        reasonCode: 'goodwill',
        note: 'Security control test request.',
      },
    });
    expect(missing.statusCode).toBe(400);
  });
});

describe('CSRF', () => {
  const tokenError =
    'Refresh the page and try again. The security token is missing.';

  async function reveal(options: {
    cookie?: string;
    csrfHeader?: string | null;
  }) {
    const chargeId = await harness.charge(10_000n);
    return harness.send(
      supervisor,
      'POST',
      `/api/charges/${chargeId}/reveal-email`,
      { body: { reason: 'Security test reveal reason.' }, ...options },
    );
  }

  it('rejects a missing token header', async () => {
    const response = await reveal({ csrfHeader: null });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe(tokenError);
  });

  it('rejects a missing token cookie', async () => {
    const response = await reveal({ cookie: `sid=${supervisor.sessionId}` });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a header that does not match the cookie', async () => {
    const response = await reveal({
      csrfHeader: csrfToken(supervisor.sessionId),
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a forged token pair', async () => {
    for (const token of [
      'nonce.forged-signature',
      csrfToken(supervisor.sessionId, 'attacker-secret'),
      agent.csrf,
    ]) {
      const response = await reveal({
        cookie: `sid=${supervisor.sessionId}; csrf=${token}`,
        csrfHeader: token,
      });
      expect(response.statusCode, token).toBe(403);
    }
  });

  it('writes no reveal audit event for a rejected request', async () => {
    const before = await harness.owner.query(
      `SELECT count(*)::int AS count FROM foundation.audit_events
       WHERE actor_id=$1 AND action='customer.email_revealed'`,
      [supervisor.userId],
    );
    await reveal({ csrfHeader: 'wrong' });
    const valid = await reveal({});
    expect(valid.statusCode).toBe(200);
    const after = await harness.owner.query(
      `SELECT count(*)::int AS count FROM foundation.audit_events
       WHERE actor_id=$1 AND action='customer.email_revealed'`,
      [supervisor.userId],
    );
    expect(after.rows[0].count - before.rows[0].count).toBe(1);
  });

  it('protects approval decisions and logout', async () => {
    const approval = await harness.send(
      supervisor,
      'POST',
      `/api/approvals/${randomUUID()}/approve`,
      { body: {}, csrfHeader: null },
    );
    expect(approval.statusCode).toBe(403);
    expect(approval.json().error).toBe(tokenError);
    const logout = await harness.send(supervisor, 'POST', '/api/logout', {
      csrfHeader: null,
    });
    expect(logout.statusCode).toBe(403);
    const session = await harness.send(supervisor, 'GET', '/api/session');
    expect(session.json().authenticated).toBe(true);
  });
});

describe('simulator webhook', () => {
  function sign(body: string, timestamp: number, secret = webhookSecret) {
    const digest = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    return `t=${timestamp},v1=${digest}`;
  }

  function deliver(body: string, signature?: string) {
    return harness.app.inject({
      method: 'POST',
      url: '/api/webhooks/simulator',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'sim-signature': signature } : {}),
      },
      payload: body,
    });
  }

  function event(suffix: string) {
    const id = `evt_sec_${harness.runId}_${suffix}`;
    return { id, body: JSON.stringify({ id, type: 'security.test' }) };
  }

  async function stored(id: string) {
    const result = await harness.owner.query(
      `SELECT received_at FROM foundation.inbound_events
       WHERE provider='simulator' AND event_id=$1`,
      [id],
    );
    return result.rows;
  }

  const now = () => Math.floor(Date.now() / 1000);

  it('rejects a bad signature', async () => {
    const { id, body } = event('bad');
    const cases = [
      undefined,
      'v1=abc',
      `t=${now()},v1=zz`,
      sign(body, now(), 'attacker-secret'),
      sign(JSON.stringify({ id, type: 'refund.succeeded' }), now()),
    ];
    for (const signature of cases) {
      const response = await deliver(body, signature);
      expect(response.statusCode, signature).toBe(401);
    }
    expect(await stored(id)).toHaveLength(0);
  });

  it('rejects a replay of an old or future-dated delivery', async () => {
    const { id, body } = event('stale');
    for (const timestamp of [now() - 301, now() + 301]) {
      const response = await deliver(body, sign(body, timestamp));
      expect(response.statusCode).toBe(401);
    }
    expect(await stored(id)).toHaveLength(0);
  });

  it('stores a replayed event only once', async () => {
    const { id, body } = event('replay');
    const signature = sign(body, now());
    const first = await deliver(body, signature);
    expect(first.statusCode).toBe(200);
    const [original] = await stored(id);
    const replay = await deliver(body, signature);
    expect(replay.statusCode).toBe(200);
    const rows = await stored(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].received_at).toEqual(original.received_at);
  });
});

describe('input handling', () => {
  it('treats SQL syntax in search input as data', async () => {
    const injected = await harness.send(
      supervisor,
      'GET',
      `/api/charges?q=${encodeURIComponent("' OR 1=1--")}`,
    );
    expect(injected.statusCode).toBe(200);
    expect(injected.json().items).toEqual([]);
    const cursor = await harness.send(
      supervisor,
      'GET',
      `/api/charges?cursor=${encodeURIComponent("2026-01-01~x' OR '1'='1")}`,
    );
    expect(cursor.statusCode).toBeLessThan(500);
  });

  it('masks customer email in search results', async () => {
    const chargeId = await harness.charge(10_000n);
    const response = await harness.send(
      agent,
      'GET',
      `/api/charges?q=${chargeId}`,
    );
    expect(response.body).not.toContain('@example.test');
  });

  it('ignores an unknown session cookie', async () => {
    const response = await harness.send(undefined, 'GET', '/api/session', {
      cookie: 'sid=forged-session-id',
    });
    expect(response.json().authenticated).toBe(false);
  });
});

describe('object access', () => {
  it('hides refunds of other requesters from an Agent', async () => {
    const chargeId = await harness.charge(100_000n);
    const created = await requestRefund(supervisor, chargeId, '30000');
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const detail = await harness.send(agent, 'GET', `/api/refunds/${id}`);
    expect(detail.statusCode).toBe(404);
    const list = await harness.send(agent, 'GET', '/api/refunds');
    expect(list.statusCode).toBe(200);
    expect(
      (list.json().items as { id: string }[]).map((item) => item.id),
    ).not.toContain(id);
    const owner = await harness.send(supervisor, 'GET', `/api/refunds/${id}`);
    expect(owner.statusCode).toBe(200);
  });
});

describe('app_runtime database role', () => {
  it('cannot change or remove audit events', async () => {
    const attempts = [
      "UPDATE foundation.audit_events SET result='allowed' WHERE seq=1",
      'DELETE FROM foundation.audit_events WHERE seq=1',
      'TRUNCATE foundation.audit_events',
      'ALTER TABLE foundation.audit_events DISABLE TRIGGER ALL',
      'CREATE TABLE public.security_probe(id int)',
    ];
    for (const sql of attempts) {
      await expect(harness.runtime.query(sql), sql).rejects.toThrow(
        /permission denied|must be owner/,
      );
    }
  });

  it('has no elevated role attributes', async () => {
    const result = await harness.runtime.query(
      `SELECT current_user AS name, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
       FROM pg_roles WHERE rolname=current_user`,
    );
    expect(result.rows[0]).toEqual({
      name: 'app_runtime',
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
    });
  });
});

describe('refunds console controls', () => {
  it('requires a reveal reason and stores it in the audit event', async () => {
    const chargeId = await harness.charge(10_000n);
    const url = `/api/charges/${chargeId}/reveal-email`;
    for (const body of [{}, { reason: 'short' }]) {
      const rejected = await harness.send(supervisor, 'POST', url, { body });
      expect(rejected.statusCode, rejected.body).toBe(400);
    }
    const reason = 'Customer asked for a receipt by email.';
    const revealed = await harness.send(supervisor, 'POST', url, {
      body: { reason },
    });
    expect(revealed.statusCode, revealed.body).toBe(200);
    const audit = await harness.owner.query(
      `SELECT event_data->'after'->>'reason' AS reason
       FROM foundation.audit_events
       WHERE action='customer.email_revealed' AND object_id=$1`,
      [chargeId],
    );
    expect(audit.rows).toEqual([{ reason }]);
  });

  it('shows each approval step in the refund timeline', async () => {
    const chargeId = await harness.charge(1_000_000n);
    const created = await requestRefund(supervisor, chargeId, '500100');
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().tier).toBe('dual');
    const approvalId = await approvalFor(created.json().id);
    for (const [persona, stepIndex] of [
      [secondSupervisor, 0],
      [finance, 1],
    ] as const) {
      const approved = await harness.send(
        persona,
        'POST',
        `/api/approvals/${approvalId}/approve`,
        { body: { stepIndex } },
      );
      expect(approved.statusCode, approved.body).toBe(200);
    }
    const detail = await harness.send(
      supervisor,
      'GET',
      `/api/refunds/${created.json().id}`,
    );
    expect(detail.statusCode, detail.body).toBe(200);
    const steps = (
      detail.json().timeline as Array<{
        action: string;
        actorId: string;
        after: { stepIndex: number } | null;
      }>
    )
      .filter((event) => event.action === 'approval.approved')
      .map((event) => [event.actorId, event.after?.stepIndex]);
    expect(steps).toEqual([
      [secondSupervisor.userId, 0],
      [finance.userId, 1],
    ]);
  });

  it('sorts payments by amount on the server and pages in that order', async () => {
    const amounts = (items: Array<{ amount_minor: string }>) =>
      items.map((item) => BigInt(item.amount_minor));
    for (const [sort, ordered] of [
      ['amount_desc', (a: bigint, b: bigint) => a >= b],
      ['amount_asc', (a: bigint, b: bigint) => a <= b],
    ] as const) {
      const first = await harness.send(
        agent,
        'GET',
        `/api/charges?sort=${sort}&limit=5`,
      );
      expect(first.statusCode, first.body).toBe(200);
      const page = first.json();
      const next = await harness.send(
        agent,
        'GET',
        `/api/charges?sort=${sort}&limit=5&cursor=${encodeURIComponent(page.nextCursor)}`,
      );
      expect(next.statusCode, next.body).toBe(200);
      const values = [...amounts(page.items), ...amounts(next.json().items)];
      expect(values.length).toBe(10);
      values.slice(1).forEach((value, index) => {
        expect(ordered(values[index]!, value), `${sort} at ${index}`).toBe(
          true,
        );
      });
    }
    const invalid = await harness.send(
      agent,
      'GET',
      `/api/charges?sort=amount_desc&cursor=${encodeURIComponent('2026-01-01~ch_1')}`,
    );
    expect(invalid.statusCode).toBe(400);
  });
});
