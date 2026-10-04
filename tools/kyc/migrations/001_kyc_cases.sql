CREATE SCHEMA IF NOT EXISTS kyc;

CREATE TABLE IF NOT EXISTS kyc.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE CHECK (reference ~ '^KYC-[0-9]{6,}$'),
  customer_name text NOT NULL CHECK (length(customer_name) BETWEEN 2 AND 200),
  date_of_birth date NOT NULL CHECK (date_of_birth BETWEEN DATE '1900-01-01' AND DATE '2015-12-31'),
  national_id text NOT NULL CHECK (length(national_id) BETWEEN 4 AND 64),
  country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  risk_score smallint NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_review','escalated','approved','rejected')),
  assignee text,
  sla_due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_by text,
  decided_at timestamptz,
  pending_approval_id uuid REFERENCES foundation.approval_requests(id),
  CONSTRAINT kyc_cases_assignee_required
    CHECK (status = 'new' OR assignee IS NOT NULL),
  CONSTRAINT kyc_cases_new_unassigned
    CHECK (status <> 'new' OR assignee IS NULL),
  CONSTRAINT kyc_cases_decision_recorded
    CHECK ((status IN ('approved','rejected')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  CONSTRAINT kyc_cases_pending_only_open
    CHECK (pending_approval_id IS NULL OR status IN ('in_review','escalated'))
);

CREATE INDEX IF NOT EXISTS kyc_cases_sla_idx ON kyc.cases (sla_due_at, id);
CREATE INDEX IF NOT EXISTS kyc_cases_created_idx ON kyc.cases (created_at, id);
CREATE INDEX IF NOT EXISTS kyc_cases_risk_idx ON kyc.cases (risk_score, id);
CREATE INDEX IF NOT EXISTS kyc_cases_status_sla_idx ON kyc.cases (status, sla_due_at, id);
CREATE INDEX IF NOT EXISTS kyc_cases_status_risk_idx ON kyc.cases (status, risk_score, id);
CREATE INDEX IF NOT EXISTS kyc_cases_country_status_idx ON kyc.cases (country, status, sla_due_at, id);
CREATE INDEX IF NOT EXISTS kyc_cases_reference_prefix_idx ON kyc.cases (reference text_pattern_ops);
CREATE INDEX IF NOT EXISTS kyc_cases_name_prefix_idx ON kyc.cases (lower(customer_name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS kyc_cases_assignee_idx ON kyc.cases (assignee, status) WHERE assignee IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kyc_cases_pending_approval_idx ON kyc.cases (pending_approval_id) WHERE pending_approval_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kyc.enforce_case_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'new' AND NEW.status = 'in_review') OR
    (OLD.status = 'in_review' AND NEW.status IN ('escalated','approved','rejected')) OR
    (OLD.status = 'escalated' AND NEW.status IN ('approved','rejected'))
  ) THEN
    RAISE EXCEPTION 'KYC case % cannot move from % to %', OLD.reference, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('approved','rejected') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'KYC case % is closed', OLD.reference USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kyc_cases_transition ON kyc.cases;
CREATE TRIGGER kyc_cases_transition
  BEFORE UPDATE ON kyc.cases
  FOR EACH ROW EXECUTE FUNCTION kyc.enforce_case_transition();

CREATE OR REPLACE FUNCTION kyc.block_case_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_runtime' THEN
    RAISE EXCEPTION 'KYC cases cannot be deleted by the application' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS kyc_cases_no_delete ON kyc.cases;
CREATE TRIGGER kyc_cases_no_delete
  BEFORE DELETE ON kyc.cases
  FOR EACH ROW EXECUTE FUNCTION kyc.block_case_delete();
