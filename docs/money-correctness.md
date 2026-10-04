# Refunds money-correctness review

This document records the money-correctness review of the Refunds Console.
Each acceptance criterion has an automated Vitest integration test.
The tests run against the Docker Compose stack: API, worker, PostgreSQL 16, and the payment simulator.
The tests use only synthetic charges, users, and sessions.

## How to run

1. Start the stack: `docker compose up -d --build --wait`.
2. Run the tests: `npm test`.

The suite is in `tools/refunds/src/money-correctness.test.ts`.
The suite connects to the API on port 3000, the simulator on port 4000, and PostgreSQL on port 5432.
The suite connects to PostgreSQL as the owner role `tools` and as the runtime role `app_runtime`.
If the stack does not respond, the suite skips the stack tests and prints a warning.
The registry test always runs.
You can change the endpoints with `INTEGRATION_API_URL`, `INTEGRATION_SIMULATOR_URL`, `INTEGRATION_OWNER_DATABASE_URL`, and `INTEGRATION_RUNTIME_DATABASE_URL`.

The suite creates synthetic sessions directly in `foundation.sessions`.
This lets one test use many different users, for example two supervisors.
The suite deletes these sessions at the end.

## Summary

| #   | Criterion                                | Result         | Bug                         |
| --- | ---------------------------------------- | -------------- | --------------------------- |
| 1   | Idempotency key replay and conflict      | Pass           | None                        |
| 2   | 20 concurrent requests on one charge     | Pass           | None                        |
| 3   | Daily auto-tier limit                    | Pass           | None                        |
| 4   | Policy tier boundaries and dual approval | Pass           | B1 (policy version)         |
| 5   | Provider timeout and retry               | Pass           | None                        |
| 6   | Duplicate and out-of-order webhooks      | Pass after fix | B2 (webhook queue blocks)   |
| 7   | Reconciliation of a provider-only refund | Pass after fix | B3 (reconciliation request) |
| 8   | Audit tampering by the owner role        | Pass           | F2 (residual risk)          |
| 9   | Execution kill switch                    | Pass           | None                        |
| 10  | Invalid refund state transitions         | Pass           | None                        |
| R   | Registry against the system design       | Pass after fix | B1 (policy version)         |

"Pass after fix" means that at least one test for the criterion failed on base commit `a342626`.
The fix is in `tools/refunds/**` in the same pull request.
On the base commit, three tests failed:

- `C6 a webhook that cannot apply does not block later webhooks` (B2).
- `C7 each reconciliation request queues a run, even when the request ID repeats` (B3).
- `uses policy version 3: auto <= 25000, supervisor <= 500000, dual otherwise, 72 hour expiry` (B1).

The C4 test passed on the base commit because it compares the stored version with the registry version. Both were 1.

## Criteria

### 1. Idempotency key

- Test: `C1 idempotency: same key and body replays one refund; a different body returns 422`.
- Result: Pass.
- Evidence:
  - The second request with the same key and body returns the same status and the same body.
  - The same key with a different amount returns HTTP 422.
  - Five parallel requests with one new key create one refund. Each response is HTTP 201 (replay) or HTTP 409 (in progress).
  - The charge has exactly two refunds and the reserved amount is 70000.
- Bug: None.

### 2. Concurrency on one charge

- Test: `C2 concurrency: 20 parallel requests never refund more than the charge`.
- Result: Pass.
- Evidence:
  - A supervisor sends 20 parallel requests of 150000 against a charge of 1000000. The result is 6 × HTTP 201 and 14 × HTTP 409.
  - The requester is a supervisor because the tier uses the total refund for the charge (SR-02 in `docs/security-review.md`). After 500000, the tier is `dual`, and only a supervisor can request it.
  - `refunded_minor` is 900000. The sum of active refunds is also 900000.
  - The `CHECK (refunded_minor <= amount_minor)` constraint rejects an over-refund when the owner disables triggers (`session_replication_role = replica`).
  - The `guard_charge_reservation` trigger rejects an over-refund from `app_runtime`.
- Bug: None.

### 3. Daily limit

- Test: `C3 daily limit: auto-tier refunds stop at 2,000.00 for each agent, also under concurrency`.
- Result: Pass.
- Evidence:
  - 10 parallel auto-tier requests of 25000 give 8 × HTTP 201 and 2 × HTTP 422.
  - Each request uses a new charge, because the tier uses the total refund for the charge (SR-02). A second 25000 refund on one charge is in the `supervisor` tier.
  - One more request of 1 returns HTTP 422.
  - `agent_daily_totals.auto_minor` is exactly 200000.
  - A supervisor-tier request (25001) is still accepted. It does not count toward the auto-tier limit.
- Bug: None.

### 4. Policy tiers and dual approval

- Test: `C4 policy tiers at the boundaries and two different approvers for dual tier`.
- Result: Pass. The tiers and approvals are correct. The stored policy version was wrong (B1).
- Evidence:
  - Each boundary request uses a new charge, because the tier uses the total refund for the charge (SR-02).
  - 25000 is `auto` and `approved`. 25001 and 500000 are `supervisor` and `pending_approval`. 500001 is `dual` with steps `[["supervisor"],["finance"]]`.
  - An agent cannot request a dual-tier refund (HTTP 403).
  - The refund row and the approval request store the registry policy version. The approval expires after 72 hours.
  - The requester cannot approve (HTTP 403). Finance cannot approve step 1 before step 0 (HTTP 403 and HTTP 409).
  - One user with both the supervisor and finance roles approves step 0. The same user cannot approve step 1 (HTTP 409).
  - A second supervisor cannot approve the finance step (HTTP 403).
  - Finance approves step 1. The refund executes and the provider has exactly one refund.
- Bug: B1. The stored policy version was 1. The system design specifies 3.

### 5. Provider timeout and retry

- Test: `C5 provider timeout then retry creates exactly one provider refund`.
- Result: Pass.
- Evidence, part a (simulator fault `timeout-then-succeed`, HTTP 503 before the provider records the refund):
  - The worker retries and the refund becomes `succeeded`.
  - The simulator has exactly one refund for the refund ID.
  - The outbox job is `done`. There is one `refund.execution_started` and one `refund.execution_completed` audit event.
- Evidence, part b (the provider records the refund, but the response is lost):
  - The test wraps the real simulator client. The first call reaches the simulator and then throws a timeout error.
  - The retry sends the same idempotency key (the refund ID). The simulator returns the first refund.
  - The simulator has exactly one refund. The refund row stores that provider refund ID.
- Bug: None.
- Note: The simulator fault `timeout-then-succeed` fails before the simulator records the refund. Part b covers the case where the response is lost after the provider records the refund.

### 6. Webhooks

- Tests:
  - `C6 duplicate webhooks apply once; out-of-order webhooks cannot move state backward`.
  - `C6 a webhook that cannot apply does not block later webhooks`.
- Result: Pass after fix B2.
- Evidence:
  - The same signed event ID sent twice creates one `inbound_events` row.
  - A second `refund.succeeded` event with a new ID does not create a second completion audit event.
  - A late `refund.failed` event and a late `refund.pending` event do not change a `succeeded` refund. The charge reservation does not change.
  - A `refund.succeeded` event for a refund in `approved` state does not block the next webhook. The approved refund stays `approved` and executes once after resume.
- Bug: B2.

### 7. Reconciliation

- Tests:
  - `C7 reconciliation finds a provider-only refund and raises an exception`.
  - `C7 each reconciliation request queues a run, even when the request ID repeats`.
- Result: Pass after fix B3.
- Evidence:
  - The simulator `POST /admin/ghost-refund` creates a refund that has no internal record.
  - `POST /api/reconciliation/run` returns HTTP 202. The worker records an open `missing_internal` exception with the provider refund ID, the charge ID, and the amount.
  - `GET /api/exceptions` lists the exception.
  - Two requests with the same `x-request-id` header queue two runs.
- Bug: B3.

### 8. Audit tampering

- Test: `C8 audit tampering by the database owner is detected by /api/audit/verify`.
- Result: Pass.
- Evidence:
  - `app_runtime` cannot update `foundation.audit_events` (permission denied).
  - The owner `tools` cannot update the table while the append-only trigger is active.
  - The owner disables triggers with `session_replication_role = replica` and changes `event_data`. `GET /api/audit/verify` returns `valid: false` and the ID of the changed event.
  - The owner deletes an event in the middle of the chain. `verifyAuditChain` returns `valid: false` and the ID of the next event.
  - The test restores the original rows. The endpoint then returns `valid: true`.
- Bug: None in the tested scope. See finding F2 for a residual risk.

### 9. Execution kill switch

- Test: `C9 the kill switch holds approved refunds; resume executes each once`.
- Result: Pass.
- Evidence:
  - An agent cannot set the kill switch (HTTP 403).
  - With the switch on, an auto-tier refund and a supervisor-approved refund stay `approved` for 5 seconds. Their outbox jobs stay `pending`. The simulator has no refund for them.
  - After resume, both refunds become `succeeded`. Each has one provider refund, one `done` outbox job, and one `refund.execution_started` audit event.
- Bug: None.

### 10. Invalid state transitions

- Test: `C10 the database and API reject invalid refund state transitions`.
- Result: Pass.
- Evidence:
  - The test tries all 72 transitions between the 9 statuses as `app_runtime`.
  - The trigger accepts only these transitions: `pending_approval` to `approved`, `rejected`, `cancelled`, or `expired`; `approved` to `executing`; `executing` to `succeeded` or `failed`; `succeeded` to `reconciled`.
  - The trigger rejects all other transitions with `invalid refund transition`.
  - A rejected refund releases its reservation. A later approval returns HTTP 409. The worker does not call the provider for it.
- Bug: None.

### Registry check

- Test: `uses policy version 3: auto <= 25000, supervisor <= 500000, dual otherwise, 72 hour expiry`.
- Result: Pass after fix B1.
- Differences found on base commit `a342626`:
  - `tools/refunds/src/registry.ts` had `version: 1`. The system design specifies `version: 3`.
  - `tools/refunds/src/domain.ts` had `refundPolicyVersion = 1` as a separate constant.
  - `tools/refunds/src/api.ts` wrote the literal `1` to `refunds.refunds.policy_version`.
  - `tools/refunds/src/web.tsx` showed the label `POLICY V1`.
- No difference: the tiers (auto <= 25000, supervisor <= 500000, dual otherwise), the steps, and `expiresAfterHours: 72` agree with the system design.

## Bugs fixed in `tools/refunds/**`

### B1. Policy version 1 instead of 3

- Effect: Each refund and approval request recorded policy version 1. An audit could not prove which policy approved a refund.
- Fix:
  - `registry.ts`: `version: 3`.
  - `domain.ts`: export the policy and read `refundPolicyVersion` from it.
  - `api.ts`: write `refundPolicyVersion` to `policy_version`. Set the approval expiry from `refundPolicy.expiresAfterHours`.
  - `web.tsx`: show `POLICY V3`.
- Existing rows keep version 1. This is correct because those refunds used the old record.
- Follow-up fix (Devin Review): `foundation.policy_versions` had only version 1. New refunds cited a version that the policy history did not contain.
  - `tools/refunds/migrations/001_refund_policy_v3.sql` adds version 3 as `active` and sets older active versions to `retired`. The file is idempotent because the migrate script runs it on each start.
  - Version 2 never existed in this repository. The system design goes from version 1 to version 3.
  - Test: `R policy_versions has refund policy version 3 as the only active version`.

### B2. One webhook that cannot apply blocked all later webhooks

- Effect: The webhook processor accepted events for refunds in `approved` state and tried `approved -> succeeded`. The transition trigger rejected this. The error stopped the loop before the event was marked as processed. The processor reads the oldest event first, so the same event failed on each run. No later webhook was processed.
- Evidence on base: the test timed out. The worker log showed `invalid refund transition: approved -> succeeded` on each run.
- Fix in `worker.ts`:
  - Apply a webhook only to a refund in `executing` state. Other states ignore the event. Reconciliation reports any difference with the provider.
  - Process each event in its own `try`/`catch`. Write the error to `inbound_events.error`. Skip events that have an error.
  - Record `provider_declined` as the failure code for a `refund.failed` webhook.
- Follow-up fix (Devin Review): the first fix wrote the error for all failures. A transient database error then dropped the webhook permanently.
  - The worker now writes the error and skips the event only for permanent PostgreSQL errors: `P0001` (trigger exception), class `22` (data), and class `23` (constraint).
  - For other errors, the worker keeps the event for the next run, continues with later events, and then reports the first error.
  - Tests: `keeps an event for retry after a transient error and processes later events` and `records a permanent error, skips the event, and processes later events`.

### B3. Reconciliation requests used the client request ID as the outbox key

- Effect: `POST /api/reconciliation/run` used `reconciliation:${requestId}` as the outbox idempotency key. The API accepts the request ID from the `x-request-id` header. A client that sends a repeated header value got HTTP 202, but no new run was queued.
- Fix in `api.ts`: use `reconciliation:${randomUUID()}`.

## Foundation findings (not committed)

The rules do not permit changes to `packages/foundation/**` or `apps/api/src/server.ts`.
This section gives the proposed patches. Nobody applied them in this pull request.

### F1. Approval expiry ignores the policy `expiresAfterHours`

- Location: `packages/foundation/src/runtime.ts`, `approvals.create`.
- Effect: If a tool does not send `expiresAt`, the expiry is always 72 hours. The policy value `expiresAfterHours` has no effect. The Refunds policy also uses 72, so the Refunds Console has no wrong result today. B1 now sends `expiresAt` from the policy.
- Proposed patch:

```diff
--- a/packages/foundation/src/runtime.ts
+++ b/packages/foundation/src/runtime.ts
@@ approvals: {
       create: async (input) => {
+        const policy = registration.tool.approvalRules?.[input.action] as
+          | { expiresAfterHours?: number }
+          | undefined;
+        const expiresAt =
+          input.expiresAt ??
+          new Date(
+            Date.now() + (policy?.expiresAfterHours ?? 72) * 60 * 60_000,
+          );
         const result = await client.query(
@@
-            input.expiresAt ?? new Date(Date.now() + 72 * 60 * 60_000),
+            expiresAt,
             JSON.stringify(input.summary ?? {}),
```

### F2. Audit verification cannot detect deletion of the newest events

- Location: `packages/foundation/src/audit.ts` (`verifyAuditChain`) and `GET /api/audit/verify` in `apps/api/src/server.ts`.
- Effect: The hash chain starts at a fixed genesis hash and has no external anchor. If the owner role deletes the newest N events, the remaining chain is valid. The endpoint returns `valid: true`. This is an inference from the code. The test does not assert it.
- Related: In the local stack, `tools` is a PostgreSQL superuser. It can disable the append-only trigger with `session_replication_role`. Production must not give this role to people or to services.
- Proposed patch: return the chain head so that an external monitor can store it and compare it on the next run.

```diff
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ server.get('/api/audit/verify', async (request, reply) => {
     const result = await database.query(
-      'SELECT event_data,prev_hash,hash FROM foundation.audit_events ORDER BY seq',
+      'SELECT seq,event_data,prev_hash,hash FROM foundation.audit_events ORDER BY seq',
     );
@@
+    const head = result.rows.at(-1);
     return {
       ...verification,
       eventCount: result.rowCount,
+      headSeq: head ? String(head.seq) : null,
+      headHash: head ? Buffer.from(head.hash).toString('hex') : null,
       verifiedAt: new Date().toISOString(),
     };
```

### F3. The API accepts the request ID from the client

- Location: `apps/api/src/server.ts`, `requestIdHeader: 'x-request-id'`.
- Effect: `ctx.requestId` and the audit `requestId` come from a client header. A client can reuse a value or send a false value. B3 shows one result. Tools must not use `ctx.requestId` as a unique key.
- Proposed patch: generate the request ID on the server and keep the client value only as a correlation field.

```diff
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@
-    requestIdHeader: 'x-request-id',
+    requestIdHeader: false,
+    genReqId: () => randomUUID(),
```

```diff
-import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
+import {
+  createHmac,
+  randomBytes,
+  randomUUID,
+  timingSafeEqual,
+} from 'node:crypto';
```
