# Security review: Foundation and Refunds Console

- Scope: Foundation and Refunds Console.
- Date: 2026-10-04.
- Method: source review, attacks on the local Docker Compose stack, and Vitest tests on the real Postgres.
- Users: the six local Keycloak users. Data: synthetic seed data only.

## Summary

- Critical: 0. High: 2. Medium: 11. Low: 14.
- The base branch fixed SR-04 and SR-20 in `a2ee631` during this review. A test in this PR covers SR-04.
- SR-01 (High) is open. One unauthenticated request stops the API process. The fix is in `apps/api/src/server.ts`. The shared rules lock that file. The exact patch is in this document.
- SR-02 (High) is fixed in this PR. An Agent could split a large refund to avoid the Supervisor-only rule and dual approval.
- Seven findings are in `packages/foundation/**`. SR-04 is now fixed on the base. This PR does not change Foundation code. Each open Foundation finding has an exact proposed patch.
- The main controls work. They include CSRF, self-approval denial (also for `agent-supervisor`), approval step order, and webhook HMAC with a replay window.
- Idempotency binding, SQL parameters, mass-assignment protection, masking, log redaction, and audit immutability for `app_runtime` also work.

## How to run the tests

```bash
docker compose up -d --build --wait
npm test
```

- `apps/api/test/permission-matrix.test.ts`: calls every registered route and every core route as 7 personas and as an anonymous caller. A new route that is not in the matrix makes the test fail.
- `apps/api/test/security-controls.test.ts` tests route permissions, self-approval and audit, approval steps, split refunds, and mass assignment. It also tests idempotency, CSRF, webhook signature and replay, SQL input, masking, and `app_runtime` privileges.
- The tests build the API in-process with `buildServer()`. The API connects as `app_runtime`. Fixture setup and cleanup use the owner role.
- CI sets `RUNTIME_DB_PASSWORD` so that `npm run db:migrate` creates `app_runtime` for these tests.

## Findings

| ID    | Severity | Area                                           | Location                                | Status                                |
| ----- | -------- | ---------------------------------------------- | --------------------------------------- | ------------------------------------- |
| SR-01 | High     | Unauthenticated request stops the API          | `apps/api/src/server.ts`                | Fixed on base (`9b326b1`)             |
| SR-02 | High     | Split refunds avoid dual approval              | `tools/refunds/src/api.ts`              | Fixed on base (PR #5), test added     |
| SR-03 | Medium   | Body `decision` overrides the approval route   | Foundation `runtime.ts`                 | Fixed on base (`9b326b1`)             |
| SR-04 | Medium   | Expired approval can still be approved         | Foundation `runtime.ts`                 | Fixed on base (`a2ee631`), test added |
| SR-05 | Medium   | Client sets request ID; IDs repeat             | `server.ts`, `tools/refunds/src/api.ts` | Open (patch below)                    |
| SR-06 | Medium   | Login CSRF in OIDC callback                    | `server.ts`                             | Open (patch below)                    |
| SR-07 | Medium   | Session IDs stored in clear text               | `server.ts`, migration                  | Open (patch below)                    |
| SR-08 | Medium   | Default secrets outside `NODE_ENV=production`  | `server.ts`                             | Open (patch below)                    |
| SR-09 | Medium   | Rate limit keyed on proxy IP; no route limits  | `server.ts`                             | Open (patch below)                    |
| SR-10 | Medium   | Search confirms customer email without reveal  | `tools/refunds/src/api.ts`              | Open (patch below)                    |
| SR-11 | Medium   | `app_runtime` can rewrite approval records     | `apps/api/src/migrate.ts`               | Open (patch below)                    |
| SR-12 | Medium   | API container holds the owner DB URL           | `docker-compose.yml`                    | Open (patch below)                    |
| SR-13 | Medium   | Web UI has no frame protection                 | `apps/web/vite.config.ts`               | Open (patch below)                    |
| SR-14 | Low      | Validation runs before authorization           | Foundation `runtime.ts`                 | Open (patch below)                    |
| SR-15 | Low      | Approval lookup before authorization; 500      | Foundation `runtime.ts`                 | Open (patch below)                    |
| SR-16 | Low      | Hard-coded role bypass in `authorize`          | Foundation `registry.ts`                | Open (patch below)                    |
| SR-17 | Low      | Approval summary can overwrite list fields     | Foundation `runtime.ts`                 | Open (patch below)                    |
| SR-18 | Low      | Idempotency key has no length limit or expiry  | Foundation `runtime.ts`                 | Open (patch below)                    |
| SR-19 | Low      | Audit records the proxy IP                     | `server.ts`                             | Open (see SR-09)                      |
| SR-20 | Low      | Audit CSV writes `[object Object]`             | `server.ts`                             | Fixed on base (`a2ee631`)             |
| SR-21 | Low      | Signed webhook with bad JSON returns 500       | `server.ts`                             | Open (see SR-01 patch)                |
| SR-22 | Low      | Non-UUID IDs return 500                        | `tools/refunds/src/api.ts`              | Open (patch below)                    |
| SR-23 | Low      | Export denials are not audited                 | `tools/refunds/src/api.ts`              | Open                                  |
| SR-24 | Low      | Refund detail returns all columns              | `tools/refunds/src/api.ts`              | Open                                  |
| SR-25 | Low      | Unauthenticated `/api/registry` and `/metrics` | `server.ts`                             | Open                                  |
| SR-26 | Low      | User ID from `preferred_username`; stale roles | `server.ts`                             | Open                                  |
| SR-27 | Low      | Payment simulator refund list has no auth      | `services/payment-simulator`            | Open (local only)                     |

### SR-01 (High): one unauthenticated request stops the API process

- Effect: any network caller can stop the API. The Compose API runs `tsx watch`. `tsx watch` does not restart after a crash, and the container stays `running`, so Docker does not restart it. All users lose the console until an operator restarts the container.
- Cause: `fastify-raw-body` is registered with `encoding: false` and `runFirst: true` (`server.ts` lines 111-116). For a `text/plain` body on a `rawBody` route, `raw-body` gets a string chunk and calls `Buffer.concat` with it. This throws in a stream callback. Node stops the process. The signature check never runs.
- Evidence (no session, no signature):

```text
$ curl -X POST localhost:3000/api/webhooks/simulator -H 'content-type: text/plain' --data 'x'
HTTP 000
$ curl localhost:3000/health/live
HTTP 000
$ curl localhost:5173/api/session
HTTP 500
api-1  | TypeError [ERR_INVALID_ARG_TYPE]: The "list[0]" argument must be an instance of Buffer or Uint8Array. Received type string ('x')
api-1  |     at Function.concat (node:buffer:606:13)
api-1  |     at IncomingMessage.onEnd (/workspace/node_modules/raw-body/index.js:286:18)
api-1  | Node.js v22.23.3
```

- A minimal Fastify app with the same `fastify-raw-body` options shows the same crash. With the patch below, the same request gets HTTP 415 and the process continues.
- Status: Open. `apps/api/src/server.ts` is locked by the shared rules. Proposed patch (also fixes SR-21):

```diff
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@
   server.post(
     '/api/webhooks/simulator',
-    { config: { rawBody: true } },
+    {
+      config: { rawBody: true },
+      onRequest: async (request, reply) => {
+        const type = String(request.headers['content-type'] ?? '');
+        if (!type.startsWith('application/json')) {
+          return reply
+            .code(415)
+            .send({ error: 'Send the webhook as application/json.' });
+        }
+      },
+    },
     async (request, reply) => {
@@
       if (!safeEqual(match[2]!, expected)) {
         return reply.code(401).send({ error: 'Webhook signature is invalid.' });
       }
-      const payload = JSON.parse(raw.toString('utf8')) as {
-        id: string;
-        type: string;
-      };
+      let payload: { id: string; type: string };
+      try {
+        payload = z
+          .object({ id: z.string().min(1).max(128), type: z.string().min(1).max(64) })
+          .passthrough()
+          .parse(JSON.parse(raw.toString('utf8')));
+      } catch {
+        return reply.code(400).send({ error: 'Webhook body is not valid.' });
+      }
       await database.query(
```

- Defense in depth: run the API with `node dist/server.js` (or `tsx` without `watch`) in Compose so `restart: unless-stopped` restarts it after a crash.

### SR-02 (High): an Agent splits a large refund to avoid dual approval

- Policy: a refund above $5,000 needs dual approval (Supervisor, then Finance). Only a Supervisor can request it.
- Cause: the request route chose the tier from the single request amount (`tools/refunds/src/api.ts`, `refundTier(amount)`). It did not count earlier open or completed refunds on the same charge.
- Evidence (before the fix, Agent session, charge `ch_000002` for $10,010):

```text
POST /api/refunds {"chargeId":"ch_000002","amountMinor":"500000",...}  -> 201 "status":"pending_approval","tier":"supervisor"
POST /api/refunds {"chargeId":"ch_000002","amountMinor":"500000",...}  -> 201 "status":"pending_approval","tier":"supervisor"
POST /api/refunds {"chargeId":"ch_000003","amountMinor":"1000000",...} -> 403 "Only a Supervisor can request a refund above $5,000."
```

- Effect: $10,000 leaves on one charge with one Supervisor approval per part and no Finance approval. Different Supervisors can approve each part.
- Fix in this PR: the tier uses the charge's `refunded_minor` plus the new amount. `refunded_minor` already holds the open reservations and the completed refunds. Rejected, expired, cancelled, and failed refunds release their reservation, so they do not count. The refund dialog preview uses the same rule.

```diff
-      const tier = refundTier(amount);
+      const tier = refundTier(BigInt(charge.refunded_minor) + amount);
```

- Evidence after the fix (rebuilt stack, Agent session, charge `ch_000010` for $10,100):

```text
POST /api/refunds {"chargeId":"ch_000010","amountMinor":"500000",...} -> 201 "tier":"supervisor"
POST /api/refunds {"chargeId":"ch_000010","amountMinor":"500000",...} -> 403 "Only a Supervisor can request a refund above $5,000."
```

- The dialog now shows "Supervisor + Finance Approval" for a $10 request on a charge with $10,000 already refunded.
- Test: `security-controls.test.ts` > "stops an Agent from splitting a large refund to avoid dual approval".
- Residual risk: an Agent can still split across different charges of one customer. The daily instant-refund limit covers only the auto tier. Consider a per-customer daily limit.

### SR-03 (Medium): the body `decision` overrides the approval route

- Cause: `decide()` uses `body.data.decision ?? decision` (`packages/foundation/src/runtime.ts` line 555). The route name has no effect when the body has `decision`.
- Evidence (Supervisor session):

```text
POST /api/approvals/b862444e-.../reject  {"decision":"approve"}
HTTP 200 {"status":"approved"}
audit: approval.approved
```

- Effect: a client, proxy rule, or WAF rule that allows only `/reject` can still approve money movement. Logs that show the URL do not show the real decision.
- The Refunds UI sends both decisions to `/approve` with a body `decision` (`tools/refunds/src/web.tsx` line 1152). Change the UI first, then Foundation.
- Proposed patch:

```diff
--- a/tools/refunds/src/web.tsx
+++ b/tools/refunds/src/web.tsx
@@
-      api(`/api/approvals/${id}/approve`, {
+      api(`/api/approvals/${id}/${decision === 'reject' ? 'reject' : 'approve'}`, {
         method: 'POST',
         body: JSON.stringify({ stepIndex, decision }),
       }),
--- a/packages/foundation/src/runtime.ts
+++ b/packages/foundation/src/runtime.ts
@@
     if (!authorized) return;
-    const effectiveDecision = body.data.decision ?? decision;
+    if (body.data.decision && body.data.decision !== decision) {
+      return reply
+        .code(400)
+        .send({ error: 'The decision does not match the request.' });
+    }
+    const effectiveDecision = decision;
```

### SR-04 (Medium): an expired approval can still be approved

- Status: fixed on the base in `a2ee631` with the same check in SQL (`expires_at <= now() AS expired`). Test: `security-controls.test.ts` > "rejects a decision on an expired approval". The evidence and patch below apply to `a342626`.

- Cause: `decide()` checks `status === 'pending'` but not `expires_at`. Only the worker expires approvals. If the worker is stopped or slow, an old approval stays open.
- Evidence (worker stopped, owner set `expires_at` to yesterday):

```text
POST /api/approvals/3e606192-.../approve {}   (Supervisor)
HTTP 200 {"status":"approved"}
SELECT status, expires_at < now() -> approved | t
```

- Proposed patch:

```diff
--- a/packages/foundation/src/runtime.ts
+++ b/packages/foundation/src/runtime.ts
@@ export interface ApprovalRequestRecord {
   status: string;
+  expires_at: Date;
   summary?: Record<string, unknown>;
 }
@@
         if (!approval || approval.status !== 'pending') {
           throw statusError('This approval is no longer open.', 409);
         }
+        if (new Date(approval.expires_at).getTime() <= Date.now()) {
+          throw statusError('This approval has expired.', 409);
+        }
         if (approval.requester_id === authorized.id) {
```

### SR-05 (Medium): the client sets the request ID, and IDs repeat after a restart

- Cause: `requestIdHeader: 'x-request-id'` (`server.ts` line 92). Fastify trusts the header. Without the header, Fastify uses `req-1`, `req-2`, ... and starts again at each restart.
- The audit trail stores `request.id`. `POST /api/reconciliation/run` uses `reconciliation:${requestId}` as the outbox key (`tools/refunds/src/api.ts` line 424). The outbox ignores a duplicate key.
- Evidence:

```text
POST /api/charges/ch_000006/reveal-email   x-request-id: forged-by-attacker  -> 200
audit_events.request_id = forged-by-attacker

POST /api/reconciliation/run  x-request-id: fixed-recon-id   (Finance, two times) -> 202, 202
outbox rows with key reconciliation:fixed-recon-id = 1
audit 'reconciliation.started' rows with request_id fixed-recon-id = 2

SELECT request_id, count(*) ... HAVING count(*) > 1  -> req-a|5, req-b|4, req-6|4
```

- Effect: a user can forge audit correlation IDs. After a restart, a reconciliation run can be silently dropped while the audit says that it started.
- Proposed patch:

```diff
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@
-import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
+import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
@@
-    requestIdHeader: 'x-request-id',
+    requestIdHeader: false,
+    genReqId: () => randomUUID(),
--- a/tools/refunds/src/api.ts
+++ b/tools/refunds/src/api.ts
@@
-      const idempotencyKey = `reconciliation:${requestId}`;
+      const idempotencyKey = `reconciliation:${randomUUID()}`;
```

- To keep tracing, log an incoming `x-request-id` as a separate `clientRequestId` field.

### SR-06 (Medium): login CSRF in the OIDC callback

- Cause: `/auth/callback` accepts any `state` that is in the in-memory `pendingAuth` map (`server.ts` lines 312-318). The state is not bound to the browser that started the sign-in.
- Attack: the attacker starts `/auth/login`, signs in to Keycloak with the attacker account, and stops before the callback. The attacker sends the callback URL to the victim. The victim's browser gets a session for the attacker account. Work that the victim does next is recorded under the attacker identity.
- Evidence: the test login script completes `/auth/callback` with a new cookie jar. The `/auth/login` response sets no cookie.
- Also: unauthenticated `/auth/login` calls add entries to `pendingAuth` with no upper limit. Entries are removed only on the next login after 5 minutes.
- Proposed patch:

```diff
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@ server.get('/auth/login'
       pendingAuth.set(state, { verifier, nonce, createdAt: Date.now() });
+      if (pendingAuth.size > 10_000) {
+        return reply.code(503).send({ error: 'Sign-in is busy. Try again shortly.' });
+      }
+      reply.setCookie('oidc_state', state, {
+        httpOnly: true,
+        secure: env.NODE_ENV === 'production',
+        sameSite: 'lax',
+        path: '/auth',
+        maxAge: 300,
+      });
@@ server.get('/auth/callback'
     const state = (request.query as { state?: string }).state;
-    const auth = state ? pendingAuth.get(state) : undefined;
+    const boundState = (request as ApiRequest).cookies.oidc_state;
+    reply.clearCookie('oidc_state', { path: '/auth' });
+    const auth =
+      state && boundState && safeEqual(state, boundState)
+        ? pendingAuth.get(state)
+        : undefined;
```

### SR-07 (Medium): session IDs are stored in clear text

- Cause: `foundation.sessions.id` holds the cookie value (`server.ts` line 343). `app_runtime` can read the table. A SQL bug, a backup leak, or a read replica gives live sessions.
- Evidence:

```text
psql as app_runtime: SELECT id FROM foundation.sessions WHERE user_id='finance' LIMIT 1
curl -H "cookie: sid=<that value>" localhost:3000/api/session
{"authenticated":true,"user":{"id":"finance","displayName":"Finley Finance","roles":["finance"]},...}
```

- Proposed patch: store `sha256(sessionId)` and look up by the hash.

```diff
--- a/apps/api/src/server.ts
+++ b/apps/api/src/server.ts
@@
+  const sessionKey = (sessionId: string) =>
+    createHash('sha256').update(sessionId).digest('base64url');
@@ currentUser
-      [sessionId],
+      [sessionKey(sessionId)],
@@ every other query on foundation.sessions (insert, update, delete)
-        [sessionId, userId, displayName, roles],
+        [sessionKey(sessionId), userId, displayName, roles],
```

- Also add `createHash` to the `node:crypto` import, and delete existing sessions when the change ships.

### SR-08 (Medium): default secrets apply when `NODE_ENV` is not `production`

- Cause: `server.ts` lines 118-130 fail only when `NODE_ENV === 'production'`. A staging host with `NODE_ENV=staging` or no `NODE_ENV` uses the public default `SESSION_SECRET` and `WEBHOOK_SECRET` from the source code. An attacker can then sign webhooks (`refund.succeeded`, `refund.failed`) and forge CSRF tokens.
- Proposed patch:

```diff
-  if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
+  const localOnly = env.APP_ENV === 'LOCAL';
+  if (!localOnly && !env.SESSION_SECRET) {
     throw new Error('SESSION_SECRET must be set outside local development.');
   }
   if (
-    env.NODE_ENV === 'production' &&
+    !localOnly &&
     (!env.OIDC_CLIENT_SECRET || !env.WEBHOOK_SECRET)
   ) {
```

### SR-09 (Medium): one rate-limit bucket per proxy IP, and no route limits

- Cause: `rateLimit({ max: 200, timeWindow: '1 minute' })` (`server.ts` line 110) uses `request.ip`. Fastify has no `trustProxy`, so behind the web proxy all users share one bucket. No route has a lower limit. This includes `/auth/login`, `/auth/callback`, `POST /api/charges/:id/reveal-email`, exports, and the webhook.
- Evidence (through `localhost:5173`):

```text
Agent    GET /api/session  x-ratelimit-remaining: 186
(10 more Agent requests)
Finance  GET /api/session  x-ratelimit-remaining: 175
```

- Effect: one user or one script can lock out all users. A user can reveal customer emails at 200 per minute.
- Proposed patch:

```diff
   const server = Fastify({
+    trustProxy: env.TRUSTED_PROXIES ?? 'loopback,uniquelocal',
@@
-  await server.register(rateLimit, { max: 200, timeWindow: '1 minute' });
+  await server.register(rateLimit, {
+    max: 200,
+    timeWindow: '1 minute',
+    keyGenerator: (request) =>
+      (request as ApiRequest).cookies?.[cookieName] ?? request.ip,
+  });
```

- Add `config: { rateLimit: { max: 20, timeWindow: '1 minute' } }` to `/auth/login` and `/auth/callback`. Add a per-user limit for reveal-email and exports in the tool routes.

### SR-10 (Medium): search confirms a customer email for roles without `customer.reveal`

- Cause: `GET /api/charges` matches `q` against `customer_email` for every role with `charge.search` (`tools/refunds/src/api.ts` line 113). The response masks the email, but a match confirms it.
- Evidence (Agent session; Agent has no `customer.reveal`):

```text
GET /api/charges?q=customer1@example.test -> 200 {"items":[{"id":"ch_000001","customer_email":"[REDACTED]",...}, ...]}
GET /api/charges?q=nobody-zz@example.test -> 200 {"items":[],"nextCursor":null}
```

- Proposed patch: match email only for roles with `customer.reveal`, and only on an exact value.

```diff
-      values.push(`%${q}%`);
-      filters.push(
-        `(id ILIKE $${values.length} OR customer_id ILIKE $${values.length} OR customer_email ILIKE $${values.length} OR card_last4 ILIKE $${values.length})`,
-      );
+      values.push(`%${q}%`);
+      const like = `$${values.length}`;
+      const emailFilter = mayReveal(user)
+        ? ` OR customer_email = $${values.push(q.toLowerCase())}`
+        : '';
+      filters.push(
+        `(id ILIKE ${like} OR customer_id ILIKE ${like} OR card_last4 ILIKE ${like}${emailFilter})`,
+      );
```

- `mayReveal` follows `mayExport`, with `customer.reveal`. Product must accept that Agents search by email only through a Supervisor.

### SR-11 (Medium): `app_runtime` can rewrite approval records

- Cause: `apps/api/src/migrate.ts` lines 64-77 grant `SELECT, INSERT, UPDATE, DELETE` on all tables in the application schemas. Only `foundation.audit_events` loses `UPDATE` and `DELETE`.
- Verified: `app_runtime` cannot update, delete, or truncate audit events. It cannot disable the trigger or create tables in `public`. It has no superuser, `CREATEROLE`, `CREATEDB`, or `BYPASSRLS`. Tests cover this.
- Gap: `app_runtime` can `UPDATE` or `DELETE` rows in `foundation.approvals`, `foundation.approval_requests`, `foundation.policy_versions`, and `foundation.tool_settings`. It can also `INSERT` audit events with a valid hash chain, because the chain has no key. A SQL injection bug or a stolen runtime password can therefore forge an approval and its audit trail.
- Proposed patch (append after the existing `REVOKE`):

```diff
     await client.query(
       `REVOKE UPDATE, DELETE, TRUNCATE ON foundation.audit_events FROM ${runtimeRole}`,
     );
+    await client.query(
+      `REVOKE UPDATE, DELETE ON foundation.approvals, foundation.policy_versions FROM ${runtimeRole}`,
+    );
+    await client.query(
+      `REVOKE DELETE ON foundation.approval_requests, foundation.outbox, refunds.refunds, refunds.charges FROM ${runtimeRole}`,
+    );
```

- Only `foundation.sessions` needs `DELETE` today. Also sign audit anchors with a key that the runtime does not hold.

### SR-12 (Medium): the API container holds the owner DB URL

- Cause: `docker-compose.yml` line 78 gives the API `MIGRATION_DATABASE_URL` with the `tools` owner password. The API runs migrations and seed at start. Code execution in the API therefore gives owner rights. This removes the value of the `app_runtime` limits and of the audit trigger.
- Proposed patch: add a one-shot `migrate` service with the owner URL. Remove `MIGRATION_DATABASE_URL` and `POSTGRES_PASSWORD` from `api`. Make `api` and `worker` depend on `migrate: { condition: service_completed_successfully }`.

### SR-13 (Medium): the web UI has no frame protection

- Evidence: `curl -D - localhost:5173/` returns no `Content-Security-Policy` and no `X-Frame-Options`. The API sets `frame-ancestors 'none'`, but the browser loads the UI from the Vite server.
- Effect: another site can frame the console and trick a Supervisor into a click on Approve (clickjacking).
- Proposed patch:

```diff
--- a/apps/web/vite.config.ts
+++ b/apps/web/vite.config.ts
   server: {
+    headers: {
+      'Content-Security-Policy': "frame-ancestors 'none'",
+      'X-Frame-Options': 'DENY',
+      'X-Content-Type-Options': 'nosniff',
+      'Referrer-Policy': 'no-referrer',
+    },
     proxy: {
```

- The production web host must send the same headers and a full CSP.

### SR-14 (Low): validation runs before authorization

- Cause: `runRegisteredRoute` parses params, query, and body (`runtime.ts` lines 303-315) before `authorize` (line 317). A user without the permission gets field-level schema details, and the attempt is not audited as `permission.denied`.
- Evidence (Auditor, no `refund.request`):

```text
POST /api/refunds {"chargeId":"x"} -> 400 {"error":"Request validation failed.","details":[{"path":["amountMinor"],...}]}
POST /api/refunds (valid body)     -> 403 {"error":"You do not have permission to perform this action."}
```

- Proposed patch: move the `authorize` block above the schema block.

```diff
--- a/packages/foundation/src/runtime.ts
+++ b/packages/foundation/src/runtime.ts
@@ runRegisteredRoute
-  const params = normalizedSchema(route.params, request.params);
-  const query = normalizedSchema(route.query, request.query);
-  const body = normalizedSchema(route.body, request.body);
-  if (!params.success || !query.success || !body.success) {
-    return reply.code(400).send({ ... });
-  }
-
   if (!authorize(user, route.permission, registration.tool)) {
     ... (unchanged)
   }
+
+  const params = normalizedSchema(route.params, request.params);
+  const query = normalizedSchema(route.query, request.query);
+  const body = normalizedSchema(route.body, request.body);
+  if (!params.success || !query.success || !body.success) {
+    return reply.code(400).send({ ... (unchanged) });
+  }
```

### SR-15 (Low): approval lookup runs before authorization; a bad ID returns 500

- Cause: `decide()` loads the approval and returns 409 before it checks the permission. An `id` that is not a UUID makes Postgres throw.
- Evidence (Agent, no `refund.approve`):

```text
POST /api/approvals/not-a-uuid/approve {}                            -> 500
POST /api/approvals/00000000-0000-4000-8000-000000000000/approve {}  -> 409 "This approval is no longer open."
```

- Proposed patch:

```diff
     const approvalId = (request.params as { id: string }).id;
+    if (!z.string().uuid().safeParse(approvalId).success) {
+      return reply.code(404).send({ error: 'Approval not found.' });
+    }
```

- Also return the same 404 when the row is missing or the tool is not registered.

### SR-16 (Low): hard-coded role bypass in `authorize`

- Cause: `packages/foundation/src/registry.ts` lines 68-71 give `platform_admin` `execution.pause` and give `auditor` every `audit.*` permission in every tool. The tool matrix cannot remove them, and reviewers do not see them in the matrix.
- Refunds already lists both grants in its matrix, so the patch does not change Refunds behavior.

```diff
--- a/packages/foundation/src/registry.ts
+++ b/packages/foundation/src/registry.ts
   if (!user) return false;
-  if (user.roles.includes('platform_admin') && permission === 'execution.pause')
-    return true;
-  if (user.roles.includes('auditor') && permission.startsWith('audit.'))
-    return true;
   const allowed = tool.permissions[permission] ?? [];
```

- Related: role names are global strings. A role `supervisor` in a second tool maps to the same session role. Prefix roles with the tool ID when a second tool ships.

### SR-17 (Low): the approval summary can overwrite list fields

- Cause: `GET /api/approvals` spreads `summary` after `approval_id` and `requester_id` (`runtime.ts` line 507). A tool that puts user text in `summary.requester_id` changes the name that approvers see. Refunds does not do this today.

```diff
       items: items.map((row) => ({
+        ...((row.summary ?? {}) as Record<string, unknown>),
         approval_id: row.id,
@@
         requester_id: row.requester_id,
-        ...((row.summary ?? {}) as Record<string, unknown>),
       })),
```

### SR-18 (Low): the idempotency key has no length limit and no expiry

- Evidence: an Agent sent an 8,000-character `Idempotency-Key`. The API stored it (`SELECT max(length(key))` = 8000). Rows never expire.

```diff
-          if (typeof key !== 'string' || !key.trim()) {
-            throw statusError('An Idempotency-Key header is required.', 400);
-          }
+          if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
+            throw statusError(
+              'Send an Idempotency-Key header with 8 to 128 letters, digits, or ._:- characters.',
+              400,
+            );
+          }
```

- Also delete completed rows older than 7 days in a worker job.

### SR-19 (Low): the audit trail records the proxy IP

- Evidence: `SELECT DISTINCT source_ip FROM foundation.audit_events` returns only `172.18.0.1` and `172.18.0.8` (Docker gateway and web proxy).
- Fix: the `trustProxy` change in SR-09.

### SR-20 (Low): the audit CSV export writes `[object Object]`

- Status: fixed on the base in `a2ee631`. `csvCell` now writes objects as JSON. The evidence below applies to `a342626`.

- Evidence (Auditor): `GET /api/audit?format=csv` returns `"27","[object Object]","3027..."`. The export does not contain the event data, so the export cannot support an investigation.

```diff
-        ...result.rows.map((row) => columns.map((key) => row[key])),
+        ...result.rows.map((row) =>
+          columns.map((key) =>
+            key === 'event_data' ? JSON.stringify(row[key]) : row[key],
+          ),
+        ),
```

### SR-21 (Low): a signed webhook with bad JSON returns 500

- Evidence: a correctly signed body `{bad` or `{"x":1}` returns HTTP 500. The provider retries a 500, so a bad event loops.
- Fix: the validation part of the SR-01 patch returns 400.

### SR-22 (Low): an ID that is not a UUID returns 500

- Evidence: `GET /api/refunds/not-a-uuid` (Agent) and `POST /api/exceptions/not-a-uuid/resolve` (Finance) return HTTP 500. The error log grows with each call.

```diff
-const IdParams = z.object({ id: z.string().min(1).max(128) });
+const IdParams = z.object({ id: z.string().uuid() });
+const ChargeIdParams = z.object({ id: z.string().min(1).max(64) });
```

- Use `ChargeIdParams` on the two `/api/charges/:id` routes.

### SR-23 (Low): export denials are not audited, and exports use GET

- Evidence: `GET /api/refunds?format=csv` as Agent returns 403. The audit trail gets no `permission.denied` event, because the route checks `refund.export` inside the handler.
- Exports use GET, so CSRF tokens do not apply. A link on another site starts an audited export in the user's browser. The file goes to the user, not to the attacker, so the effect is a false audit entry.
- Recommendation: move CSV export to its own route with `permission: 'refund.export'`.

### SR-24 (Low): refund detail returns all columns

- `GET /api/refunds/:id` uses `SELECT r.*` and returns the full audit timeline. The base now limits Agents to their own refunds (`refund.read_all`). Test: "hides refunds of other requesters from an Agent". A new column (for example a provider payload) would leak with no review. List the columns.

### SR-25 (Low): unauthenticated `/api/registry` and `/metrics`

- `/api/registry` returns the full permission matrix. `/metrics` returns pending approvals, outbox depth, open exceptions, and the pause state. Both help an attacker plan. Require a session for `/api/registry`. Serve `/metrics` only on the internal network.

### SR-26 (Low): user ID from `preferred_username`, and roles stay for 8 hours

- `userId = claims.preferred_username ?? claims.sub` (`server.ts` line 339). If a username changes or is reused, approvals and self-approval checks follow the new owner. Use `sub` as the ID and keep the username for display.
- Roles are copied into the session at sign-in. A removed role stays active for up to 8 hours. Logout does not end the Keycloak session.

### SR-27 (Low): the payment simulator refund list has no authentication

- `GET localhost:4000/v1/refunds` returns all provider refunds with no token. The port is open on the host. This is a local simulator, but do not expose port 4000 outside the developer machine.

## Controls that passed

| Area                  | Result                                                                                                                                                       | Evidence                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Route authorization   | Every route allows only the matrix roles. Anonymous calls get 401. Denials are audited.                                                                      | `permission-matrix.test.ts`                                          |
| Route declaration     | `registerTool` throws for a missing or undeclared permission. `defineRoute` throws for an empty permission.                                                  | `security-controls.test.ts`                                          |
| Dual role             | `agent-supervisor` cannot approve or reject its own request, with or without `stepIndex` or `decision`. Each attempt writes `approval.self_approval_denied`. | Live: `403 "You cannot approve a request that you submitted."`; test |
| Approval steps        | Finance cannot act before the Supervisor step. A Supervisor cannot take the Finance step.                                                                    | Test                                                                 |
| CSRF                  | Missing header, missing cookie, mismatch, forged signature, other secret, and other session token all get 403. No side effect occurs.                        | Test                                                                 |
| Webhook               | Missing, malformed, wrong-secret, and tampered signatures get 401. Timestamps more than 300 s old or ahead get 401. A replay is stored once.                 | Test                                                                 |
| Idempotency           | The key is bound to the actor, route, and body hash. A changed body gets 422. Another user cannot replay a response.                                         | Test                                                                 |
| Mass assignment       | Zod strips `requester_id`, `status`, `tier`, and `approvalSteps`.                                                                                            | Test                                                                 |
| SQL injection         | `q` and `cursor` values are bound parameters.                                                                                                                | Live and test                                                        |
| Masking and logs      | Search and detail mask email. Logs redact `req.url` and the note. No email in API logs (`grep -c example.test` = 0).                                         | Live and test                                                        |
| Cookies and OIDC      | Session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` and `__Host-` in production. Code flow uses PKCE, nonce, and single-use state.                        | Code review                                                          |
| API headers           | CSP with `frame-ancestors 'none'`, HSTS, `nosniff`, `X-Frame-Options`, Referrer-Policy.                                                                      | Live response headers                                                |
| Audit immutability    | `app_runtime` cannot update, delete, truncate, or disable the trigger on `foundation.audit_events`.                                                          | Test                                                                 |
| CSV formula injection | Refund CSV prefixes `=`, `+`, `-`, and `@` with `'`.                                                                                                         | Code review                                                          |
