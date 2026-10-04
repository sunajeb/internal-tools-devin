import {
  defineRoute,
  requestHash,
  type FoundationContext,
  type FoundationRoute,
  type ToolRegistration,
} from '@internal-tools/foundation';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { refundsTool } from './registry.js';
import {
  dailyAutoRefundLimitMinor,
  refundableMinor,
  refundPolicy,
  refundPolicyVersion,
  refundTier,
} from './domain.js';

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

const ExceptionInput = z.object({
  resolutionCode: z.string().trim().min(2).max(64),
  note: z.string().trim().min(10).max(1000),
});

const IdParams = z.object({ id: z.string().min(1).max(128) });
function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

const RefundListQuery = z.object({
  format: z.enum(['csv']).optional(),
  status: z
    .enum([
      'pending_approval',
      'approved',
      'executing',
      'succeeded',
      'reconciled',
      'failed',
      'rejected',
      'cancelled',
      'expired',
    ])
    .optional(),
});

function mayReadAllRefunds(user: FoundationContext['user']) {
  return refundsTool.permissions['refund.read_all']?.some((role) =>
    user.roles.includes(role),
  );
}

function mayExport(user: FoundationContext['user']) {
  return refundsTool.permissions['refund.export']?.some((role) =>
    user.roles.includes(role),
  );
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

const routes = [
  defineRoute({
    method: 'GET',
    path: '/api/charges',
    permission: 'charge.search',
    query: ChargeQuery,
    handler: async ({ tx, query, mask }) => {
      const { q, from, to, minMinor, maxMinor, limit, cursor } =
        query as z.infer<typeof ChargeQuery>;
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
        filters.push(
          `created_at < ($${values.length}::date + interval '1 day')`,
        );
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
          fail('The search page token is not valid.', 400);
        }
        values.push(createdAt, id);
        filters.push(
          `(created_at,id) < ($${values.length - 1}::timestamptz,$${values.length})`,
        );
      }
      values.push(limit + 1);
      const result = await tx.query(
        `SELECT id,customer_id,customer_email,card_brand,card_last4,amount_minor::text,
                currency,refunded_minor::text,created_at,
                to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         FROM refunds.charges ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      const charges = rows.map(({ cursor_at: _cursorAt, ...row }) => ({
        ...row,
        customer_email: mask(row.customer_email, 'restricted'),
      }));
      const last = rows.at(-1);
      return {
        items: charges,
        nextCursor: hasMore && last ? `${last.cursor_at}~${last.id}` : null,
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/charges/:id/reveal-email',
    permission: 'customer.reveal',
    params: IdParams,
    handler: async ({ tx, params, audit }) => {
      const { id } = params as z.infer<typeof IdParams>;
      const result = await tx.query(
        'SELECT customer_email FROM refunds.charges WHERE id=$1',
        [id],
      );
      if (!result.rows[0])
        return { statusCode: 404, body: { error: 'Payment not found.' } };
      await audit({
        action: 'customer.email_revealed',
        objectType: 'charge',
        objectId: id,
        after: { fields: ['customer_email'] },
      });
      return { customerEmail: result.rows[0].customer_email };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/charges/:id',
    permission: 'charge.search',
    params: IdParams,
    handler: async ({ tx, params, mask }) => {
      const { id } = params as z.infer<typeof IdParams>;
      const result = await tx.query(
        `SELECT id,customer_id,customer_email,card_brand,card_last4,amount_minor::text,
                currency,refunded_minor::text,created_at
         FROM refunds.charges WHERE id=$1`,
        [id],
      );
      const charge = result.rows[0];
      if (!charge)
        return { statusCode: 404, body: { error: 'Payment not found.' } };
      const refunds = await tx.query(
        `SELECT id,amount_minor::text,currency,reason_code,status,tier,requester_id,created_at
         FROM refunds.refunds WHERE charge_id=$1 ORDER BY created_at DESC`,
        [id],
      );
      return {
        ...charge,
        customer_email: mask(charge.customer_email, 'restricted'),
        refundable_minor: refundableMinor(
          charge.amount_minor,
          charge.refunded_minor,
        ),
        refunds: refunds.rows,
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/refunds',
    permission: 'refund.request',
    body: RefundInput,
    idempotent: true,
    handler: async (context) => {
      const input = context.body as z.infer<typeof RefundInput>;
      const { user, tx, approvals, outbox, audit } = context;
      const locked = await tx.query(
        `SELECT id,amount_minor::text,refunded_minor::text,currency
         FROM refunds.charges WHERE id=$1 FOR UPDATE`,
        [input.chargeId],
      );
      const charge = locked.rows[0];
      if (!charge)
        return { statusCode: 404, body: { error: 'Payment not found.' } };
      const amount = BigInt(input.amountMinor);
      const remaining = BigInt(
        refundableMinor(charge.amount_minor, charge.refunded_minor),
      );
      if (amount > remaining) {
        fail('Amount exceeds refundable balance.', 409);
      }
      if (charge.currency !== 'USD') {
        fail('Refund currency must match the payment currency.', 400);
      }
      const tier = refundTier(BigInt(charge.refunded_minor) + amount);
      if (tier.name === 'dual' && !user.roles.includes('supervisor')) {
        fail('Only a Supervisor can request a refund above $5,000.', 403);
      }
      if (tier.name === 'auto') {
        const daily = await tx.query(
          `INSERT INTO refunds.agent_daily_totals(agent_id,day,auto_minor)
           VALUES($1,current_date,$2)
           ON CONFLICT(agent_id,day) DO UPDATE
             SET auto_minor=refunds.agent_daily_totals.auto_minor+EXCLUDED.auto_minor
             WHERE refunds.agent_daily_totals.auto_minor+EXCLUDED.auto_minor<=$3
           RETURNING auto_minor`,
          [user.id, amount.toString(), dailyAutoRefundLimitMinor.toString()],
        );
        if (!daily.rowCount) {
          fail('This request exceeds the daily instant-refund limit.', 422);
        }
      }
      await tx.query(
        'UPDATE refunds.charges SET refunded_minor=refunded_minor+$2::bigint WHERE id=$1',
        [input.chargeId, amount.toString()],
      );
      const status = tier.steps.length ? 'pending_approval' : 'approved';
      const inserted = await tx.query(
        `INSERT INTO refunds.refunds(
           charge_id,amount_minor,currency,reason_code,note,requester_id,status,tier,policy_version
         ) VALUES($1,$2::bigint,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id::text,charge_id,amount_minor::text,currency,reason_code,note,
                   requester_id,status,tier,created_at`,
        [
          input.chargeId,
          amount.toString(),
          charge.currency,
          input.reasonCode,
          input.note,
          user.id,
          status,
          tier.name,
          refundPolicyVersion,
        ],
      );
      const refund = inserted.rows[0];
      const steps = tier.steps.map((roles) => ({ roles, approvals: [] }));
      if (status === 'pending_approval') {
        const approvalId = await approvals.create({
          action: 'refund.execute',
          objectType: 'refund',
          objectId: refund.id,
          tier: tier.name,
          policyVersion: refundPolicyVersion,
          contentHash: requestHash(input),
          steps,
          expiresAt: new Date(
            Date.now() + refundPolicy.expiresAfterHours * 60 * 60_000,
          ),
          summary: {
            refund_id: refund.id,
            charge_id: refund.charge_id,
            amount_minor: refund.amount_minor,
            currency: refund.currency,
            reason_code: refund.reason_code,
            note: refund.note,
            status: refund.status,
          },
        });
        await tx.query(
          'UPDATE refunds.refunds SET approval_request_id=$2 WHERE id=$1',
          [refund.id, approvalId],
        );
      } else {
        await outbox.enqueue(
          'refund.execute',
          { refundId: refund.id },
          refund.id,
        );
      }
      await audit({
        action: 'refund.requested',
        objectType: 'refund',
        objectId: refund.id,
        after: { amountMinor: amount.toString(), status, tier: tier.name },
      });
      return {
        statusCode: 201,
        body: { ...refund, approvalSteps: tier.steps },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/refunds',
    permission: 'refund.read',
    query: RefundListQuery,
    handler: async ({ tx, query, user, audit }) => {
      const { format, status } = query as z.infer<typeof RefundListQuery>;
      if (format === 'csv') {
        if (!mayExport(user)) {
          return {
            statusCode: 403,
            body: { error: 'You do not have permission to export refunds.' },
          };
        }
        const exported = await tx.query(
          `SELECT id,charge_id,amount_minor::text,currency,reason_code,status,tier,
                  requester_id,created_at
           FROM refunds.refunds ORDER BY created_at DESC LIMIT 10000`,
        );
        await audit({
          action: 'refund.exported',
          objectType: 'refund_export',
          objectId: 'current',
          after: { rowCount: exported.rowCount },
        });
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
        return {
          statusCode: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="refunds.csv"',
          },
          body: [
            columns,
            ...exported.rows.map((row) => columns.map((key) => row[key])),
          ]
            .map((row) => row.map(csvCell).join(','))
            .join('\r\n'),
        };
      }
      const result = await tx.query(
        `SELECT r.id,r.charge_id,r.amount_minor::text,r.currency,r.reason_code,r.status,r.tier,
                r.requester_id,r.created_at,a.id AS approval_id
         FROM refunds.refunds r
         LEFT JOIN foundation.approval_requests a ON a.id=r.approval_request_id
         WHERE ($1::boolean OR r.requester_id=$2)
           AND ($3::text IS NULL OR r.status=$3)
         ORDER BY r.created_at DESC LIMIT 100`,
        [mayReadAllRefunds(user), user.id, status ?? null],
      );
      return { items: result.rows };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/refunds/:id',
    permission: 'refund.read',
    params: IdParams,
    handler: async ({ tx, params, user }) => {
      const { id } = params as z.infer<typeof IdParams>;
      const result = await tx.query(
        `SELECT r.*,r.amount_minor::text FROM refunds.refunds r
         WHERE r.id=$1 AND ($2::boolean OR r.requester_id=$3)`,
        [id, mayReadAllRefunds(user), user.id],
      );
      if (!result.rows[0])
        return { statusCode: 404, body: { error: 'Refund not found.' } };
      const audit = await tx.query(
        `SELECT event_data FROM foundation.audit_events
         WHERE object_type='refund' AND object_id=$1 ORDER BY seq`,
        [id],
      );
      return {
        ...result.rows[0],
        timeline: audit.rows.map((row) => row.event_data),
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/reconciliation/run',
    permission: 'exception.resolve',
    handler: async ({ user, outbox, audit }) => {
      const idempotencyKey = `reconciliation:${randomUUID()}`;
      await outbox.enqueue(
        'reconciliation.run',
        { requestedBy: user.id },
        idempotencyKey,
      );
      await audit({
        action: 'reconciliation.started',
        objectType: 'tool',
        objectId: 'refunds',
      });
      return { statusCode: 202, body: { queued: true } };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/exceptions',
    permission: 'exception.resolve',
    query: z.object({ status: z.enum(['open', 'resolved']).optional() }),
    handler: async ({ tx, query }) => {
      const status = (query as { status?: string }).status ?? 'open';
      const result = await tx.query(
        `SELECT * FROM refunds.reconciliation_exceptions
         WHERE status=$1 ORDER BY created_at ASC LIMIT 100`,
        [status],
      );
      return { items: result.rows };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/exceptions/:id/resolve',
    permission: 'exception.resolve',
    params: IdParams,
    body: ExceptionInput,
    handler: async ({ tx, params, body, user, audit }) => {
      const { id } = params as z.infer<typeof IdParams>;
      const input = body as z.infer<typeof ExceptionInput>;
      const before = await tx.query(
        'SELECT status FROM refunds.reconciliation_exceptions WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!before.rowCount) {
        return {
          statusCode: 404,
          body: { error: 'Reconciliation exception not found.' },
        };
      }
      if (before.rows[0].status !== 'open') {
        return {
          statusCode: 409,
          body: { error: 'This exception is already resolved.' },
        };
      }
      await tx.query(
        `UPDATE refunds.reconciliation_exceptions
         SET status='resolved',resolution_code=$2,resolution_note=$3,
             resolved_by=$4,resolved_at=now() WHERE id=$1`,
        [id, input.resolutionCode, input.note, user.id],
      );
      await audit({
        action: 'reconciliation.exception_resolved',
        objectType: 'reconciliation_exception',
        objectId: id,
        before: before.rows[0],
        after: { status: 'resolved', ...input },
      });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/dashboard',
    permission: 'dashboard.read',
    handler: async ({ tx }) => {
      const [states, approvals, exceptions, setting] = await Promise.all([
        tx.query(
          'SELECT status,count(*)::int AS count FROM refunds.refunds GROUP BY status',
        ),
        tx.query(
          "SELECT count(*)::int AS count FROM foundation.approval_requests WHERE status='pending'",
        ),
        tx.query(
          "SELECT count(*)::int AS count FROM refunds.reconciliation_exceptions WHERE status='open'",
        ),
        tx.query(
          "SELECT execution_paused FROM foundation.tool_settings WHERE tool_id='refunds'",
        ),
      ]);
      return {
        states: states.rows,
        pendingApprovals: approvals.rows[0]?.count ?? 0,
        openExceptions: exceptions.rows[0]?.count ?? 0,
        executionPaused: setting.rows[0]?.execution_paused ?? false,
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/admin/pause',
    permission: 'execution.pause',
    body: z.object({ paused: z.boolean() }),
    handler: async ({ tx, user, body, audit }) => {
      const { paused } = body as { paused: boolean };
      await tx.query(
        `UPDATE foundation.tool_settings
         SET execution_paused=$1,changed_by=$2,changed_at=now()
         WHERE tool_id='refunds'`,
        [paused, user.id],
      );
      await audit({
        action: paused ? 'execution.paused' : 'execution.resumed',
        objectType: 'tool',
        objectId: 'refunds',
        after: { executionPaused: paused },
      });
      return { paused };
    },
  }),
] satisfies FoundationRoute<any, any, any>[];

const approvalHandlers: ToolRegistration['approvalHandlers'] = {
  'refund.execute': async (context, approval, decision) => {
    const result = await context.tx.query(
      'SELECT status FROM refunds.refunds WHERE id=$1 FOR UPDATE',
      [approval.object_id],
    );
    if (!result.rowCount || result.rows[0].status !== 'pending_approval') {
      fail('The refund is no longer waiting for approval.', 409);
    }
    if (decision === 'reject') {
      await context.tx.query(
        "UPDATE refunds.refunds SET status='rejected' WHERE id=$1",
        [approval.object_id],
      );
    } else {
      await context.tx.query(
        "UPDATE refunds.refunds SET status='approved' WHERE id=$1",
        [approval.object_id],
      );
      await context.outbox.enqueue(
        'refund.execute',
        { refundId: approval.object_id },
        approval.object_id,
      );
    }
    await context.audit({
      action: 'refund.approval_recorded',
      objectType: 'refund',
      objectId: approval.object_id,
      before: { status: 'pending_approval' },
      after: {
        decision,
        status: decision === 'approve' ? 'approved' : 'rejected',
      },
    });
  },
};

export const refundsRegistration: ToolRegistration = {
  tool: refundsTool,
  routes,
  approvalHandlers,
};

export { routes as refundsRoutes };
