import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import {
  authorize,
  configureFoundation,
  registerTool,
  type FoundationUser,
} from '@internal-tools/foundation';
import { kycRegistration, kycRoutes } from './api.js';
import { kycTool } from './registry.js';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgres://tools:local-development-only@localhost:5432/internal_tools',
});
const app = Fastify();
configureFoundation(app, {
  pool,
  currentUser: async (request) => {
    const header = request.headers['x-test-user'];
    return typeof header === 'string'
      ? (JSON.parse(header) as FoundationUser)
      : undefined;
  },
  verifyCsrf: (request) => request.headers['x-csrf-token'] === 'test-token',
});
registerTool(app, kycRegistration);

const user = (id: string, roles: string[]): FoundationUser => ({
  id,
  displayName: id,
  roles,
});
const analyst = user('test-kyc-analyst', ['kyc_analyst']);
const analyst2 = user('test-kyc-analyst-2', ['kyc_analyst']);
const lead = user('test-kyc-lead', ['kyc_lead']);
const lead2 = user('test-kyc-lead-2', ['kyc_lead']);
const auditor = user('test-auditor', ['auditor']);
const platformAdmin = user('test-platform-admin', ['platform_admin']);
const refundAgent = user('test-refund-agent', ['agent']);

const createdIds: string[] = [];

async function call(
  actor: FoundationUser | undefined,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
  options: { csrf?: boolean } = {},
) {
  const headers: Record<string, string> = {};
  if (actor) headers['x-test-user'] = JSON.stringify(actor);
  if (method === 'POST') {
    if (options.csrf !== false) headers['x-csrf-token'] = 'test-token';
    headers['idempotency-key'] = randomUUID();
  }
  const response = await app.inject({
    method,
    url,
    headers,
    ...(method === 'POST' ? { payload: payload ?? {} } : {}),
  });
  return { status: response.statusCode, body: response.json() };
}

async function createCase(riskScore: number, status = 'new') {
  const reference = `KYC-9${String(randomInt(0, 9_999_999)).padStart(7, '0')}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO kyc.cases(reference,customer_name,date_of_birth,national_id,country,
       risk_score,status,assignee,sla_due_at)
     VALUES($1,'Test Person','1980-02-03','SYN-TEST-0001','GB',$2,$3,
       CASE WHEN $3='new' THEN NULL ELSE $4 END, now() + interval '2 days')
     RETURNING id`,
    [reference, riskScore, status, analyst.id],
  );
  const id = result.rows[0]!.id;
  createdIds.push(id);
  return id;
}

async function caseRow(id: string) {
  const result = await pool.query(
    'SELECT status,assignee,decided_by,pending_approval_id FROM kyc.cases WHERE id=$1',
    [id],
  );
  return result.rows[0];
}

async function auditEvents(id: string, action: string) {
  const result = await pool.query<{
    actor_id: string;
    result: string;
    event_data: Record<string, unknown>;
  }>(
    `SELECT actor_id,result,event_data FROM foundation.audit_events
     WHERE object_type='kyc_case' AND object_id=$1 AND action=$2 ORDER BY seq`,
    [id, action],
  );
  return result.rows;
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  if (createdIds.length) {
    const approvals = await pool.query<{ id: string }>(
      `SELECT id FROM foundation.approval_requests
       WHERE tool_id='kyc' AND object_id = ANY($1::text[])`,
      [createdIds],
    );
    await pool.query('DELETE FROM kyc.cases WHERE id = ANY($1::uuid[])', [
      createdIds,
    ]);
    const approvalIds = approvals.rows.map((row) => row.id);
    await pool.query(
      'DELETE FROM foundation.approvals WHERE approval_request_id = ANY($1::uuid[])',
      [approvalIds],
    );
    await pool.query(
      'DELETE FROM foundation.approval_requests WHERE id = ANY($1::uuid[])',
      [approvalIds],
    );
  }
  await app.close();
  await pool.end();
});

describe('KYC permission matrix', () => {
  const missing = randomUUID();
  const roles = [analyst, lead, auditor, platformAdmin, refundAgent];
  const bodies: Record<string, Record<string, unknown>> = {
    reveal: {
      field: 'national_id',
      reason: 'Check the document against the case record.',
    },
    reject: { reason: 'The document does not match the record.' },
    escalate: { reason: 'The address history needs a lead review.' },
  };

  for (const route of kycRoutes) {
    for (const actor of roles) {
      const allowed = authorize(actor, route.permission, kycTool);
      it(`${route.method} ${route.path} is ${allowed ? 'allowed' : 'denied'} for ${actor.roles[0]}`, async () => {
        const action = route.path.split('/').at(-1)!;
        const url = route.path.replace(':id', missing);
        const response = await call(
          actor,
          route.method as 'GET' | 'POST',
          url,
          bodies[action],
        );
        if (allowed) {
          expect([200, 404]).toContain(response.status);
        } else {
          expect(response.status).toBe(403);
          expect(response.body.error).toMatch(/do not have permission/);
        }
      });
    }
    it(`${route.method} ${route.path} needs a signed-in user`, async () => {
      const response = await call(
        undefined,
        route.method as 'GET' | 'POST',
        route.path.replace(':id', missing),
      );
      expect(response.status).toBe(401);
    });
  }

  it('rejects a state change without the CSRF token', async () => {
    const id = await createCase(10);
    const response = await call(
      analyst,
      'POST',
      `/api/tools/kyc/cases/${id}/claim`,
      {},
      { csrf: false },
    );
    expect(response.status).toBe(403);
    expect((await caseRow(id)).status).toBe('new');
  });
});

describe('KYC masking and audited reveal', () => {
  it('masks personal data in the list and the detail for every role', async () => {
    const id = await createCase(30);
    for (const actor of [analyst, lead, auditor]) {
      const list = await call(
        actor,
        'GET',
        '/api/tools/kyc/cases?q=Test%20Person&limit=100',
      );
      expect(list.status).toBe(200);
      const item = list.body.items.find(
        (entry: { id: string }) => entry.id === id,
      );
      expect(item).toMatchObject({
        customer_name: '••••••••',
        date_of_birth: '••••••••',
        national_id: '[REDACTED]',
      });
      const detail = await call(actor, 'GET', `/api/tools/kyc/cases/${id}`);
      expect(detail.body.national_id).toBe('[REDACTED]');
      expect(JSON.stringify(detail.body)).not.toContain('SYN-TEST-0001');
    }
  });

  it('reveals one field after a claim and records the reason', async () => {
    const id = await createCase(30);
    const reveal = `/api/tools/kyc/cases/${id}/reveal`;
    const reason = 'Match the national ID with the uploaded passport.';

    const shortReason = await call(analyst, 'POST', reveal, {
      field: 'national_id',
      reason: 'short',
    });
    expect(shortReason.status).toBe(400);

    const unclaimed = await call(analyst, 'POST', reveal, {
      field: 'national_id',
      reason,
    });
    expect(unclaimed.status).toBe(403);
    expect(await auditEvents(id, 'kyc.pii_reveal_denied')).toHaveLength(1);

    expect(
      (await call(analyst, 'POST', `/api/tools/kyc/cases/${id}/claim`)).status,
    ).toBe(200);
    const other = await call(analyst2, 'POST', reveal, {
      field: 'national_id',
      reason,
    });
    expect(other.status).toBe(403);

    const revealed = await call(analyst, 'POST', reveal, {
      field: 'national_id',
      reason,
    });
    expect(revealed.status).toBe(200);
    expect(revealed.body).toEqual({
      field: 'national_id',
      value: 'SYN-TEST-0001',
    });
    const events = await auditEvents(id, 'kyc.pii_revealed');
    expect(events).toHaveLength(1);
    expect(events[0]!.actor_id).toBe(analyst.id);
    expect(JSON.stringify(events[0]!.event_data)).toContain(reason);
    expect(JSON.stringify(events[0]!.event_data)).toContain('national_id');
    expect(JSON.stringify(events[0]!.event_data)).not.toContain(
      'SYN-TEST-0001',
    );

    const auditorReveal = await call(auditor, 'POST', reveal, {
      field: 'customer_name',
      reason,
    });
    expect(auditorReveal.status).toBe(403);
  });
});

describe('KYC workflow', () => {
  const path = (id: string, action: string) =>
    `/api/tools/kyc/cases/${id}/${action}`;
  const reason = { reason: 'The document does not match the record.' };

  it('returns 409 for invalid transitions', async () => {
    const id = await createCase(20);
    expect((await call(analyst, 'POST', path(id, 'approve'))).status).toBe(409);
    expect(
      (await call(analyst, 'POST', path(id, 'reject'), reason)).status,
    ).toBe(409);
    expect((await call(analyst, 'POST', path(id, 'claim'))).status).toBe(200);
    expect((await call(analyst2, 'POST', path(id, 'claim'))).status).toBe(409);
    expect((await call(analyst2, 'POST', path(id, 'approve'))).status).toBe(
      403,
    );
    expect(
      (await call(analyst, 'POST', path(id, 'reject'), reason)).status,
    ).toBe(200);
    expect((await call(analyst, 'POST', path(id, 'approve'))).status).toBe(409);
    expect(
      (await call(analyst, 'POST', path(id, 'escalate'), reason)).status,
    ).toBe(409);
    expect((await caseRow(id)).status).toBe('rejected');
    await expect(
      pool.query(`UPDATE kyc.cases SET status='new' WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('approves a standard-risk case without a lead', async () => {
    const id = await createCase(69);
    await call(analyst, 'POST', path(id, 'claim'));
    const approved = await call(analyst, 'POST', path(id, 'approve'));
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(await caseRow(id)).toMatchObject({
      status: 'approved',
      decided_by: analyst.id,
      pending_approval_id: null,
    });
  });

  it('sends an escalated case to a lead', async () => {
    const id = await createCase(40);
    await call(analyst, 'POST', path(id, 'claim'));
    expect(
      (await call(analyst, 'POST', path(id, 'escalate'), reason)).status,
    ).toBe(200);
    expect((await call(analyst, 'POST', path(id, 'approve'))).status).toBe(403);
    expect(await auditEvents(id, 'kyc.case_approve_denied')).toHaveLength(1);
    const decided = await call(lead, 'POST', path(id, 'reject'), reason);
    expect(decided.status).toBe(200);
    expect(await caseRow(id)).toMatchObject({
      status: 'rejected',
      decided_by: lead.id,
    });
  });

  it('needs a different KYC lead to approve a high-risk case', async () => {
    const id = await createCase(70);
    await call(lead, 'POST', path(id, 'claim'));
    const requested = await call(lead, 'POST', path(id, 'approve'), {
      note: 'Documents are complete.',
    });
    expect(requested.status).toBe(202);
    const approvalId = requested.body.approval_id as string;
    expect(await caseRow(id)).toMatchObject({
      status: 'in_review',
      pending_approval_id: approvalId,
    });
    expect((await call(lead, 'POST', path(id, 'reject'), reason)).status).toBe(
      409,
    );

    const analystInbox = await call(analyst, 'GET', '/api/approvals?tool=kyc');
    expect(
      analystInbox.body.items.some(
        (item: { approval_id: string }) => item.approval_id === approvalId,
      ),
    ).toBe(false);
    const leadInbox = await call(lead2, 'GET', '/api/approvals?tool=kyc');
    expect(leadInbox.body.items).toContainEqual(
      expect.objectContaining({
        approval_id: approvalId,
        tool_id: 'kyc',
        case_id: id,
        risk_score: 70,
      }),
    );

    const self = await call(
      lead,
      'POST',
      `/api/approvals/${approvalId}/approve`,
    );
    expect(self.status).toBe(403);
    const byAnalyst = await call(
      analyst,
      'POST',
      `/api/approvals/${approvalId}/approve`,
    );
    expect(byAnalyst.status).toBe(403);
    expect((await caseRow(id)).status).toBe('in_review');

    const approved = await call(
      lead2,
      'POST',
      `/api/approvals/${approvalId}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(await caseRow(id)).toMatchObject({
      status: 'approved',
      decided_by: lead2.id,
      pending_approval_id: null,
    });
    const events = await auditEvents(id, 'kyc.case_approved');
    expect(events[0]!.actor_id).toBe(lead2.id);
  });

  it('keeps the case open when a lead declines the approval', async () => {
    const id = await createCase(95);
    await call(analyst, 'POST', path(id, 'claim'));
    const requested = await call(analyst, 'POST', path(id, 'approve'));
    const approvalId = requested.body.approval_id as string;
    const declined = await call(
      lead,
      'POST',
      `/api/approvals/${approvalId}/reject`,
    );
    expect(declined.status).toBe(200);
    expect(await caseRow(id)).toMatchObject({
      status: 'in_review',
      pending_approval_id: null,
    });
    expect(
      (await call(analyst, 'POST', path(id, 'reject'), reason)).status,
    ).toBe(200);
  });
});

describe('KYC keyset pagination', () => {
  const walk = async (query: string, pages: number) => {
    const seen: Array<Array<{ id: string; risk_score: number }>> = [];
    let cursor: string | null = null;
    for (let page = 0; page < pages; page += 1) {
      const response = await call(
        auditor,
        'GET',
        `/api/tools/kyc/cases?${query}${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(response.status).toBe(200);
      seen.push(response.body.items);
      cursor = response.body.nextCursor;
      if (!cursor) break;
    }
    return seen;
  };

  it('returns stable pages that do not overlap', async () => {
    const query = 'country=GB&sort=risk_score&dir=desc&limit=50';
    const first = await walk(query, 5);
    const second = await walk(query, 5);
    expect(first).toEqual(second);
    const ids = first.flat().map((item) => item.id);
    expect(ids).toHaveLength(250);
    expect(new Set(ids).size).toBe(ids.length);
    const expected = await pool.query<{ id: string }>(
      `SELECT id FROM kyc.cases WHERE country='GB'
       ORDER BY risk_score DESC, id DESC LIMIT 250`,
    );
    expect(ids).toEqual(expected.rows.map((row) => row.id));
  });

  it('walks every sort key and filter in order', async () => {
    for (const query of [
      'sort=sla_due_at&dir=asc&limit=100',
      'sort=created_at&dir=desc&status=in_review&limit=100',
      'sort=risk_score&dir=asc&risk=high&limit=100',
    ]) {
      const ids = (await walk(query, 3)).flat().map((item) => item.id);
      expect(ids).toHaveLength(300);
      expect(new Set(ids).size).toBe(300);
    }
  });

  it('keeps microsecond timestamps apart across pages', async () => {
    const ids = [
      await createCase(10),
      await createCase(20),
      await createCase(30),
    ];
    await pool.query(
      `UPDATE kyc.cases SET country='QZ',
         created_at=timestamptz '2020-01-01 00:00:00.000100+00'
           + (array_position($1::uuid[], id) * interval '100 microseconds')
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    for (const dir of ['asc', 'desc']) {
      const seen = (
        await walk(`country=QZ&sort=created_at&dir=${dir}&limit=1`, 5)
      )
        .flat()
        .map((item) => item.id);
      expect(seen).toEqual(dir === 'asc' ? ids : [...ids].reverse());
    }
  });

  it('rejects a changed page token', async () => {
    const response = await call(
      auditor,
      'GET',
      '/api/tools/kyc/cases?cursor=bm90LWEtY3Vyc29y',
    );
    expect(response.status).toBe(400);
  });

  it('uses an index for the filtered queue query', async () => {
    const plan = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT id FROM kyc.cases WHERE country='GB' AND status='new'
       ORDER BY sla_due_at, id LIMIT 26`,
    );
    const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(text).toMatch(/Index/);
    expect(text).not.toMatch(/OFFSET/i);
  });
});
