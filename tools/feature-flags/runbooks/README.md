# Feature-Flag Panel runbook

## Owner and data

- Owner: `platform-engineering@company.example`.
- Data class: internal. The tool stores flag keys, descriptions, owners and environment states. It stores no customer data.
- Schema: `feature_flags`. Audit events are in `foundation.audit_events` with `tool_id='feature-flags'`.

## Controls

- A `flag_editor` changes `development` and `staging` directly. The Foundation writes an audit event with the before and after state.
- A change to `production` creates a Foundation approval with the action `feature-flags.production_change`. Only a `flag_approver` who did not submit the request can approve it. The approval handler applies the change in the same transaction as the decision.
- Each environment row has a `version`. A change with an old `expectedVersion` gets HTTP 409.
- The database allows one pending production change for each flag (`change_requests_one_pending_idx`).

## Alert: production change does not apply after approval

1. Check the API health at `/health/ready`.
2. Find the change request:

   ```sql
   SELECT c.id, f.key, c.status, c.base_version, e.version, c.approval_request_id
   FROM feature_flags.change_requests c
   JOIN feature_flags.flags f ON f.id = c.flag_id
   JOIN feature_flags.flag_environments e ON e.flag_id = c.flag_id AND e.environment = 'production'
   WHERE c.status = 'pending';
   ```

3. If `base_version` is not equal to `version`, the production state changed after the request. The approval handler refuses the change with HTTP 409. Tell the approver to reject the approval. Tell the editor to send a new request.
4. Do not edit `feature_flags.flag_environments` with SQL. A manual change has no approval and no audit event.

## Alert: many denied requests

1. Find the denied events:

   ```sql
   SELECT occurred_at, actor_id, object_id FROM foundation.audit_events
   WHERE tool_id = 'feature-flags' AND result = 'denied'
   ORDER BY seq DESC LIMIT 50;
   ```

2. Compare the actor groups in Keycloak with the roles in `src/registry.ts`.
