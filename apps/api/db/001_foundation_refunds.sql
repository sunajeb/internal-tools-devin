CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS foundation;
CREATE SCHEMA IF NOT EXISTS refunds;

CREATE TABLE IF NOT EXISTS foundation.sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  display_name text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS foundation.audit_events (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  tool_id text NOT NULL,
  actor_id text NOT NULL,
  actor_roles text[] NOT NULL DEFAULT '{}',
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  event_data jsonb NOT NULL,
  result text NOT NULL,
  request_id text NOT NULL,
  source_ip inet,
  user_agent text,
  prev_hash bytea NOT NULL,
  hash bytea NOT NULL
);

CREATE OR REPLACE FUNCTION foundation.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_events_immutable ON foundation.audit_events;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON foundation.audit_events
  FOR EACH ROW EXECUTE FUNCTION foundation.reject_audit_mutation();

CREATE TABLE IF NOT EXISTS foundation.idempotency_keys (
  actor_id text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_code int,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, route, key)
);

CREATE TABLE IF NOT EXISTS foundation.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id text NOT NULL,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  requester_id text NOT NULL,
  tier text NOT NULL,
  policy_version int NOT NULL,
  content_hash text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE foundation.approval_requests
  ADD COLUMN IF NOT EXISTS summary jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS approvals_expiry_idx ON foundation.approval_requests(expires_at) WHERE status='pending';

CREATE TABLE IF NOT EXISTS foundation.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid NOT NULL REFERENCES foundation.approval_requests(id),
  step_index int NOT NULL,
  approver_id text NOT NULL,
  approver_role text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','reject')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_request_id, approver_id),
  UNIQUE (approval_request_id, step_index)
);

CREATE TABLE IF NOT EXISTS foundation.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending','in_flight','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE foundation.outbox ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS outbox_ready_idx ON foundation.outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS foundation.inbound_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX IF NOT EXISTS inbound_events_pending_idx ON foundation.inbound_events(received_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS foundation.tool_settings (
  tool_id text PRIMARY KEY,
  execution_paused boolean NOT NULL DEFAULT false,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO foundation.tool_settings(tool_id) VALUES ('refunds') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS foundation.policy_versions (
  tool_id text NOT NULL,
  version int NOT NULL,
  state text NOT NULL CHECK (state IN ('proposed','active','retired')),
  configuration jsonb NOT NULL,
  proposed_by text NOT NULL,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tool_id, version),
  CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);
INSERT INTO foundation.policy_versions(tool_id, version, state, configuration, proposed_by, approved_by)
VALUES ('refunds', 1, 'active', '{"autoLimitMinor":25000,"supervisorLimitMinor":500000,"dailyLimitMinor":200000}', 'system', 'bootstrap')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS refunds.charges (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  customer_email text NOT NULL,
  card_brand text NOT NULL,
  card_last4 text NOT NULL,
  provider_charge_id text UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_minor <= amount_minor)
);
ALTER TABLE refunds.charges
  ALTER COLUMN card_last4 TYPE text
  USING btrim(card_last4::text);
DO $$
BEGIN
  ALTER TABLE refunds.charges
    ADD CONSTRAINT charges_card_last4_format_check
    CHECK (card_last4 ~ '^[0-9]{4}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
CREATE INDEX IF NOT EXISTS charges_customer_idx ON refunds.charges(customer_id);
CREATE INDEX IF NOT EXISTS charges_card_date_idx ON refunds.charges(card_last4, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS charges_created_idx ON refunds.charges(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS charges_email_idx ON refunds.charges(customer_email);
CREATE INDEX IF NOT EXISTS charges_amount_idx ON refunds.charges(amount_minor);
CREATE INDEX IF NOT EXISTS charges_id_trgm_idx ON refunds.charges USING gin(id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS charges_customer_trgm_idx ON refunds.charges USING gin(customer_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS charges_email_trgm_idx ON refunds.charges USING gin(customer_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS charges_card_trgm_idx ON refunds.charges USING gin(card_last4 gin_trgm_ops);

CREATE TABLE IF NOT EXISTS refunds.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id text NOT NULL REFERENCES refunds.charges(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  reason_code text NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 1000),
  requester_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_approval','approved','rejected','cancelled','expired','executing','succeeded','failed','reconciled')),
  tier text NOT NULL,
  policy_version int NOT NULL,
  approval_request_id uuid REFERENCES foundation.approval_requests(id),
  provider_refund_id text UNIQUE,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_state_date_idx ON refunds.refunds(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS refunds_charge_idx ON refunds.refunds(charge_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_object_timeline_idx ON foundation.audit_events(object_type, object_id, seq);

CREATE TABLE IF NOT EXISTS refunds.agent_daily_totals (
  agent_id text NOT NULL,
  day date NOT NULL,
  auto_minor bigint NOT NULL DEFAULT 0 CHECK (auto_minor >= 0),
  PRIMARY KEY (agent_id, day)
);

CREATE TABLE IF NOT EXISTS refunds.reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciler text NOT NULL,
  reconciliation_key text NOT NULL,
  exception_type text NOT NULL CHECK (exception_type IN ('missing_internal','missing_external','amount_mismatch','currency_mismatch','charge_mismatch','state_mismatch')),
  details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution_code text,
  resolution_note text,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (reconciler, reconciliation_key, exception_type)
);

CREATE OR REPLACE FUNCTION refunds.check_refund_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  allowed := CASE OLD.status
    WHEN 'pending_approval' THEN NEW.status IN ('approved','rejected','cancelled','expired')
    WHEN 'approved' THEN NEW.status = 'executing'
    WHEN 'executing' THEN NEW.status IN ('succeeded','failed')
    WHEN 'succeeded' THEN NEW.status = 'reconciled'
    ELSE false
  END;
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid refund transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status IN ('rejected','cancelled','expired','failed') THEN
    UPDATE refunds.charges SET refunded_minor = refunded_minor - OLD.amount_minor WHERE id = OLD.charge_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS refund_transition_guard ON refunds.refunds;
CREATE TRIGGER refund_transition_guard
  BEFORE UPDATE OF status ON refunds.refunds
  FOR EACH ROW EXECUTE FUNCTION refunds.check_refund_transition();

CREATE OR REPLACE FUNCTION refunds.guard_charge_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.refunded_minor > NEW.amount_minor THEN
    RAISE EXCEPTION 'amount exceeds refundable balance';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS charge_reservation_guard ON refunds.charges;
CREATE TRIGGER charge_reservation_guard
  BEFORE UPDATE OF refunded_minor ON refunds.charges
  FOR EACH ROW EXECUTE FUNCTION refunds.guard_charge_reservation();
