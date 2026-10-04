# KYC Review Queue runbook

The KYC Review Queue uses the shared Foundation for sign-in, permissions, CSRF, audit, approvals, masking and logs. This tool has no separate control code.

## Data and access

- Schema: `kyc`. Table: `kyc.cases`. The API runs as `app_runtime`. A trigger blocks deletes by `app_runtime`.
- Personal data: customer name and date of birth are `confidential`. National ID is `restricted`. The API masks all three by default.
- A reveal shows one field. The user must own the case (or be a KYC lead) and must write a reason. The audit log records the field and the reason. It does not record the value.
- The auditor role has read access only. It always sees masked values.

## Workflow

- Valid steps: `new` → `in_review` (claim) → `approved`, `rejected` or `escalated`. An escalated case goes to `approved` or `rejected`.
- A database trigger enforces these steps. The API returns HTTP 409 for a step that is not valid.
- If the risk score is 70 or more, an approval creates a Foundation approval request (`kyc.case_approval`). A different KYC lead must approve it. The approval handler closes the case in the same transaction.
- If the approval request expires, the next decision on the case clears it. The approval handler also refuses an expired request.

## Alerts and checks

1. Check the API health at `/health/ready`.
2. Find denied requests:

   ```sql
   SELECT occurred_at, actor_id, action, object_id
   FROM foundation.audit_events
   WHERE tool_id = 'kyc' AND result = 'denied'
   ORDER BY seq DESC LIMIT 50;
   ```

3. Find personal data reveals in the last day:

   ```sql
   SELECT occurred_at, actor_id, object_id, event_data->'after' AS detail
   FROM foundation.audit_events
   WHERE tool_id = 'kyc' AND action = 'kyc.pii_revealed'
     AND occurred_at > now() - interval '1 day'
   ORDER BY seq DESC;
   ```

4. Find cases past their SLA:

   ```sql
   SELECT status, count(*) FROM kyc.cases
   WHERE sla_due_at < now() AND status IN ('new','in_review','escalated')
   GROUP BY status;
   ```

5. Find stuck approval requests:

   ```sql
   SELECT c.reference, a.id, a.requester_id, a.expires_at
   FROM kyc.cases c JOIN foundation.approval_requests a ON a.id = c.pending_approval_id
   WHERE a.status <> 'pending' OR a.expires_at < now();
   ```

## Safe recovery

- Do not edit `kyc.cases` by hand to change a status. Use the API so that the audit log records the change.
- To clear an expired approval, ask the case owner to open the case and record a decision. The API clears the expired request and writes an audit event.
- Load more synthetic data with `npm run db:seed`. The seed is idempotent and uses synthetic values only.
