import {
  authorize,
  defineRoute,
  requestHash,
  tierFor,
  type ApprovalHandler,
  type FoundationContext,
  type Policy,
  type ToolRegistration,
} from '@internal-tools/foundation';
import { z } from 'zod';
import { kycHighRiskThreshold, kycTool } from './registry.js';

export const caseStatuses = [
  'new',
  'in_review',
  'escalated',
  'approved',
  'rejected',
] as const;
export type CaseStatus = (typeof caseStatuses)[number];

export const piiFields = {
  customer_name: 'confidential',
  date_of_birth: 'confidential',
  national_id: 'restricted',
} as const;
export type PiiField = keyof typeof piiFields;

const sortColumns = {
  sla_due_at: 'sla_due_at',
  created_at: 'created_at',
  risk_score: 'risk_score',
} as const;
type SortKey = keyof typeof sortColumns;

export const riskBands = {
  low: [0, 39],
  medium: [40, 69],
  high: [kycHighRiskThreshold, 100],
} as const;

const approvalAction = 'kyc.case_approval';
const approvalPolicy = kycTool.approvalRules![approvalAction] as Policy<{
  riskScore: number;
}>;

const CaseQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(caseStatuses).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  risk: z.enum(['low', 'medium', 'high']).optional(),
  assignee: z.enum(['me']).optional(),
  sort: z
    .enum(['sla_due_at', 'created_at', 'risk_score'])
    .default('sla_due_at'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
type CaseQueryInput = z.infer<typeof CaseQuery>;

const CaseParams = z.object({ id: z.string().uuid() });
type CaseParamsInput = z.infer<typeof CaseParams>;

const Reason = z.string().trim().min(10).max(500);
const RevealBody = z.object({
  field: z.enum(['customer_name', 'date_of_birth', 'national_id']),
  reason: Reason,
});
const ApproveBody = z.object({ note: z.string().trim().max(500).optional() });
const ReasonBody = z.object({ reason: Reason });

const CursorValue = z.tuple([z.union([z.string(), z.number()]), z.string()]);

const caseColumns = `id,reference,customer_name,to_char(date_of_birth,'YYYY-MM-DD') AS date_of_birth,
  national_id,country,risk_score,status,assignee,sla_due_at,created_at,updated_at,
  decided_by,decided_at,pending_approval_id`;

interface CaseRow {
  id: string;
  reference: string;
  customer_name: string;
  date_of_birth: string;
  national_id: string;
  country: string;
  risk_score: number;
  status: CaseStatus;
  assignee: string | null;
  sla_due_at: Date;
  created_at: Date;
  updated_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  pending_approval_id: string | null;
}

type Context = FoundationContext<unknown, unknown, unknown>;

function statusError(message: string, statusCode: number): never {
  throw Object.assign(new Error(message), { statusCode });
}

export function riskBand(score: number): keyof typeof riskBands {
  if (score >= riskBands.high[0]) return 'high';
  if (score >= riskBands.medium[0]) return 'medium';
  return 'low';
}

function present(row: CaseRow, mask: Context['mask']) {
  return {
    id: row.id,
    reference: row.reference,
    customer_name: mask(row.customer_name, piiFields.customer_name),
    date_of_birth: mask(row.date_of_birth, piiFields.date_of_birth),
    national_id: mask(row.national_id, piiFields.national_id),
    country: row.country,
    risk_score: row.risk_score,
    risk_band: riskBand(row.risk_score),
    status: row.status,
    assignee: row.assignee,
    sla_due_at: row.sla_due_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    pending_approval_id: row.pending_approval_id,
  };
}

export function encodeCursor(value: string | number, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString('base64url');
}

function decodeCursor(cursor: string, sort: SortKey) {
  try {
    const parsed = CursorValue.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    const [value, id] = parsed;
    const validId = z.string().uuid().safeParse(id).success;
    const validValue =
      sort === 'risk_score'
        ? typeof value === 'number' && Number.isInteger(value)
        : typeof value === 'string' && !Number.isNaN(Date.parse(value));
    if (validId && validValue) return { value, id };
  } catch {
    // An invalid token gets the same answer as a malformed one.
  }
  return statusError('The page token is not valid.', 400);
}

function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function cursorValue(row: CaseRow, sort: SortKey): string | number {
  if (sort === 'risk_score') return row.risk_score;
  return new Date(row[sort]).toISOString();
}

async function lockCase(tx: Context['tx'], id: string): Promise<CaseRow> {
  const result = await tx.query<CaseRow>(
    `SELECT ${caseColumns} FROM kyc.cases WHERE id=$1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return statusError('Case not found.', 404);
  return row;
}

async function updateCase(
  tx: Context['tx'],
  sql: string,
  values: unknown[],
): Promise<CaseRow> {
  try {
    const result = await tx.query<CaseRow>(
      `${sql} RETURNING ${caseColumns}`,
      values,
    );
    return result.rows[0]!;
  } catch (error) {
    if ((error as { code?: string }).code === '23514') {
      return statusError('This status change is not allowed.', 409);
    }
    throw error;
  }
}

function contentHash(row: CaseRow) {
  return requestHash({
    caseId: row.id,
    riskScore: row.risk_score,
    status: row.status,
    decision: 'approve',
  });
}

async function denied(
  context: Context,
  caseId: string,
  action: string,
  message: string,
) {
  await context.audit({
    action,
    objectType: 'kyc_case',
    objectId: caseId,
    result: 'denied',
  });
  return { statusCode: 403, body: { error: message } };
}

async function clearStaleApproval(context: Context, row: CaseRow) {
  if (!row.pending_approval_id) return row;
  const approval = await context.tx.query<{ open: boolean }>(
    `SELECT status='pending' AND expires_at>now() AS open
     FROM foundation.approval_requests WHERE id=$1`,
    [row.pending_approval_id],
  );
  if (approval.rows[0]?.open) {
    return statusError('This case waits for a KYC lead approval.', 409);
  }
  const updated = await updateCase(
    context.tx,
    'UPDATE kyc.cases SET pending_approval_id=NULL WHERE id=$1',
    [row.id],
  );
  await context.audit({
    action: 'kyc.case_approval_lapsed',
    objectType: 'kyc_case',
    objectId: row.id,
    before: { pendingApprovalId: row.pending_approval_id },
    after: { pendingApprovalId: null },
  });
  return updated;
}

type Decision = 'approve' | 'reject' | 'escalate';

async function checkDecision(
  context: Context,
  row: CaseRow,
  decision: Decision,
): Promise<{ row: CaseRow } | { response: unknown }> {
  const current = await clearStaleApproval(context, row);
  if (current.status === 'in_review') {
    if (current.assignee !== context.user.id) {
      return {
        response: await denied(
          context,
          current.id,
          `kyc.case_${decision}_denied`,
          'Claim this case before you act on it.',
        ),
      };
    }
    return { row: current };
  }
  if (current.status === 'escalated' && decision !== 'escalate') {
    if (!authorize(context.user, 'kyc.decide_escalated', kycTool)) {
      return {
        response: await denied(
          context,
          current.id,
          `kyc.case_${decision}_denied`,
          'Only a KYC lead can decide an escalated case.',
        ),
      };
    }
    return { row: current };
  }
  return statusError(
    `You cannot ${decision} a case with the status ${current.status.replace('_', ' ')}.`,
    409,
  );
}

async function closeCase(
  context: Context,
  row: CaseRow,
  status: 'approved' | 'rejected',
  details: Record<string, unknown>,
) {
  const updated = await updateCase(
    context.tx,
    `UPDATE kyc.cases SET status=$2,decided_by=$3,decided_at=now(),pending_approval_id=NULL
     WHERE id=$1`,
    [row.id, status, context.user.id],
  );
  await context.audit({
    action: status === 'approved' ? 'kyc.case_approved' : 'kyc.case_rejected',
    objectType: 'kyc_case',
    objectId: row.id,
    before: { status: row.status, assignee: row.assignee },
    after: { status, decidedBy: context.user.id, ...details },
  });
  return updated;
}

export const kycRoutes = [
  defineRoute({
    method: 'GET',
    path: '/api/tools/kyc/cases',
    permission: 'kyc.read',
    query: CaseQuery,
    handler: async (context) => {
      const { tx, mask, user } = context;
      const query = context.query as CaseQueryInput;
      const values: unknown[] = [];
      const filters: string[] = [];
      const add = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      if (query.q) {
        const term = query.q.toUpperCase();
        if (/^KYC-?\d*$/.test(term)) {
          const reference = term.startsWith('KYC-')
            ? term
            : term.replace(/^KYC/, 'KYC-');
          filters.push(`reference LIKE ${add(likePrefix(reference))}`);
        } else {
          filters.push(
            `lower(customer_name) LIKE ${add(likePrefix(query.q.toLowerCase()))}`,
          );
        }
      }
      if (query.status) filters.push(`status = ${add(query.status)}`);
      if (query.country) filters.push(`country = ${add(query.country)}`);
      if (query.risk) {
        const [low, high] = riskBands[query.risk];
        filters.push(`risk_score BETWEEN ${add(low)} AND ${add(high)}`);
      }
      if (query.assignee === 'me') filters.push(`assignee = ${add(user.id)}`);
      const column = sortColumns[query.sort];
      const direction = query.dir === 'desc' ? 'DESC' : 'ASC';
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor, query.sort);
        const cast = query.sort === 'risk_score' ? 'smallint' : 'timestamptz';
        filters.push(
          `(${column}, id) ${direction === 'ASC' ? '>' : '<'} (${add(cursor.value)}::${cast}, ${add(cursor.id)}::uuid)`,
        );
      }
      const limit = add(query.limit + 1);
      const result = await tx.query<CaseRow>(
        `SELECT ${caseColumns} FROM kyc.cases
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY ${column} ${direction}, id ${direction}
         LIMIT ${limit}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      return {
        items: rows.map((row) => present(row, mask)),
        nextCursor:
          hasMore && last
            ? encodeCursor(cursorValue(last, query.sort), last.id)
            : null,
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/tools/kyc/cases/:id',
    permission: 'kyc.read',
    params: CaseParams,
    handler: async ({ tx, params, mask }) => {
      const { id } = params as CaseParamsInput;
      const result = await tx.query<CaseRow>(
        `SELECT ${caseColumns} FROM kyc.cases WHERE id=$1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return { statusCode: 404, body: { error: 'Case not found.' } };
      const approval = row.pending_approval_id
        ? await tx.query(
            `SELECT id,status,requester_id,created_at,expires_at
             FROM foundation.approval_requests WHERE id=$1`,
            [row.pending_approval_id],
          )
        : undefined;
      const events = await tx.query(
        `SELECT seq,action,actor_id,occurred_at,result
         FROM foundation.audit_events
         WHERE object_type='kyc_case' AND object_id=$1
         ORDER BY seq DESC LIMIT 50`,
        [id],
      );
      return {
        ...present(row, mask),
        pending_approval: approval?.rows[0] ?? null,
        timeline: events.rows,
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/tools/kyc/cases/:id/reveal',
    permission: 'kyc.reveal',
    params: CaseParams,
    body: RevealBody,
    handler: async (context) => {
      const { id } = context.params as CaseParamsInput;
      const { field, reason } = context.body as z.infer<typeof RevealBody>;
      const result = await context.tx.query<CaseRow>(
        `SELECT ${caseColumns} FROM kyc.cases WHERE id=$1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return { statusCode: 404, body: { error: 'Case not found.' } };
      if (
        row.assignee !== context.user.id &&
        !authorize(context.user, 'kyc.decide_escalated', kycTool)
      ) {
        return denied(
          context,
          id,
          'kyc.pii_reveal_denied',
          'Claim this case before you show personal data.',
        );
      }
      await context.audit({
        action: 'kyc.pii_revealed',
        objectType: 'kyc_case',
        objectId: id,
        after: { field, dataClass: piiFields[field], reason },
      });
      return { field, value: row[field] };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/tools/kyc/cases/:id/claim',
    permission: 'kyc.work',
    params: CaseParams,
    idempotent: true,
    handler: async (context) => {
      const { id } = context.params as CaseParamsInput;
      const row = await lockCase(context.tx, id);
      if (row.status !== 'new') {
        return statusError('You can claim only a new case.', 409);
      }
      const updated = await updateCase(
        context.tx,
        `UPDATE kyc.cases SET status='in_review',assignee=$2 WHERE id=$1`,
        [id, context.user.id],
      );
      await context.audit({
        action: 'kyc.case_claimed',
        objectType: 'kyc_case',
        objectId: id,
        before: { status: row.status, assignee: row.assignee },
        after: { status: updated.status, assignee: updated.assignee },
      });
      return present(updated, context.mask);
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/tools/kyc/cases/:id/approve',
    permission: 'kyc.work',
    params: CaseParams,
    body: ApproveBody,
    idempotent: true,
    handler: async (context) => {
      const { id } = context.params as CaseParamsInput;
      const { note } = context.body as z.infer<typeof ApproveBody>;
      const checked = await checkDecision(
        context,
        await lockCase(context.tx, id),
        'approve',
      );
      if ('response' in checked) return checked.response;
      const row = checked.row;
      const tier = tierFor(approvalPolicy, { riskScore: row.risk_score });
      if (tier.steps.length === 0) {
        const updated = await closeCase(context, row, 'approved', {
          tier: tier.name,
          note: note ?? null,
        });
        return present(updated, context.mask);
      }
      const approvalId = await context.approvals.create({
        action: approvalAction,
        objectType: 'kyc_case',
        objectId: row.id,
        tier: tier.name,
        policyVersion: approvalPolicy.version,
        contentHash: contentHash(row),
        steps: tier.steps.map((roles) => ({ roles, approvals: [] })),
        expiresAt: new Date(
          Date.now() + approvalPolicy.expiresAfterHours * 60 * 60_000,
        ),
        summary: {
          case_id: row.id,
          case_reference: row.reference,
          case_status: row.status,
          risk_score: row.risk_score,
          country: row.country,
          note: note ?? null,
        },
      });
      const updated = await updateCase(
        context.tx,
        'UPDATE kyc.cases SET pending_approval_id=$2 WHERE id=$1',
        [row.id, approvalId],
      );
      await context.audit({
        action: 'kyc.case_approval_requested',
        objectType: 'kyc_case',
        objectId: row.id,
        before: { status: row.status },
        after: {
          status: row.status,
          approvalId,
          tier: tier.name,
          riskScore: row.risk_score,
          note: note ?? null,
        },
      });
      return {
        statusCode: 202,
        body: { ...present(updated, context.mask), approval_id: approvalId },
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/tools/kyc/cases/:id/reject',
    permission: 'kyc.work',
    params: CaseParams,
    body: ReasonBody,
    idempotent: true,
    handler: async (context) => {
      const { id } = context.params as CaseParamsInput;
      const { reason } = context.body as z.infer<typeof ReasonBody>;
      const checked = await checkDecision(
        context,
        await lockCase(context.tx, id),
        'reject',
      );
      if ('response' in checked) return checked.response;
      const updated = await closeCase(context, checked.row, 'rejected', {
        reason,
      });
      return present(updated, context.mask);
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/tools/kyc/cases/:id/escalate',
    permission: 'kyc.work',
    params: CaseParams,
    body: ReasonBody,
    idempotent: true,
    handler: async (context) => {
      const { id } = context.params as CaseParamsInput;
      const { reason } = context.body as z.infer<typeof ReasonBody>;
      const checked = await checkDecision(
        context,
        await lockCase(context.tx, id),
        'escalate',
      );
      if ('response' in checked) return checked.response;
      const row = checked.row;
      const updated = await updateCase(
        context.tx,
        `UPDATE kyc.cases SET status='escalated' WHERE id=$1`,
        [row.id],
      );
      await context.audit({
        action: 'kyc.case_escalated',
        objectType: 'kyc_case',
        objectId: row.id,
        before: { status: row.status },
        after: { status: updated.status, reason },
      });
      return present(updated, context.mask);
    },
  }),
];

export const decideCaseApproval: ApprovalHandler = async (
  context,
  approval,
  decision,
) => {
  const row = await lockCase(context.tx, approval.object_id);
  if (row.pending_approval_id !== approval.id) {
    statusError('This case no longer waits for this approval.', 409);
  }
  const expiry = await context.tx.query<{ expired: boolean }>(
    'SELECT expires_at<=now() AS expired FROM foundation.approval_requests WHERE id=$1',
    [approval.id],
  );
  if (expiry.rows[0]?.expired !== false) {
    statusError('This approval request has expired. Ask for a new one.', 409);
  }
  if (contentHash(row) !== approval.content_hash) {
    statusError('The case changed after the request. Ask for a new one.', 409);
  }
  if (decision === 'approve') {
    await closeCase(context, row, 'approved', {
      approvalId: approval.id,
      requestedBy: approval.requester_id,
      tier: approval.tier,
    });
    return;
  }
  await updateCase(
    context.tx,
    'UPDATE kyc.cases SET pending_approval_id=NULL WHERE id=$1',
    [row.id],
  );
  await context.audit({
    action: 'kyc.case_approval_declined',
    objectType: 'kyc_case',
    objectId: row.id,
    before: { status: row.status, pendingApprovalId: approval.id },
    after: { status: row.status, requestedBy: approval.requester_id },
  });
};

export const kycRegistration: ToolRegistration = {
  tool: kycTool,
  routes: kycRoutes,
  approvalHandlers: { [approvalAction]: decideCaseApproval },
};
