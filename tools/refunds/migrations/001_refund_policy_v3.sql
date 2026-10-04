-- Refund approval policy version 3 (docs/SYSTEM_DESIGN.md).
-- The migrate script runs this file on each start. Keep it idempotent.
INSERT INTO foundation.policy_versions(tool_id, version, state, configuration, proposed_by, approved_by)
VALUES (
  'refunds',
  3,
  'active',
  '{"autoLimitMinor":25000,"supervisorLimitMinor":500000,"dailyLimitMinor":200000,"expiresAfterHours":72}',
  'system',
  'policy-v3-migration'
)
ON CONFLICT (tool_id, version) DO NOTHING;

UPDATE foundation.policy_versions
SET state = 'retired'
WHERE tool_id = 'refunds' AND version < 3 AND state = 'active';
