-- Synthetic feature flags for local demonstration. The statements are safe to run again.
WITH seed(key, description, owner, dev_on, dev_pct, stg_on, stg_pct, prod_on, prod_pct) AS (
  VALUES
    ('checkout.new_summary', 'Show the new order summary on the checkout page.', 'payments-web@company.example', true, 100, true, 100, true, 50),
    ('checkout.saved_cards', 'Let customers pay with a saved card.', 'payments-web@company.example', true, 100, true, 100, true, 100),
    ('refunds.bulk_export', 'Let finance users export many refunds in one file.', 'payments-ops@company.example', true, 100, true, 50, false, 0),
    ('refunds.auto_tier_v2', 'Use version 2 of the automatic refund tier rules.', 'payments-ops@company.example', true, 100, false, 0, false, 0),
    ('search.semantic_ranking', 'Rank payment search results by meaning.', 'search-team@company.example', true, 100, true, 25, false, 0),
    ('search.typeahead', 'Show suggestions while the user types a search.', 'search-team@company.example', true, 100, true, 100, true, 100),
    ('ledger.daily_close_v2', 'Use the new daily ledger close job.', 'ledger-team@company.example', true, 100, true, 100, true, 10),
    ('ledger.fx_rounding_fix', 'Apply the corrected currency rounding rule.', 'ledger-team@company.example', true, 100, true, 100, false, 0),
    ('kyc.document_ocr', 'Read identity documents with text recognition.', 'risk-team@company.example', true, 50, false, 0, false, 0),
    ('kyc.manual_review_queue', 'Send unclear identity checks to a manual queue.', 'risk-team@company.example', true, 100, true, 100, true, 100),
    ('notifications.sms_fallback', 'Send a text message when an email bounces.', 'messaging@company.example', true, 100, true, 75, true, 5),
    ('notifications.digest_email', 'Send one daily summary email to merchants.', 'messaging@company.example', false, 0, false, 0, false, 0),
    ('dashboard.dark_mode', 'Show the dark color theme in the merchant dashboard.', 'merchant-web@company.example', true, 100, true, 100, true, 30),
    ('payouts.instant_beta', 'Let selected merchants request an instant payout.', 'payouts-team@company.example', true, 100, true, 20, false, 0),
    ('api.rate_limit_v2', 'Use the new per-merchant API rate limits.', 'platform-api@company.example', true, 100, true, 100, true, 25)
), inserted AS (
  INSERT INTO feature_flags.flags(key, description, owner)
  SELECT key, description, owner FROM seed
  ON CONFLICT (key) DO NOTHING
  RETURNING id, key
)
INSERT INTO feature_flags.flag_environments(flag_id, environment, enabled, rollout_percent, updated_by)
SELECT inserted.id, state.environment, state.enabled, state.rollout_percent, 'seed'
FROM inserted
JOIN seed ON seed.key = inserted.key
CROSS JOIN LATERAL (VALUES
  ('development', seed.dev_on, seed.dev_pct),
  ('staging', seed.stg_on, seed.stg_pct),
  ('production', seed.prod_on, seed.prod_pct)
) AS state(environment, enabled, rollout_percent)
ON CONFLICT DO NOTHING;

-- One pending production change, so that the approval inbox has an item for flag-approver.
WITH target AS (
  SELECT f.id AS flag_id, f.key, e.enabled, e.rollout_percent, e.version
  FROM feature_flags.flags f
  JOIN feature_flags.flag_environments e ON e.flag_id = f.id AND e.environment = 'production'
  WHERE f.key = 'search.semantic_ranking'
    AND NOT EXISTS (
      SELECT 1 FROM feature_flags.change_requests
      WHERE id = '00000000-0000-4000-8000-00000000f1a9'
    )
    AND NOT EXISTS (
      SELECT 1 FROM feature_flags.change_requests c
      WHERE c.flag_id = f.id AND c.status = 'pending'
    )
), approval AS (
  INSERT INTO foundation.approval_requests(
    tool_id, action, object_type, object_id, requester_id, tier, policy_version,
    content_hash, steps, status, expires_at, summary
  )
  SELECT 'feature-flags', 'feature-flags.production_change', 'flag', t.key, 'seed-flag-editor',
         'flag_approver', 1,
         encode(sha256(convert_to(
           '00000000-0000-4000-8000-00000000f1a9|' || t.key || '|production|true|10|' || t.version::text,
           'UTF8')), 'hex'),
         '[{"roles":["flag_approver"],"approvals":[]}]'::jsonb, 'pending', now() + interval '72 hours',
         jsonb_build_object(
           'flagKey', t.key,
           'environment', 'production',
           'changeRequestId', '00000000-0000-4000-8000-00000000f1a9',
           'current', jsonb_build_object('enabled', t.enabled, 'rolloutPercent', t.rollout_percent),
           'proposed', jsonb_build_object('enabled', true, 'rolloutPercent', 10),
           'reason', 'Start a 10 percent production rollout after the staging test.'
         )
  FROM target t
  RETURNING id
)
INSERT INTO feature_flags.change_requests(
  id, flag_id, environment, enabled, rollout_percent, base_version, reason, requester_id,
  approval_request_id
)
SELECT '00000000-0000-4000-8000-00000000f1a9', t.flag_id, 'production', true, 10, t.version,
       'Start a 10 percent production rollout after the staging test.', 'seed-flag-editor', a.id
FROM target t CROSS JOIN approval a;
