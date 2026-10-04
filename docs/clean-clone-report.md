# Clean-clone review of README.md

This report is the step log of a clean-machine review. The reviewer followed only the old `README.md` on branch `devin/1791105966-foundation-refunds`. The reviewer did not use knowledge of the code to work around a failed step during the first pass. After the first pass, the reviewer fixed the README and four small setup defects. Then the reviewer ran the stack again from empty volumes.

## Machine

| Item               | Value                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Date               | 2026-10-04 (UTC)                                                      |
| OS                 | Ubuntu (x86_64), 2 vCPUs, 7.7 GiB RAM                                 |
| Docker             | Engine 29.7.2, Compose v5.4.0                                         |
| Node.js            | Not installed at the start. Installed v22.23.3 (npm 10.9.9) with nvm. |
| Docker image cache | Empty at the start of the first build                                 |
| Base commit        | `a342626` on `devin/1791105966-foundation-refunds`                    |

## Pass 1: follow the old README only

Times are wall-clock times. "Result" shows the exact error text for each failure.

| #   | Step (from the old README)                                             | Command                                                                                                                                   | Time                          | Result                                                                                                                                                        |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Clone                                                                  | `git clone https://github.com/sunajeb/internal-tools-devin.git`                                                                           | 1 s                           | Pass                                                                                                                                                          |
| 2   | Check out the branch                                                   | `git checkout devin/1791105966-foundation-refunds`                                                                                        | < 1 s                         | Pass                                                                                                                                                          |
| 3   | Node.js 22                                                             | `node --version`                                                                                                                          | < 1 s                         | **Fail:** `bash: line 1: node: command not found`. The README says "Node.js 22" but gives no install step.                                                    |
| 3a  | Install Node 22 (prerequisite, outside the README)                     | `nvm install 22`                                                                                                                          | 6 s                           | Pass: `Now using node v22.23.3 (npm v10.9.9)`                                                                                                                 |
| 4   | Start the stack (first build, empty image cache)                       | `docker compose up -d --build --wait`                                                                                                     | **147.8 s**                   | Pass. All containers report `Healthy`. Log: images pulled, four Node images built, then `--wait` completed.                                                   |
| 5   | Open the console                                                       | `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173`                                                                            | < 1 s                         | Pass: `200`                                                                                                                                                   |
| 6   | Health checks (not in the old README; ports from `docker-compose.yml`) | `curl` to `:3000/health/ready`, `:4000/health`, `:8080/realms/internal-tools/.well-known/openid-configuration`, `:9090/-/ready`, `:16686` | < 1 s each                    | Pass: all return `200`. `curl :3000/health` returns `404` (the route is `/health/live`).                                                                      |
| 7   | Install dependencies                                                   | `npm install`                                                                                                                             | 10 s                          | Pass: `added 404 packages, and audited 413 packages in 10s`. Warnings: 3 deprecated packages, `4 moderate severity vulnerabilities`.                          |
| 8   | Lint                                                                   | `npm run lint`                                                                                                                            | not logged (18.0 s in pass 2) | Pass                                                                                                                                                          |
| 9   | Type check                                                             | `npm run typecheck`                                                                                                                       | not logged (18.9 s in pass 2) | Pass                                                                                                                                                          |
| 10  | Unit tests                                                             | `npm test`                                                                                                                                | 2 s                           | Pass: `Test Files 2 passed (2)`, `Tests 10 passed (10)`                                                                                                       |
| 11  | Migrate                                                                | `npm run db:migrate`                                                                                                                      | 1 s                           | **Fail** (see [Failure F1](#f1-dbmigrate-and-dbseed-fail-against-the-compose-database))                                                                       |
| 12  | Seed                                                                   | `npm run db:seed`                                                                                                                         | 1 s                           | **Fail** (same cause as F1)                                                                                                                                   |
| 13  | Install the browser                                                    | `npx playwright install chromium`                                                                                                         | 15 s                          | Pass: `Chrome Headless Shell 153.0.8010.12 (playwright chromium-headless-shell v1243) downloaded`                                                             |
| 14  | End-to-end test                                                        | `npm run e2e`                                                                                                                             | 16 s                          | Pass: `1 passed (15.4s)`. Screenshots go to `/home/ubuntu/briefs/screens` (see F3).                                                                           |
| 15  | Generator                                                              | `npm run new-tool -- case-review`                                                                                                         | 1 s                           | Pass: `Created tools/case-review. Run npm install, then add the case-review-operator group to infra/keycloak.` The reviewer then removed the generated files. |
| 16  | Generator check (not in the old README)                                | `bash scripts/check-new-tool.sh`                                                                                                          | 40 s                          | Pass: `The generated tool compiles, passes its tests and passes lint.`                                                                                        |
| 17  | Format check (task requirement, not in the old README)                 | `npm run format:check`                                                                                                                    | 8 s                           | Pass: `All matched files use Prettier code style!`                                                                                                            |
| 18  | Reset and warm start                                                   | `docker compose down -v` then `docker compose up -d --build --wait`                                                                       | 13 s + 103 s                  | Pass                                                                                                                                                          |

### Browser demos in pass 1

The old README had one demo: request a refund as `agent`, approve it as `supervisor`, open the timeline, and verify the audit chain as `auditor`. The reviewer ran it with Playwright against `http://localhost:5173` and signed in through the Keycloak login form.

| Step                                                 | Time                     | Result                                                                       |
| ---------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| Sign in as `agent`, search `ch_000001`, request $320 | 9 s                      | Pass. Approval preview shows **Supervisor Approval**.                        |
| Click **Sign out**, sign in as `supervisor`          | 16.6 s                   | **Fail** (see [Failure F2](#f2-sign-out-does-not-end-the-keycloak-session)). |
| Same step after a Keycloak logout (workaround)       | 38.3 s for the full demo | Pass. Approve, timeline, and audit verify all pass.                          |

The old README did not describe the other required demos. The reviewer ran them after the README fix. Refer to [Pass 2](#pass-2-the-new-readme-on-empty-volumes).

## Failures and defects

### F1: `db:migrate` and `db:seed` fail against the Compose database

```text
> internal-tools-foundation@0.1.0 db:migrate
> tsx apps/api/src/migrate.ts

/home/ubuntu/review/internal-tools-devin/node_modules/pg-pool/index.js:45
    Error.captureStackTrace(err)
          ^

error: password authentication failed for user "tools"
    at /home/ubuntu/review/internal-tools-devin/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async <anonymous> (/home/ubuntu/review/internal-tools-devin/apps/api/src/migrate.ts:40:3) {
  severity: 'FATAL',
  code: '28P01',
  file: 'auth.c',
  line: '323',
  routine: 'auth_failed'
}

Node.js v22.23.3
```

`npm run db:seed` gave the same error at `apps/api/src/seed.ts:13:1`.

- Cause: the scripts default to `postgres://tools:tools@localhost:5432/internal_tools`. Compose creates the `tools` user with the password `local-development-only` (`.env.example` and `docker-compose.yml`).
- Fix (trivial setup defect): the default in `apps/api/src/migrate.ts` and `apps/api/src/seed.ts` now uses `local-development-only`. The README tells the user that the API applies migrations and seed data at start-up, and that `MIGRATION_DATABASE_URL` overrides the default.

### F2: Sign out does not end the Keycloak session

After **Sign out**, **Continue with company SSO** signed the browser in as the previous user (`agent`). Keycloak did not show the login form. The `supervisor` sign-in was not possible. Log from the demo script:

```text
WARN: Keycloak did not show login form for supervisor
TimeoutError: locator.click: Timeout 15000ms exceeded.
  - waiting for getByRole('link', { name: 'Approvals' })
```

- Cause: the console logout clears the API session only. It does not call the Keycloak end-session endpoint.
- Fix: README only. A new section "Change the user" tells the user to open the Keycloak logout URL, or to use a private window. The reviewer did not change `apps/api/src/server.ts` (protected file). Refer to "Foundation observations".

### F3: The end-to-end test writes screenshots to a fixed host path

`e2e/specs/refunds.spec.ts` used `/home/ubuntu/briefs/screens` when `SCREENSHOT_DIR` was not set. On a machine without the user `ubuntu`, `mkdir` can fail with a permission error.

- Fix (trivial setup defect): the default is now `test-results/screens` in the repository. Git ignores `test-results/`.

### F4: Seeded approvals show `$NaN` and no payment

The approval inbox showed the 6 seeded requests as **$NaN refund request** with an empty payment ID. The requests from the console showed correct values.

- Cause: `apps/api/src/seed.ts` inserted `foundation.approval_requests` rows without the `summary` column. The UI reads the amount and payment from `summary`. `tools/refunds/src/api.ts` writes `summary` for new requests.
- Fix (trivial seed defect): the seed now writes the same `summary` keys as `tools/refunds/src/api.ts`.

### F5: No `.nvmrc`

The task says `nvm use 22`. Without `.nvmrc`, `nvm use` with no version fails. Fix: add `.nvmrc` with `22`.

### F6: Jaeger has no traces

`http://localhost:16686` opens, but the **Service** list is empty. A search of `apps`, `packages`, `services`, and `tools` found no OpenTelemetry or Jaeger exporter. The old architecture diagram showed `Worker -. trace target .-> Jaeger`.

- Fix: README only. The README now says that Jaeger runs but that no service sends traces. The "Jaeger trace" demo shows this result.

### F7: Old README gaps

The old README had no install step for Node.js, no port list, no health checks, no change-user procedure, only one demo, no troubleshooting, no Terraform reference, and no status table. The new README adds each of these.

## Pass 2: the new README on empty volumes

The reviewer applied the fixes. Then the reviewer deleted all volumes and followed the new README from the start. The Docker image cache was warm.

| #   | Step (from the new README)               | Command                                                               | Time       | Result                                                                                                                       |
| --- | ---------------------------------------- | --------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Delete volumes                           | `docker compose down -v`                                              | 12.8 s     | Pass                                                                                                                         |
| 2   | Start the stack                          | `docker compose up -d --build --wait`                                 | 108.0 s    | Pass. `postgres`, `keycloak`, `payment-simulator`, and `api` are `healthy`. The other four services are `Up`.                |
| 3   | Health checks                            | the `curl` commands in "Health checks"                                | < 1 s each | Pass: `{"status":"ok"}`, `{"status":"ready"}`, `{"status":"ok"}`, Keycloak `200`, `Prometheus Server is Ready.`              |
| 4   | Metrics                                  | `curl -s http://localhost:3000/metrics`                               | < 1 s      | Pass: `approvals_pending 6`, `outbox_depth 0`, `reconciliation_exceptions_open 1`, `execution_paused 0`                      |
| 5   | Seeded approvals have a summary (F4 fix) | `psql ... SELECT summary->>'charge_id', summary->>'amount_minor' ...` | < 1 s      | Pass: `ch_000101 32000`, `ch_000505 32000`, `ch_000909 32000`                                                                |
| 6   | Migrate from the host (F1 fix)           | `npm run db:migrate`                                                  | 5.0 s      | Pass: `Applied 1 migration files.`                                                                                           |
| 7   | Seed from the host (F1 fix)              | `npm run db:seed`                                                     | 2.3 s      | Pass: `Seeded 100,000 synthetic charges, tool seed files and demo records.` Refund count stays 24. Pending approvals stay 6. |
| 8   | Lint                                     | `npm run lint`                                                        | 18.0 s     | Pass                                                                                                                         |
| 9   | Format check                             | `npm run format:check`                                                | 8.3 s      | Pass after `prettier --write` on this report                                                                                 |
| 10  | Type check                               | `npm run typecheck`                                                   | 18.9 s     | Pass                                                                                                                         |
| 11  | Unit tests                               | `npm test`                                                            | 5.5 s      | Pass: 10 tests                                                                                                               |
| 12  | End-to-end test                          | `npx playwright test -c e2e/playwright.config.ts`                     | 9.0 s      | Pass: `1 passed (8.3s)`. Screenshots in `test-results/screens/` (F3 fix).                                                    |

### Browser demos in pass 2

The reviewer drove a Chromium browser with Playwright. Each user signed in through the Keycloak login form. Between users, the script used the "Change the user" steps from the new README.

| Demo                                 | Users                                                | Time  | Result                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 and 2. Refund request and approval | `agent`, `supervisor`                                | 13 s  | Pass. Tier **Supervisor Approval**. Refund **Succeeded**. Timeline has 4 events.                                                                                                                                                                                |
| 3. Self-approval block               | `agent-supervisor`                                   | 2.5 s | Pass. **Requesters cannot approve their own refund.** Buttons disabled. API: HTTP 403 `You cannot approve a request that you submitted.`                                                                                                                        |
| 4. Dual approval                     | `agent`, `supervisor`, `agent-supervisor`, `finance` | 19 s  | Pass. Agent sees **Only a Supervisor can request a refund above $5,000.** Supervisor request shows **Supervisor + Finance Approval**. After both steps, the refund is **Succeeded**.                                                                            |
| 5. Kill switch                       | `platform-admin`, `agent`, `supervisor`              | 25 s  | Pass. The refund stays **Approved** while paused. It is **Succeeded** after **Resume execution**.                                                                                                                                                               |
| 6. Reconciliation                    | `finance`                                            | 13 s  | Pass. Seeded `provider-ghost-demo` exception, plus a new **Missing Internal** exception for `ch_000006` after the `ghost-refund` call.                                                                                                                          |
| 7. Masked reveal                     | `agent`, `supervisor`                                | 5 s   | Pass. Agent sees `[REDACTED]` and no button. Supervisor clicks **Reveal** and sees `customer5@example.test`.                                                                                                                                                    |
| 8a. Audit verify                     | `auditor`                                            | 4 s   | Pass. **Audit chain verified**.                                                                                                                                                                                                                                 |
| 8b. Audit tamper                     | `auditor` and `psql`                                 | 2 s   | Pass. Runtime role: `ERROR: permission denied for table audit_events`. Owner: `ERROR: audit_events is append-only`. After the trigger bypass in the README: **Audit chain integrity check failed**, `First broken event: 38ebfdbc-e1dd-4201-8951-fd00e9b76fb7`. |
| 9. Jaeger                            | none                                                 | 4 s   | Result as documented: the UI opens. The **Service** list is empty. No traces (F6).                                                                                                                                                                              |
| 10. Prometheus                       | none                                                 | 5 s   | Pass. Target `internal-tools-api` is **UP**. `approvals_pending{instance="api:3000",job="internal-tools-api",tool="refunds"}` returns the pending count.                                                                                                        |

After the tamper demo, the reviewer reset the stack (`docker compose down -v` and `up -d --build --wait`, 76 s). Then the reviewer ran demos 1 and 2 again (30 s, pass) and the end-to-end test again (7.4 s, `1 passed (6.6s)`).

Note: one pass-2 run of demos 1 and 2 failed because an earlier failed run (F2 reproduction) left a second pending `$320` request for `ch_000001`. The script approved the older request. This is a test-data effect, not a product defect. The README troubleshooting table tells the user to reset with `docker compose down -v`.

## Foundation observations

The reviewer did not change `packages/foundation/**`, `apps/api/src/server.ts`, `apps/web/src/App.tsx`, or `packages/ui-kit/**`.

- **No Foundation bug found in the approval, audit, or permission controls.** Self-approval returns HTTP 403 `You cannot approve a request that you submitted.` The runtime role gets `permission denied for table audit_events`. The owner gets `audit_events is append-only`. After a deliberate owner-level trigger bypass, **Verify chain** reports **Audit chain integrity check failed** and the first broken event.
- **Logout (in `apps/api/src/server.ts`, protected):** the logout route ends only the API session. It does not redirect to the Keycloak end-session endpoint. A shared workstation keeps the Keycloak session, so the next person can sign in as the previous user without a password. This is a local-prototype issue, but production must use RP-initiated logout. The reviewer documented the workaround and did not patch it.
- **Tracing:** the Foundation has no OpenTelemetry instrumentation. Jaeger is infrastructure only.
- **UI text size (in the refunds tool, not the Foundation):** on the approval card, the self-approval message and the **All roles** step label render larger than the other card text. This is cosmetic.
