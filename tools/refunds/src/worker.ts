import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  appendAudit,
  type OutboxHandlerResult,
  type ToolRegistration,
} from '@internal-tools/foundation';
import { refundsTool } from './registry.js';
import { createPaymentProvider, type PaymentProvider } from './provider.js';

type RefundStatus = 'executing' | 'succeeded' | 'failed' | 'reconciled';
type ExceptionType =
  | 'missing_internal'
  | 'missing_external'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'charge_mismatch'
  | 'state_mismatch';

async function appendWorkerAudit(
  client: pg.PoolClient,
  input: {
    action: string;
    objectId: string;
    before: unknown;
    after: unknown;
    objectType?: string;
  },
) {
  await appendAudit(client, {
    toolId: 'refunds',
    actorId: 'service-worker',
    actorRoles: ['service'],
    action: input.action,
    objectType: input.objectType ?? 'refund',
    objectId: input.objectId,
    before: input.before,
    after: input.after,
    requestId: randomUUID(),
  });
}

async function updateRefundStatus(
  pool: pg.Pool,
  refundId: string,
  status: RefundStatus,
  providerRefundId?: string,
  failureCode?: string,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT status,provider_refund_id FROM refunds.refunds WHERE id=$1 FOR UPDATE',
      [refundId],
    );
    const before = found.rows[0]?.status as string | undefined;
    if (!before || before === status) {
      if (
        before &&
        providerRefundId &&
        found.rows[0].provider_refund_id &&
        found.rows[0].provider_refund_id !== providerRefundId
      ) {
        throw new Error(
          'Provider refund reference changed for an existing refund.',
        );
      }
      if (before && providerRefundId && !found.rows[0].provider_refund_id) {
        await client.query(
          'UPDATE refunds.refunds SET provider_refund_id=COALESCE(provider_refund_id,$2) WHERE id=$1',
          [refundId, providerRefundId],
        );
        await appendWorkerAudit(client, {
          action: 'refund.provider_reference_recorded',
          objectId: refundId,
          before: { providerRefundId: null },
          after: { providerRefundId },
        });
      }
      await client.query('COMMIT');
      return;
    }
    await client.query(
      `UPDATE refunds.refunds SET status=$2,provider_refund_id=COALESCE($3,provider_refund_id),
       failure_code=COALESCE($4,failure_code) WHERE id=$1`,
      [refundId, status, providerRefundId ?? null, failureCode ?? null],
    );
    const action =
      status === 'executing'
        ? 'refund.execution_started'
        : status === 'succeeded'
          ? 'refund.execution_completed'
          : status === 'reconciled'
            ? 'refund.reconciled'
            : 'refund.execution_failed';
    await appendWorkerAudit(client, {
      action,
      objectId: refundId,
      before: { status: before },
      after: { status },
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordRetryLimit(
  pool: pg.Pool,
  refundId: string,
  attempts: number,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      'SELECT status FROM refunds.refunds WHERE id=$1 FOR UPDATE',
      [refundId],
    );
    if (current.rows[0]?.status === 'executing') {
      await appendWorkerAudit(client, {
        action: 'refund.execution_retry_limit',
        objectId: refundId,
        before: { status: 'executing' },
        after: { status: 'executing', attempts },
      });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordException(
  pool: pg.Pool,
  exceptionType: ExceptionType,
  key: string,
  details: Record<string, unknown>,
) {
  await pool.query(
    `INSERT INTO refunds.reconciliation_exceptions(reconciler,reconciliation_key,exception_type,details)
     VALUES('refunds-provider',$1,$2,$3)
     ON CONFLICT(reconciler,reconciliation_key,exception_type) DO UPDATE
       SET details=EXCLUDED.details,status='open',resolution_code=NULL,resolution_note=NULL,
           resolved_by=NULL,resolved_at=NULL
       WHERE refunds.reconciliation_exceptions.status='resolved'
          OR refunds.reconciliation_exceptions.details IS DISTINCT FROM EXCLUDED.details`,
    [key, exceptionType, JSON.stringify(details)],
  );
}

async function runReconciliation(pool: pg.Pool, provider: PaymentProvider) {
  const externalRefunds = await provider.listRefunds();
  const providerIds = new Set(externalRefunds.map((refund) => refund.id));
  for (const external of externalRefunds) {
    const internal = await pool.query(
      `SELECT r.id,r.charge_id,c.provider_charge_id,r.amount_minor::text,r.currency,r.status,r.provider_refund_id
       FROM refunds.refunds r JOIN refunds.charges c ON c.id=r.charge_id WHERE r.id::text=$1`,
      [external.idempotencyKey],
    );
    const row = internal.rows[0];
    if (!row) {
      await recordException(pool, 'missing_internal', external.id, {
        providerRefundId: external.id,
        idempotencyKey: external.idempotencyKey,
        chargeId: external.chargeId,
        amountMinor: external.amountMinor,
        currency: external.currency,
      });
      continue;
    }
    if (row.amount_minor !== external.amountMinor) {
      await recordException(pool, 'amount_mismatch', external.id, {
        internalMinor: row.amount_minor,
        providerMinor: external.amountMinor,
      });
      continue;
    }
    if (row.currency.trim().toUpperCase() !== external.currency.toUpperCase()) {
      await recordException(pool, 'currency_mismatch', external.id, {
        internalCurrency: row.currency.trim(),
        providerCurrency: external.currency,
      });
      continue;
    }
    const expectedChargeId = row.provider_charge_id ?? row.charge_id;
    if (expectedChargeId !== external.chargeId) {
      await recordException(pool, 'charge_mismatch', external.id, {
        internalChargeId: expectedChargeId,
        providerChargeId: external.chargeId,
      });
      continue;
    }
    const stateMismatch =
      [
        'pending_approval',
        'approved',
        'rejected',
        'cancelled',
        'expired',
      ].includes(row.status) ||
      (['succeeded', 'reconciled'].includes(row.status) &&
        external.status !== 'succeeded') ||
      (row.status === 'failed' && external.status !== 'failed');
    if (stateMismatch) {
      await recordException(pool, 'state_mismatch', external.id, {
        internalStatus: row.status,
        providerStatus: external.status,
      });
      continue;
    }
    if (row.status === 'executing' && external.status === 'pending') {
      await updateRefundStatus(pool, row.id, 'executing', external.id);
      await pool.query(
        `UPDATE foundation.outbox SET status='pending',attempts=0,next_attempt_at=now()+interval '30 seconds',
         last_error=NULL,lease_expires_at=NULL
         WHERE kind='refund.execute' AND payload->>'refundId'=$1 AND status='failed'`,
        [row.id],
      );
    } else if (row.status === 'executing' && external.status === 'succeeded') {
      await updateRefundStatus(pool, row.id, 'succeeded', external.id);
      await pool.query(
        `UPDATE foundation.outbox SET status='done',last_error=NULL,lease_expires_at=NULL
         WHERE kind='refund.execute' AND payload->>'refundId'=$1 AND status IN ('failed','pending')`,
        [row.id],
      );
    } else if (row.status === 'executing' && external.status === 'failed') {
      await updateRefundStatus(
        pool,
        row.id,
        'failed',
        external.id,
        'provider_declined',
      );
      await pool.query(
        `UPDATE foundation.outbox SET status='done',last_error=NULL,lease_expires_at=NULL
         WHERE kind='refund.execute' AND payload->>'refundId'=$1 AND status IN ('failed','pending')`,
        [row.id],
      );
    } else if (row.status === 'succeeded') {
      await updateRefundStatus(pool, row.id, 'reconciled', external.id);
    }
  }

  const internalRefunds = await pool.query(
    `SELECT r.id,r.provider_refund_id,r.status,o.status AS outbox_status
     FROM refunds.refunds r LEFT JOIN foundation.outbox o
       ON o.kind='refund.execute' AND o.payload->>'refundId'=r.id::text
     WHERE (r.provider_refund_id IS NOT NULL AND r.status IN ('succeeded','reconciled'))
        OR (r.status='executing' AND o.status='failed')`,
  );
  for (const refund of internalRefunds.rows) {
    const providerRecordExists = refund.provider_refund_id
      ? providerIds.has(refund.provider_refund_id)
      : externalRefunds.some(
          (external) => external.idempotencyKey === refund.id,
        );
    if (!providerRecordExists) {
      await recordException(pool, 'missing_external', refund.id, {
        refundId: refund.id,
        providerRefundId: refund.provider_refund_id,
        internalStatus: refund.status,
      });
    }
  }
}

async function executeRefund(
  pool: pg.Pool,
  provider: PaymentProvider,
  payload: Record<string, unknown>,
): Promise<OutboxHandlerResult | void> {
  const refundId =
    typeof payload.refundId === 'string' ? payload.refundId : undefined;
  if (!refundId) return { failed: 'Refund job has no refundId.' };
  const refund = await pool.query(
    `SELECT r.id,r.charge_id,c.provider_charge_id,r.provider_refund_id,r.amount_minor::text,r.currency,r.status
     FROM refunds.refunds r JOIN refunds.charges c ON c.id=r.charge_id WHERE r.id=$1`,
    [refundId],
  );
  const row = refund.rows[0];
  if (!row || !['approved', 'executing'].includes(row.status)) return;
  if (provider.usesExternalChargeIds && !row.provider_charge_id) {
    await updateRefundStatus(pool, row.id, 'executing');
    await updateRefundStatus(
      pool,
      row.id,
      'failed',
      undefined,
      'provider_charge_not_configured',
    );
    return {
      failed: 'No Stripe test charge is mapped to this payment.',
    };
  }
  if (row.status === 'approved') {
    await updateRefundStatus(pool, row.id, 'executing');
  }
  const providerRefund = await provider.createRefund({
    chargeId: provider.usesExternalChargeIds
      ? row.provider_charge_id
      : row.charge_id,
    amountMinor: row.amount_minor,
    currency: row.currency.trim(),
    refundId: row.id,
    ...(row.provider_refund_id
      ? { providerRefundId: row.provider_refund_id }
      : {}),
  });
  await updateRefundStatus(
    pool,
    row.id,
    providerRefund.status === 'pending'
      ? 'executing'
      : providerRefund.status === 'succeeded'
        ? 'succeeded'
        : 'failed',
    providerRefund.id,
    providerRefund.status === 'failed' ? 'provider_declined' : undefined,
  );
  if (providerRefund.status === 'pending') {
    return { retryAfterMs: 30_000 };
  }
}

async function processWebhooks(pool: pg.Pool) {
  const result = await pool.query(
    `SELECT provider,event_id,event_type,payload FROM foundation.inbound_events
     WHERE processed_at IS NULL AND error IS NULL ORDER BY received_at LIMIT 50`,
  );
  for (const event of result.rows) {
    const payload = event.payload as {
      data?: { refundId?: string; providerRefundId?: string };
    };
    const refundId = payload.data?.refundId ?? payload.data?.providerRefundId;
    const to = event.event_type.endsWith('.succeeded')
      ? 'succeeded'
      : event.event_type.endsWith('.failed')
        ? 'failed'
        : null;
    try {
      if (refundId && to) {
        const found = await pool.query(
          `SELECT id,status FROM refunds.refunds
           WHERE id::text=$1 OR provider_refund_id=$1 LIMIT 1`,
          [refundId],
        );
        // Only an executing refund has a provider call in flight. Other
        // states ignore the event; reconciliation reports any difference.
        if (found.rows[0]?.status === 'executing') {
          await updateRefundStatus(
            pool,
            found.rows[0].id,
            to,
            payload.data?.providerRefundId,
            to === 'failed' ? 'provider_declined' : undefined,
          );
        }
      }
      await pool.query(
        `UPDATE foundation.inbound_events SET processed_at=now() WHERE provider=$1 AND event_id=$2`,
        [event.provider, event.event_id],
      );
    } catch (error) {
      await pool.query(
        `UPDATE foundation.inbound_events SET error=$3 WHERE provider=$1 AND event_id=$2`,
        [
          event.provider,
          event.event_id,
          (error instanceof Error ? error.message : String(error)).slice(
            0,
            500,
          ),
        ],
      );
    }
  }
}

async function processExpiredApprovals(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `SELECT id,object_id,status FROM foundation.approval_requests
       WHERE status='pending' AND expires_at<=now()
       ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 25`,
    );
    for (const approval of expired.rows) {
      await client.query(
        "UPDATE foundation.approval_requests SET status='expired',decided_at=now() WHERE id=$1",
        [approval.id],
      );
      const refund = await client.query(
        `UPDATE refunds.refunds SET status='expired' WHERE id::text=$1 AND status='pending_approval'
         RETURNING id`,
        [approval.object_id],
      );
      await appendWorkerAudit(client, {
        action: 'approval.expired',
        objectType: 'approval_request',
        objectId: approval.id,
        before: { status: 'pending' },
        after: { status: 'expired' },
      });
      if (refund.rowCount) {
        await appendWorkerAudit(client, {
          action: 'refund.expired',
          objectId: approval.object_id,
          before: { status: 'pending_approval' },
          after: { status: 'expired' },
        });
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createRefundWorkerRegistration(
  pool: pg.Pool,
  provider: PaymentProvider = createPaymentProvider(),
): ToolRegistration {
  return {
    tool: refundsTool,
    routes: [],
    pausedKinds: ['refund.execute'],
    outboxHandlers: {
      'refund.execute': async (_context, payload) =>
        executeRefund(pool, provider, payload),
      'reconciliation.run': async () => runReconciliation(pool, provider),
    },
    reconcilers: {
      'refunds.provider': async () => runReconciliation(pool, provider),
      'refunds.webhooks': async () => processWebhooks(pool),
      'refunds.approvals.expire': async () => processExpiredApprovals(pool),
    },
    reconcilerIntervals: {
      'refunds.provider': 60_000,
      'refunds.webhooks': 1_000,
      'refunds.approvals.expire': 30_000,
    },
  };
}
