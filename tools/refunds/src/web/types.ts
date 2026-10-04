export type User = { id: string; displayName: string; roles: string[] };

export type Charge = {
  id: string;
  customer_id: string;
  customer_email: string;
  card_brand: string;
  card_last4: string;
  amount_minor: string;
  currency: string;
  refunded_minor: string;
  refundable_minor?: string;
  created_at: string;
  refunds?: Refund[];
};

export type Refund = {
  id: string;
  charge_id: string;
  amount_minor: string;
  currency: string;
  reason_code: string;
  status: string;
  tier: string;
  requester_id: string;
  created_at: string;
  note?: string;
  approval_id?: string;
  approvalSteps?: string[][];
  timeline?: TimelineEvent[];
};

export type TimelineEvent = {
  action: string;
  occurredAt: string;
  actorId: string;
  actorRoles?: string[];
  after?: { stepIndex?: number } | null;
};

export type ChargeSort =
  'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export type Approval = Refund & {
  approval_id: string;
  requester_id: string;
  note: string;
  tier: string;
  steps: Array<{ roles: string[]; approvals: unknown[] }>;
};

export type Message = { tone: 'success' | 'error'; text: string };

export type DashboardSummary = {
  states: Array<{ status: string; count: number }>;
  pendingApprovals: number;
  openExceptions: number;
  executionPaused: boolean;
};

export type ReconciliationException = {
  id: string;
  exception_type: string;
  reconciliation_key: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type AuditEntry = {
  seq: number;
  event_data: {
    action: string;
    actorId: string;
    objectType: string;
    objectId: string;
    occurredAt: string;
    result: string;
  };
  hash: string;
};
