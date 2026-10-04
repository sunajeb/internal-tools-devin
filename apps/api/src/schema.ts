import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const foundation = pgSchema('foundation');
const refunds = pgSchema('refunds');
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const sessions = foundation.table('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  displayName: text('display_name').notNull(),
  roles: text('roles').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const idempotencyKeys = foundation.table(
  'idempotency_keys',
  {
    actorId: text('actor_id').notNull(),
    route: text('route').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    responseCode: integer('response_code'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.actorId, table.route, table.key] })],
);

export const approvalRequests = foundation.table(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: text('tool_id').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    requesterId: text('requester_id').notNull(),
    tier: text('tier').notNull(),
    policyVersion: integer('policy_version').notNull(),
    contentHash: text('content_hash').notNull(),
    steps: jsonb('steps').notNull().default([]),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'approval_requests_status_check',
      sql`${table.status} IN ('pending','approved','rejected','cancelled','expired')`,
    ),
    index('approvals_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.status}='pending'`),
  ],
);

export const approvals = foundation.table(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    approvalRequestId: uuid('approval_request_id')
      .notNull()
      .references(() => approvalRequests.id),
    stepIndex: integer('step_index').notNull(),
    approverId: text('approver_id').notNull(),
    approverRole: text('approver_role').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'approvals_decision_check',
      sql`${table.decision} IN ('approve','reject')`,
    ),
    uniqueIndex('approvals_request_approver_idx').on(
      table.approvalRequestId,
      table.approverId,
    ),
    uniqueIndex('approvals_request_step_idx').on(
      table.approvalRequestId,
      table.stepIndex,
    ),
  ],
);

export const outbox = foundation.table(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: text('tool_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'outbox_status_check',
      sql`${table.status} IN ('pending','in_flight','done','failed')`,
    ),
    index('outbox_ready_idx').on(table.status, table.nextAttemptAt),
  ],
);

export const inboundEvents = foundation.table(
  'inbound_events',
  {
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.eventId] }),
    index('inbound_events_pending_idx')
      .on(table.receivedAt)
      .where(sql`${table.processedAt} IS NULL`),
  ],
);

export const toolSettings = foundation.table('tool_settings', {
  toolId: text('tool_id').primaryKey(),
  executionPaused: boolean('execution_paused').notNull().default(false),
  changedBy: text('changed_by'),
  changedAt: timestamp('changed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const policyVersions = foundation.table(
  'policy_versions',
  {
    toolId: text('tool_id').notNull(),
    version: integer('version').notNull(),
    state: text('state').notNull(),
    configuration: jsonb('configuration').notNull(),
    proposedBy: text('proposed_by').notNull(),
    approvedBy: text('approved_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.toolId, table.version] }),
    check(
      'policy_versions_state_check',
      sql`${table.state} IN ('proposed','active','retired')`,
    ),
    check(
      'policy_versions_distinct_approver_check',
      sql`${table.approvedBy} IS NULL OR ${table.approvedBy} <> ${table.proposedBy}`,
    ),
  ],
);

export const charges = refunds.table(
  'charges',
  {
    id: text('id').primaryKey(),
    customerId: text('customer_id').notNull(),
    customerEmail: text('customer_email').notNull(),
    cardBrand: text('card_brand').notNull(),
    cardLast4: text('card_last4').notNull(),
    providerChargeId: text('provider_charge_id').unique(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    refundedMinor: bigint('refunded_minor', { mode: 'bigint' })
      .notNull()
      .default(0n),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('charges_amount_positive_check', sql`${table.amountMinor}>0`),
    check(
      'charges_card_last4_format_check',
      sql`${table.cardLast4} ~ '^[0-9]{4}$'`,
    ),
    check('charges_refund_nonnegative_check', sql`${table.refundedMinor}>=0`),
    check(
      'charges_refund_limit_check',
      sql`${table.refundedMinor}<=${table.amountMinor}`,
    ),
    index('charges_customer_idx').on(table.customerId),
    index('charges_created_idx').on(table.createdAt, table.id),
  ],
);

export const refundRecords = refunds.table(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chargeId: text('charge_id')
      .notNull()
      .references(() => charges.id),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    reasonCode: text('reason_code').notNull(),
    note: text('note').notNull(),
    requesterId: text('requester_id').notNull(),
    status: text('status').notNull(),
    tier: text('tier').notNull(),
    policyVersion: integer('policy_version').notNull(),
    approvalRequestId: uuid('approval_request_id'),
    providerRefundId: text('provider_refund_id'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('refunds_amount_positive_check', sql`${table.amountMinor}>0`),
    check(
      'refunds_note_length_check',
      sql`char_length(${table.note}) BETWEEN 10 AND 1000`,
    ),
    uniqueIndex('refunds_provider_refund_id_idx').on(table.providerRefundId),
  ],
);

export const agentDailyTotals = refunds.table(
  'agent_daily_totals',
  {
    agentId: text('agent_id').notNull(),
    day: date('day').notNull(),
    autoMinor: bigint('auto_minor', { mode: 'bigint' }).notNull().default(0n),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.day] })],
);

export const reconciliationExceptions = refunds.table(
  'reconciliation_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reconciler: text('reconciler').notNull(),
    reconciliationKey: text('reconciliation_key').notNull(),
    exceptionType: text('exception_type').notNull(),
    details: jsonb('details').notNull().default({}),
    status: text('status').notNull().default('open'),
    resolutionCode: text('resolution_code'),
    resolutionNote: text('resolution_note'),
    resolvedBy: text('resolved_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'reconciliation_exceptions_type_check',
      sql`${table.exceptionType} IN ('missing_internal','missing_external','amount_mismatch','currency_mismatch','charge_mismatch','state_mismatch')`,
    ),
    check(
      'reconciliation_exceptions_status_check',
      sql`${table.status} IN ('open','resolved')`,
    ),
    uniqueIndex('reconciliation_exceptions_key_idx').on(
      table.reconciler,
      table.reconciliationKey,
      table.exceptionType,
    ),
  ],
);

export const auditEvents = foundation.table(
  'audit_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    id: uuid('id').notNull().unique().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    toolId: text('tool_id').notNull(),
    actorId: text('actor_id').notNull(),
    actorRoles: text('actor_roles').array().notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    eventData: jsonb('event_data').notNull(),
    result: text('result').notNull(),
    requestId: text('request_id').notNull(),
    prevHash: bytea('prev_hash').notNull(),
    hash: bytea('hash').notNull(),
  },
  (table) => [
    index('audit_object_timeline_idx').on(
      table.objectType,
      table.objectId,
      table.seq,
    ),
  ],
);
