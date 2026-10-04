import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import {
  genesisHash,
  hashAuditEvent,
  retryDelayMs,
} from '@internal-tools/foundation';
import { createPaymentProvider, type PaymentProvider } from './provider.js';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgres://tools:tools@localhost:5432/internal_tools',
  max: 8,
});
const provider = createPaymentProvider();

type RefundStatus = 'executing' | 'succeeded' | 'failed' | 'reconciled';

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
  await client.query('SELECT pg_advisory_xact_lock(381729)');
  const previous = await client.query(
    'SELECT hash FROM foundation.audit_events ORDER BY seq DESC LIMIT 1',
  );
  const previousHash = previous.rows[0]?.hash as Buffer | undefined;
  const event = {
    id: randomUUID(),
    occurredAt: new Date().toISOString(),
    toolId: 'refunds',
    actorId: 'service-worker',
    actorRoles: ['service'],
    action: input.action,
    objectType: input.objectType ?? 'refund',
    objectId: input.objectId,
    before: input.before,
    after: input.after,
    result: 'success',
    requestId: randomUUID(),
  };
  const prevHash = previousHash ?? genesisHash();
  const hash = hashAuditEvent(prevHash, event);
  await client.query(
    `INSERT INTO foundation.audit_events
     (id,occurred_at,tool_id,actor_id,actor_roles,action,object_type,object_id,event_data,
      result,request_id,prev_hash,hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      event.id,
      event.occurredAt,
      event.toolId,
      event.actorId,
      event.actorRoles,
      event.action,
      event.objectType,
      event.objectId,
      JSON.stringify(event),
      event.result,
      event.requestId,
      prevHash,
      hash,
    ],
  );
}

async function updateRefundStatus(
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

async function recordRetryLimit(refundId: string, attempts: number) {
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
  exceptionType:
    | 'missing_internal'
    | 'missing_external'
    | 'amount_mismatch'
    | 'currency_mismatch'
    | 'charge_mismatch'
    | 'state_mismatch',
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

async function runReconciliation(paymentProvider: PaymentProvider) {
  const externalRefunds = await paymentProvider.listRefunds();
  const providerIds = new Set(externalRefunds.map((refund) => refund.id));
  for (const external of externalRefunds) {
    const internal = await pool.query(
      `SELECT r.id,r.charge_id,c.provider_charge_id,r.amount_minor::text,r.currency,r.status,r.provider_refund_id
       FROM refunds.refunds r JOIN refunds.charges c ON c.id=r.charge_id WHERE r.id::text=$1`,
      [external.idempotencyKey],
    );
    const row = internal.rows[0];
    if (!row) {
      await recordException('missing_internal', external.id, {
        providerRefundId: external.id,
        idempotencyKey: external.idempotencyKey,
        chargeId: external.chargeId,
        amountMinor: external.amountMinor,
        currency: external.currency,
      });
      continue;
    }
    if (row.amount_minor !== external.amountMinor) {
      await recordException('amount_mismatch', external.id, {
        internalMinor: row.amount_minor,
        providerMinor: external.amountMinor,
      });
      continue;
    }
    if (row.currency.trim().toUpperCase() !== external.currency.toUpperCase()) {
      await recordException('currency_mismatch', external.id, {
        internalCurrency: row.currency.trim(),
        providerCurrency: external.currency,
      });
      continue;
    }
    const expectedChargeId = row.provider_charge_id ?? row.charge_id;
    if (expectedChargeId !== external.chargeId) {
      await recordException('charge_mismatch', external.id, {
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
      await recordException('state_mismatch', external.id, {
        internalStatus: row.status,
        providerStatus: external.status,
      });
      continue;
    }
    if (row.status === 'executing' && external.status === 'pending') {
      await updateRefundStatus(row.id, 'executing', external.id);
      await pool.query(
        `UPDATE foundation.outbox SET status='pending',attempts=0,next_attempt_at=now()+interval '30 seconds',
         last_error=NULL,lease_expires_at=NULL
         WHERE kind='refund.execute' AND payload->>'refundId'=$1 AND status='failed'`,
        [row.id],
      );
    } else if (row.status === 'executing' && external.status === 'succeeded') {
      await updateRefundStatus(row.id, 'succeeded', external.id);
      await pool.query(
        `UPDATE foundation.outbox SET status='done',last_error=NULL,lease_expires_at=NULL
         WHERE kind='refund.execute' AND payload->>'refundId'=$1 AND status IN ('failed','pending')`,
        [row.id],
      );
    } else if (row.status === 'executing' && external.status === 'failed') {
      await updateRefundStatus(
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
      await updateRefundStatus(row.id, 'reconciled', external.id);
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
      await recordException('missing_external', refund.id, {
        refundId: refund.id,
        providerRefundId: refund.provider_refund_id,
        internalStatus: refund.status,
      });
    }
  }
}

async function processOutbox() {
  const client = await pool.connect();
  let job:
    | {
        id: string;
        kind: string;
        payload: { refundId?: string };
        attempts: number;
      }
    | undefined;
  try {
    await client.query('BEGIN');
    const paused = await client.query(
      "SELECT execution_paused FROM foundation.tool_settings WHERE tool_id='refunds'",
    );
    const ready = await client.query(
      `SELECT id,kind,payload,attempts FROM foundation.outbox
       WHERE ((status='pending' AND next_attempt_at <= now())
          OR (status='in_flight' AND lease_expires_at <= now()))
         AND ($1::boolean = false OR kind <> 'refund.execute')
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      [Boolean(paused.rows[0]?.execution_paused)],
    );
    job = ready.rows[0];
    if (job) {
      await client.query(
        "UPDATE foundation.outbox SET status='in_flight',lease_expires_at=now()+interval '1 minute' WHERE id=$1",
        [job.id],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  if (!job) return;

  try {
    if (job.kind === 'reconciliation.run') {
      await runReconciliation(provider);
      await pool.query(
        "UPDATE foundation.outbox SET status='done',last_error=NULL,lease_expires_at=NULL WHERE id=$1",
        [job.id],
      );
      return;
    }
    if (job.kind !== 'refund.execute' || !job.payload.refundId) {
      await pool.query(
        "UPDATE foundation.outbox SET status='failed',last_error='Unsupported outbox job',lease_expires_at=NULL WHERE id=$1",
        [job.id],
      );
      return;
    }
    const refund = await pool.query(
      `SELECT r.id,r.charge_id,c.provider_charge_id,r.provider_refund_id,r.amount_minor::text,r.currency,r.status
       FROM refunds.refunds r JOIN refunds.charges c ON c.id=r.charge_id WHERE r.id=$1`,
      [job.payload.refundId],
    );
    const row = refund.rows[0];
    if (!row || !['approved', 'executing'].includes(row.status)) {
      await pool.query(
        "UPDATE foundation.outbox SET status='done',lease_expires_at=NULL WHERE id=$1",
        [job.id],
      );
      return;
    }
    if (provider.usesExternalChargeIds && !row.provider_charge_id) {
      await updateRefundStatus(row.id, 'executing');
      await updateRefundStatus(
        row.id,
        'failed',
        undefined,
        'provider_charge_not_configured',
      );
      await pool.query(
        "UPDATE foundation.outbox SET status='failed',last_error='No Stripe test charge is mapped to this payment',lease_expires_at=NULL WHERE id=$1",
        [job.id],
      );
      return;
    }
    if (row.status === 'approved')
      await updateRefundStatus(row.id, 'executing');
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
      await pool.query(
        "UPDATE foundation.outbox SET status='pending',next_attempt_at=now()+interval '30 seconds',last_error=NULL,lease_expires_at=NULL WHERE id=$1",
        [job.id],
      );
    } else {
      await pool.query(
        "UPDATE foundation.outbox SET status='done',last_error=NULL,lease_expires_at=NULL WHERE id=$1",
        [job.id],
      );
    }
  } catch (error) {
    const attempts = job.attempts + 1;
    if (attempts >= 8) {
      await pool.query(
        `UPDATE foundation.outbox SET status='failed',attempts=$2,last_error=$3,lease_expires_at=NULL WHERE id=$1`,
        [job.id, attempts, String(error).slice(0, 500)],
      );
      if (job.kind === 'refund.execute' && job.payload.refundId) {
        await recordRetryLimit(job.payload.refundId, attempts);
      }
    } else {
      await pool.query(
        `UPDATE foundation.outbox SET status='pending',attempts=$2,next_attempt_at=now()+($3::text||' milliseconds')::interval,
         lease_expires_at=NULL,last_error=$4 WHERE id=$1`,
        [job.id, attempts, retryDelayMs(attempts), String(error).slice(0, 500)],
      );
    }
  }
}

async function processWebhooks() {
  const result = await pool.query(
    `SELECT provider,event_id,event_type,payload FROM foundation.inbound_events
     WHERE processed_at IS NULL ORDER BY received_at LIMIT 50`,
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
    if (refundId && to) {
      const found = await pool.query(
        `SELECT id,status FROM refunds.refunds
         WHERE id::text=$1 OR provider_refund_id=$1 LIMIT 1`,
        [refundId],
      );
      if (['executing', 'approved'].includes(found.rows[0]?.status)) {
        await updateRefundStatus(
          found.rows[0].id,
          to,
          payload.data?.providerRefundId,
        );
      }
    }
    await pool.query(
      `UPDATE foundation.inbound_events SET processed_at=now() WHERE provider=$1 AND event_id=$2`,
      [event.provider, event.event_id],
    );
  }
}

async function processExpiredApprovals() {
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

let lastExpiryCheck = 0;
async function loop() {
  for (;;) {
    try {
      await processOutbox();
      await processWebhooks();
      if (Date.now() - lastExpiryCheck >= 30_000) {
        await processExpiredApprovals();
        lastExpiryCheck = Date.now();
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Worker loop failed',
          error: String(error),
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

void loop();

const stop = async () => {
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
