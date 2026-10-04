import { randomUUID } from 'node:crypto';
import { registeredTools } from '@internal-tools/foundation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type Persona } from './harness.js';

const personaRoles = {
  agent: ['agent'],
  supervisor: ['supervisor'],
  finance: ['finance'],
  auditor: ['auditor'],
  platform_admin: ['platform_admin'],
  agent_supervisor: ['agent', 'supervisor'],
  flag_editor: ['flag_editor'],
  flag_approver: ['flag_approver'],
  no_role: [],
} satisfies Record<string, string[]>;
type PersonaName = keyof typeof personaRoles;
const personaNames = Object.keys(personaRoles) as PersonaName[];

const readers: PersonaName[] = [
  'agent',
  'supervisor',
  'finance',
  'auditor',
  'agent_supervisor',
];
const approvers: PersonaName[] = ['supervisor', 'finance', 'agent_supervisor'];
const flagReaders: PersonaName[] = [
  'flag_editor',
  'flag_approver',
  'auditor',
  'platform_admin',
];
const missingFlag = 'matrix.missing_flag';
const permissionDenied = 'You do not have permission to perform this action.';

interface Fixture {
  chargeId: string;
  lockedApprovalId: string;
  paused: boolean;
}

interface MatrixCase {
  route: string;
  registered: boolean;
  allowed: PersonaName[];
  allowedStatus: number;
  allowedError?: string;
  deniedError?: string;
  request(fixture: Fixture): {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    body?: unknown;
    headers?: Record<string, string>;
  };
}

const cases: MatrixCase[] = [
  {
    route: 'GET /api/charges',
    registered: true,
    allowed: readers,
    allowedStatus: 200,
    request: (f) => ({ method: 'GET', url: `/api/charges?q=${f.chargeId}` }),
  },
  {
    route: 'POST /api/charges/:id/reveal-email',
    registered: true,
    allowed: ['supervisor', 'finance', 'auditor', 'agent_supervisor'],
    allowedStatus: 200,
    request: (f) => ({
      method: 'POST',
      url: `/api/charges/${f.chargeId}/reveal-email`,
    }),
  },
  {
    route: 'GET /api/charges/:id',
    registered: true,
    allowed: readers,
    allowedStatus: 200,
    request: (f) => ({ method: 'GET', url: `/api/charges/${f.chargeId}` }),
  },
  {
    route: 'POST /api/refunds',
    registered: true,
    allowed: ['agent', 'supervisor', 'agent_supervisor'],
    allowedStatus: 404,
    request: () => ({
      method: 'POST',
      url: '/api/refunds',
      headers: { 'idempotency-key': randomUUID() },
      body: {
        chargeId: 'ch_sec_missing',
        amountMinor: '100',
        reasonCode: 'goodwill',
        note: 'Security matrix test request.',
      },
    }),
  },
  {
    route: 'GET /api/refunds',
    registered: true,
    allowed: readers,
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/refunds' }),
  },
  {
    route: 'GET /api/refunds?format=csv',
    registered: false,
    allowed: ['finance', 'auditor'],
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/refunds?format=csv' }),
  },
  {
    route: 'GET /api/refunds/:id',
    registered: true,
    allowed: readers,
    allowedStatus: 404,
    request: () => ({ method: 'GET', url: `/api/refunds/${randomUUID()}` }),
  },
  {
    route: 'POST /api/reconciliation/run',
    registered: true,
    allowed: ['finance'],
    allowedStatus: 202,
    request: () => ({ method: 'POST', url: '/api/reconciliation/run' }),
  },
  {
    route: 'GET /api/exceptions',
    registered: true,
    allowed: ['finance'],
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/exceptions' }),
  },
  {
    route: 'POST /api/exceptions/:id/resolve',
    registered: true,
    allowed: ['finance'],
    allowedStatus: 404,
    request: () => ({
      method: 'POST',
      url: `/api/exceptions/${randomUUID()}/resolve`,
      body: { resolutionCode: 'security_test', note: 'Security matrix test.' },
    }),
  },
  {
    route: 'GET /api/dashboard',
    registered: true,
    allowed: [...readers, 'platform_admin'],
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/dashboard' }),
  },
  {
    route: 'POST /api/admin/pause',
    registered: true,
    allowed: ['platform_admin'],
    allowedStatus: 200,
    request: (f) => ({
      method: 'POST',
      url: '/api/admin/pause',
      body: { paused: f.paused },
    }),
  },
  {
    route: 'GET /api/tools/feature-flags/flags',
    registered: true,
    allowed: flagReaders,
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/tools/feature-flags/flags' }),
  },
  {
    route: 'GET /api/tools/feature-flags/flags/:key',
    registered: true,
    allowed: flagReaders,
    allowedStatus: 404,
    request: () => ({
      method: 'GET',
      url: `/api/tools/feature-flags/flags/${missingFlag}`,
    }),
  },
  {
    route: 'PUT /api/tools/feature-flags/flags/:key/environments/:environment',
    registered: true,
    allowed: ['flag_editor'],
    allowedStatus: 404,
    request: () => ({
      method: 'PUT',
      url: `/api/tools/feature-flags/flags/${missingFlag}/environments/staging`,
      headers: { 'idempotency-key': randomUUID() },
      body: { enabled: true, rolloutPercent: 10, expectedVersion: 1 },
    }),
  },
  {
    route: 'GET /api/tools/feature-flags/flags/:key/history',
    registered: true,
    allowed: flagReaders,
    allowedStatus: 404,
    request: () => ({
      method: 'GET',
      url: `/api/tools/feature-flags/flags/${missingFlag}/history`,
    }),
  },
  {
    route: 'GET /api/approvals',
    registered: false,
    allowed: personaNames,
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/approvals?tool=refunds' }),
  },
  {
    route: 'POST /api/approvals/:id/approve',
    registered: false,
    allowed: approvers,
    allowedStatus: 403,
    allowedError: 'Your role is not allowed for this approval step.',
    deniedError: permissionDenied,
    request: (f) => ({
      method: 'POST',
      url: `/api/approvals/${f.lockedApprovalId}/approve`,
      body: {},
    }),
  },
  {
    route: 'POST /api/approvals/:id/reject',
    registered: false,
    allowed: approvers,
    allowedStatus: 403,
    allowedError: 'Your role is not allowed for this approval step.',
    deniedError: permissionDenied,
    request: (f) => ({
      method: 'POST',
      url: `/api/approvals/${f.lockedApprovalId}/reject`,
      body: {},
    }),
  },
  {
    route: 'GET /api/audit',
    registered: false,
    allowed: ['auditor', 'platform_admin'],
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/audit' }),
  },
  {
    route: 'GET /api/audit/verify',
    registered: false,
    allowed: ['auditor', 'platform_admin'],
    allowedStatus: 200,
    request: () => ({ method: 'GET', url: '/api/audit/verify' }),
  },
];

let harness: Harness;
let fixture: Fixture;
const personas = new Map<PersonaName, Persona>();

beforeAll(async () => {
  harness = await startHarness();
  for (const name of personaNames) {
    personas.set(name, await harness.persona(name, personaRoles[name]));
  }
  const chargeId = await harness.charge(50_000n);
  const approval = await harness.owner.query<{ id: string }>(
    `INSERT INTO foundation.approval_requests(
       tool_id,action,object_type,object_id,requester_id,tier,policy_version,
       content_hash,steps,status,expires_at
     ) VALUES('refunds','refund.execute','refund',$1,$2,'supervisor',1,'sec',
       $3::jsonb,'pending',now()+interval '1 day')
     RETURNING id::text`,
    [
      `sec-${harness.runId}-locked`,
      `sectest-${harness.runId}-requester`,
      JSON.stringify([{ roles: ['no_such_role'], approvals: [] }]),
    ],
  );
  const settings = await harness.owner.query<{ execution_paused: boolean }>(
    "SELECT execution_paused FROM foundation.tool_settings WHERE tool_id='refunds'",
  );
  fixture = {
    chargeId,
    lockedApprovalId: approval.rows[0]!.id,
    paused: settings.rows[0]?.execution_paused ?? false,
  };
});

afterAll(async () => {
  await harness?.close();
});

describe('permission matrix', () => {
  it('lists every registered route of every tool', () => {
    const registered = registeredTools(harness.app).flatMap((registration) =>
      registration.routes.map((route) => `${route.method} ${route.path}`),
    );
    const expected = cases
      .filter((entry) => entry.registered)
      .map((entry) => entry.route);
    expect([...registered].sort()).toEqual([...expected].sort());
  });

  it('registers every core route that the matrix covers', () => {
    for (const entry of cases.filter((item) => !item.registered)) {
      const [method, path] = entry.route.split(' ') as [string, string];
      expect(
        harness.app.hasRoute({
          method: method as 'GET',
          url: path.split('?')[0]!,
        }),
        entry.route,
      ).toBe(true);
    }
  });

  for (const entry of cases) {
    it(`${entry.route} rejects an anonymous caller`, async () => {
      const request = entry.request(fixture);
      const response = await harness.send(
        undefined,
        request.method,
        request.url,
        { body: request.body, headers: request.headers },
      );
      expect(response.statusCode).toBe(401);
    });

    for (const name of personaNames) {
      const allowed = entry.allowed.includes(name);
      it(`${entry.route} ${allowed ? 'allows' : 'denies'} ${name}`, async () => {
        const request = entry.request(fixture);
        const response = await harness.send(
          personas.get(name),
          request.method,
          request.url,
          { body: request.body, headers: request.headers },
        );
        if (allowed) {
          expect(response.statusCode, response.body).toBe(entry.allowedStatus);
          if (entry.allowedError) {
            expect(response.json().error).toBe(entry.allowedError);
          }
        } else {
          expect(response.statusCode, response.body).toBe(403);
          if (entry.deniedError) {
            expect(response.json().error).toBe(entry.deniedError);
          }
        }
      });
    }
  }

  it('writes an audit event for a denied route call', async () => {
    const agent = personas.get('agent')!;
    const response = await harness.send(agent, 'GET', '/api/exceptions');
    expect(response.statusCode).toBe(403);
    const audit = await harness.owner.query(
      `SELECT 1 FROM foundation.audit_events
       WHERE actor_id=$1 AND action='permission.denied'
         AND object_id='exception.resolve' AND result='denied'`,
      [agent.userId],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('hides approval requests from roles that cannot decide them', async () => {
    for (const name of personaNames) {
      const response = await harness.send(
        personas.get(name),
        'GET',
        '/api/approvals?tool=refunds',
      );
      const ids = (response.json().items as { approval_id: string }[]).map(
        (item) => item.approval_id,
      );
      expect(ids).not.toContain(fixture.lockedApprovalId);
      if (!approvers.includes(name)) expect(ids).toEqual([]);
    }
  });
});
