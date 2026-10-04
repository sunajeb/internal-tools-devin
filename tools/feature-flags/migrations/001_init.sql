CREATE SCHEMA IF NOT EXISTS feature_flags;

CREATE TABLE IF NOT EXISTS feature_flags.flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_.-]{2,63}$'),
  description text NOT NULL CHECK (length(description) BETWEEN 3 AND 500),
  owner text NOT NULL CHECK (length(owner) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flags.flag_environments (
  flag_id uuid NOT NULL REFERENCES feature_flags.flags(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('development','staging','production')),
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent smallint NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_id, environment)
);

-- A production change waits here until a flag approver decides on the Foundation approval.
CREATE TABLE IF NOT EXISTS feature_flags.change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id uuid NOT NULL REFERENCES feature_flags.flags(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment = 'production'),
  enabled boolean NOT NULL,
  rollout_percent smallint NOT NULL CHECK (rollout_percent BETWEEN 0 AND 100),
  base_version int NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  requester_id text NOT NULL,
  approval_request_id uuid UNIQUE REFERENCES foundation.approval_requests(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS change_requests_one_pending_idx
  ON feature_flags.change_requests(flag_id, environment) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS audit_events_feature_flags_object_idx
  ON foundation.audit_events(tool_id, object_type, object_id, seq DESC);
