-- A change request expires when its Foundation approval expires.
ALTER TABLE feature_flags.change_requests
  DROP CONSTRAINT IF EXISTS change_requests_status_check;
ALTER TABLE feature_flags.change_requests
  ADD CONSTRAINT change_requests_status_check
  CHECK (status IN ('pending','applied','rejected','expired'));
