# Internal Tools Foundation and Refunds Console

## What it is

This repository is a local prototype for fintech internal tools. It has two parts:

- **The Foundation** (`packages/foundation`). It gives each tool sign-in, permission checks, CSRF checks, input validation, approvals, an audit hash chain, data masking, idempotency, and an outbox.
- **The Refunds Console** (`tools/refunds`). It is the reference tool. Agents request refunds. Supervisors and Finance approve them. A worker sends approved refunds to a payment provider.

All data is synthetic. The prototype is not ready for production use.

## Architecture

```mermaid
flowchart LR
  Browser[React console :5173] -->|Session cookie and API calls| API[Fastify API :3000]
  Browser -->|OIDC sign-in| Keycloak[Local Keycloak :8080]
  API -->|OIDC code exchange| Keycloak
  API -->|Role app_runtime| DB[(PostgreSQL 16 :5432)]
  API -->|Business change, audit event and outbox row in one transaction| DB
  Worker[Worker] -->|Polls outbox| DB
  Worker -->|Idempotent refund call| Simulator[Payment simulator :4000]
  Simulator -->|Signed webhook| API
  Worker -->|Reconciler| Simulator
  Prometheus[Prometheus :9090] -->|Scrapes /metrics| API
  Jaeger[Jaeger UI :16686]
```

- The API checks the session, CSRF token, input, and permission before a route handler runs.
- The API rejects a route that has no permission, or a permission that the tool matrix does not declare.
- The API connects as the database role `app_runtime`. This role cannot update or delete audit events.
- A database trigger also blocks `UPDATE` and `DELETE` on `foundation.audit_events`.
- PostgreSQL locks the payment row before it reserves a refund amount.
- The worker uses the refund ID as the provider idempotency key.
- Jaeger runs, but no service sends traces to it. Refer to [What is simulated](#what-is-simulated).

## Prerequisites

| Item           | Version                                               | Notes                                                                       |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Docker Engine  | Tested with 29.7.2                                    | Must run Linux containers.                                                  |
| Docker Compose | Tested with v5.4.0                                    | Must support `docker compose up --wait`.                                    |
| Node.js        | 22 (tested with 22.23.3)                              | Only for tests and development commands. The file `.nvmrc` selects Node 22. |
| npm            | 10 (comes with Node 22)                               |                                                                             |
| Git            | Any current version                                   |                                                                             |
| Browser        | A current Chrome, Edge, or Firefox                    |                                                                             |
| Free ports     | 3000, 4000, 4317, 4318, 5173, 5432, 8080, 9090, 16686 | Stop other services that use these ports.                                   |
| Machine        | 2 CPUs, 8 GB RAM, 4 GB free disk                      | The Docker images use approximately 2.7 GB.                                 |

To install Node 22 with nvm:

```sh
nvm install 22
nvm use 22
```

## Quick start

1. Clone the repository:

   ```sh
   git clone https://github.com/sunajeb/internal-tools-devin.git
   cd internal-tools-devin
   ```

2. Start the stack. You do not need a `.env` file. Compose has a local default for each value:

   ```sh
   docker compose up -d --build --wait
   ```

   The first build takes approximately 2 to 3 minutes on a 2-CPU machine. The command stops when all services are healthy.

3. Open http://localhost:5173.
4. Click **Continue with company SSO**. Sign in with one of the [seeded logins](#seeded-logins).

At start-up the API applies the SQL migrations and loads the seed data. The seed data has 100,000 synthetic payments, 24 demo refunds, 6 pending approvals, and 1 reconciliation exception.

To change a local value, copy `.env.example` to `.env` and edit it before you start the stack.

To stop the stack, run `docker compose down`. To delete all data and start again, run `docker compose down -v`.

## URLs and ports

| Service           | URL                    | Notes                                                                                                                     |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Web console       | http://localhost:5173  | React and Vite.                                                                                                           |
| API               | http://localhost:3000  | Fastify. The web console calls the API through a Vite proxy.                                                              |
| Keycloak          | http://localhost:8080  | Realm `internal-tools`. Admin console login: `admin` / `local-keycloak-admin`.                                            |
| Payment simulator | http://localhost:4000  | Admin API token: `local-simulator-admin`.                                                                                 |
| PostgreSQL        | `localhost:5432`       | Database `internal_tools`. Owner: `tools` / `local-development-only`. Runtime role: `app_runtime` / `local-runtime-only`. |
| Prometheus        | http://localhost:9090  | Scrapes `api:3000/metrics` every 15 seconds.                                                                              |
| Jaeger UI         | http://localhost:16686 | OTLP ports 4317 (gRPC) and 4318 (HTTP).                                                                                   |

All passwords and tokens in this table are for local use only.

## Health checks

```sh
docker compose ps
curl -s http://localhost:3000/health/live
curl -s http://localhost:3000/health/ready
curl -s http://localhost:4000/health
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/realms/internal-tools/.well-known/openid-configuration
curl -s http://localhost:9090/-/ready
curl -s http://localhost:3000/metrics
```

Expected results:

- `docker compose ps` shows `postgres`, `keycloak`, `payment-simulator`, and `api` as `healthy`. It shows `worker`, `web`, `prometheus`, and `jaeger` as `Up`. These four services have no health check.
- `/health/live` returns `{"status":"ok"}`.
- `/health/ready` returns `{"status":"ready"}`. It returns HTTP 503 when the database is not available.
- The simulator returns `{"status":"ok"}`.
- Keycloak returns `200`.
- Prometheus returns `Prometheus Server is Ready.`
- `/metrics` returns the gauges `approvals_pending`, `outbox_depth`, `reconciliation_exceptions_open`, and `execution_paused`.

## Seeded logins

| Username           | Password                | Roles                | Main permissions                                                                  |
| ------------------ | ----------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `agent`            | `LocalAgent123!`        | Agent                | Search payments. Request refunds up to $5,000.                                    |
| `supervisor`       | `LocalSupervisor123!`   | Supervisor           | Request any refund. Approve the Supervisor step. Reveal customer email.           |
| `finance`          | `LocalFinance123!`      | Finance              | Approve the Finance step. Run reconciliation. Resolve exceptions. Export CSV.     |
| `auditor`          | `LocalAuditor123!`      | Auditor              | Read refunds and audit events. Verify the audit chain. Export CSV.                |
| `platform-admin`   | `LocalPlatform123!`     | Platform Admin       | Pause and resume refund execution. Read audit events.                             |
| `agent-supervisor` | `LocalDualRole123!`     | Agent and Supervisor | Use this account to see the self-approval block and to approve a Supervisor step. |
| `flag-editor`      | `LocalFlagEditor123!`   | Flag Editor          | Change development and staging flags. Request production flag changes.            |
| `flag-approver`    | `LocalFlagApprover123!` | Flag Approver        | Approve or reject production flag changes.                                        |

These accounts are for local development only. Do not use these passwords in other systems.

### Change the user

**Sign out** ends the console session only. Keycloak keeps its own sign-in session. If you click **Continue with company SSO** again, Keycloak signs you in as the same user. It does not show the login form.

To sign in as a different user, do one of these steps:

- After you click **Sign out**, open http://localhost:8080/realms/internal-tools/protocol/openid-connect/logout and click **Logout**. Then go back to http://localhost:5173.
- Use a different browser profile or a private window for each user.

## Refund approval rules

| Refund amount                | Approval tier | Who can request   | Approvals                                                   |
| ---------------------------- | ------------- | ----------------- | ----------------------------------------------------------- |
| $250 or less                 | Auto          | Agent, Supervisor | None. Each agent has a daily auto-approval limit of $2,000. |
| More than $250, up to $5,000 | Supervisor    | Agent, Supervisor | 1 Supervisor.                                               |
| More than $5,000             | Dual          | Supervisor only   | 1 Supervisor, then 1 Finance.                               |

A requester cannot approve their own request. One person cannot approve two steps of the same request.

## Demo scripts

Start each demo from http://localhost:5173. Use the [change the user](#change-the-user) steps between users. The demos work in this order on a new stack.

### 1. Refund request

1. Sign in as `agent`.
2. Click **Payments**. Type `ch_000001` in the search box.
3. Click the payment row. The payment detail shows the customer email as `[REDACTED]`.
4. Click **Request refund**.
5. Type `320` in **Refund amount**. Type a note with at least 10 characters in **Internal note**.
6. Make sure that the approval preview shows **Supervisor Approval**.
7. Click **Submit request**.

Result: the refund has the status **Pending Approval**.

### 2. Approval

1. Sign in as `supervisor`.
2. Click **Approvals**. Find the $320.00 request for `ch_000001`.
3. Click **Approve as supervisor**.
4. The page shows **Approval recorded. The request has been updated.**
5. Click **Refunds**. In approximately 5 seconds the `ch_000001` refund changes to **Succeeded**. Later, the reconciler changes it to **Reconciled**.
6. Click the refund row. The timeline shows **Refund Requested**, **Refund Approval Recorded**, **Refund Execution Started**, and **Refund Execution Completed**.

### 3. Self-approval block

1. Sign in as `agent-supervisor`.
2. Request a $300 refund for `ch_000003`. Use the steps in demo 1.
3. Click **Approvals**. Find the request for `ch_000003`.

Result: the page shows **Requesters cannot approve their own refund.** The **Approve as supervisor** and **Decline** buttons are disabled. The server also blocks the action. A direct call to `POST /api/approvals/<id>/approve` returns HTTP 403 with `You cannot approve a request that you submitted.`

### 4. Dual approval

1. Sign in as `agent`. Try to request a $6,000 refund for `ch_000002`. Click **Submit request**. The form shows **Only a Supervisor can request a refund above $5,000.** Click **Cancel**.
2. Sign in as `supervisor`. Request a $6,000 refund for `ch_000002`. The approval preview shows **Supervisor + Finance Approval**. Submit the request.
3. Sign in as `agent-supervisor`. Click **Approvals**. Click **Approve as supervisor** on the $6,000.00 request.
4. Sign in as `finance`. Click **Approvals**. Click **Approve as finance** on the same request.
5. Click **Refunds**. The `ch_000002` refund changes to **Succeeded**.

### 5. Kill switch

1. Sign in as `platform-admin`. On **Overview**, click **Pause execution**. The banner **Refund execution is paused** appears.
2. Sign in as `agent`. Request a $400 refund for `ch_000004`.
3. Sign in as `supervisor`. Approve the request.
4. Click **Refunds**. The `ch_000004` refund stays **Approved**. The worker does not send it to the provider.
5. Sign in as `platform-admin`. Click **Resume execution**.
6. In approximately 5 seconds, the `ch_000004` refund changes to **Succeeded**.

The audit log records `execution paused` and `execution resumed`. The metric `execution_paused` is `1` while execution is paused.

### 6. Reconciliation

1. Sign in as `finance`. Click **Reconciliation**. The seeded exception **Missing Internal** with key `provider-ghost-demo` is open.
2. Create a refund that exists only at the provider:

   ```sh
   SIM_ADMIN_TOKEN=local-simulator-admin
   curl -s -X POST http://localhost:4000/admin/ghost-refund \
     -H 'content-type: application/json' \
     -H "x-admin-token: $SIM_ADMIN_TOKEN" \
     -d '{"chargeId":"ch_000006","amountMinor":"4200"}'
   ```

3. Click **Run reconciliation**. Wait approximately 10 seconds. Refresh the page.
4. A new **Missing Internal** exception for `ch_000006` and amount `4200` appears.
5. Click **Resolve**. Select a resolution code. Type a note. Save the resolution.

The simulator also accepts fault injection on `POST /admin/faults` with the same token. Supported faults: `timeout-then-succeed`, `500`, `declined`, `duplicate-webhook`, `out-of-order-webhook`. Send `{"clear":true}` to remove all faults.

### 7. Masked reveal

1. Sign in as `agent`. Open payment `ch_000005`. The email shows `[REDACTED]`. There is no **Reveal** button.
2. Sign in as `supervisor`. Open payment `ch_000005`. Click **Reveal**.

Result: the email shows `customer5@example.test`. The button changes to **Revealed**. The audit log records `customer email revealed`.

### 8. Audit verify and tamper demo

1. Sign in as `auditor`. Click **Audit & controls**. Click **Verify chain**.
2. The page shows **Audit chain verified** and the number of events.
3. Make sure that the runtime role cannot change an event:

   ```sh
   docker compose exec -T postgres psql -U app_runtime -d internal_tools \
     -c "UPDATE foundation.audit_events SET event_data = event_data WHERE seq = 2"
   ```

   Result: `ERROR: permission denied for table audit_events`.

4. Make sure that the owner role cannot change an event while the trigger is active:

   ```sh
   docker compose exec -T postgres psql -U tools -d internal_tools \
     -c "UPDATE foundation.audit_events SET event_data = event_data WHERE seq = 2"
   ```

   Result: `ERROR: audit_events is append-only`.

5. Simulate an attack by a database owner. This step changes local data. Do it only on a local stack:

   ```sh
   docker compose exec -T postgres psql -U tools -d internal_tools -v ON_ERROR_STOP=1 <<'SQL'
   BEGIN;
   ALTER TABLE foundation.audit_events DISABLE TRIGGER audit_events_immutable;
   UPDATE foundation.audit_events SET event_data = jsonb_set(event_data, '{actorId}', '"tampered"') WHERE seq = 2;
   ALTER TABLE foundation.audit_events ENABLE TRIGGER audit_events_immutable;
   COMMIT;
   SQL
   ```

6. Click **Verify chain** again. The page shows **Audit chain integrity check failed** and the ID of the first broken event.
7. To get a valid chain again, reset the stack: `docker compose down -v`, then `docker compose up -d --build --wait`.

### 9. Jaeger trace

1. Open http://localhost:16686.
2. The Jaeger UI opens. The **Service** list shows `(0)` services.

The API and the worker do not export traces in this prototype. The Jaeger container is a target for future OpenTelemetry work. The API writes a request ID (`reqId`) in each JSON log line. Use `docker compose logs api` to follow one request.

### 10. Prometheus metric

1. Open http://localhost:9090/targets. The target `internal-tools-api` is **UP**.
2. Open http://localhost:9090/query. Type `approvals_pending`. Click **Execute**.
3. The table shows `approvals_pending{instance="api:3000", job="internal-tools-api", tool="refunds"}` and the current number of pending approvals.

Other metrics: `outbox_depth`, `reconciliation_exceptions_open`, and `execution_paused`.

## Feature-Flag Panel

The Feature-Flag Panel is the second tool. It uses the Foundation for sign-in, access checks, CSRF, idempotency, approvals, audit events and logs. It adds no tool-specific copy of these controls.

- Each flag has a state for `development`, `staging` and `production`. A state has an on or off value and a rollout percent from 0 to 100.
- A `flag_editor` changes `development` and `staging` immediately. The audit log records the state before and after the change.
- A production change creates a Foundation approval. A `flag_approver` who is not the requester must approve it. The approval applies the change in the same database transaction.
- If the approval expires, the change request expires. The editor can then request a new production change.
- `auditor` and `platform_admin` can read flags, approvals and history. They cannot change flags.

Demo steps:

1. Sign in as `flag-editor`. Open Feature flags.
2. Search for `dark`. Open `dashboard.dark_mode`.
3. Set the staging rollout percent to 25. Select Save staging. The history shows the change.
4. In Production, select Enabled in production. Set the rollout percent. Write a reason with at least 10 characters. Select Request production change. Production does not change yet.
5. Sign out. Sign in as `flag-approver`. Open Flag approvals.
6. Find the request. Select Approve. The page shows the new production state.
7. Open the flag. The production state and the history show the approved change.
8. Sign in as `auditor`. Open the flag. The controls are disabled.

Code and controls are in `tools/feature-flags`. The runbook is in `tools/feature-flags/runbooks/README.md`.

## Add a tool

```sh
nvm use 22
npm install
npm run new-tool -- case-review
npm install
npm run typecheck
npx vitest run tools/case-review
```

The generator creates `tools/case-review`. It adds one line to `apps/api/src/tool-registry.ts` and one line to `apps/web/src/tool-registry.ts`. It adds project references to `tsconfig.json`, `apps/api/tsconfig.json`, and `apps/web/tsconfig.json`. After you run it, add the `case-review-operator` group and a local user to `infra/keycloak/internal-tools-realm.json`.

To prove that the generator output compiles and passes its tests without a change to your working tree, run:

```sh
bash scripts/check-new-tool.sh
```

For the full procedure, read `.devin/playbooks/add-internal-tool.md`.

## Tests

Run these commands from the repository root with Node 22:

```sh
nvm use 22
npm install
npm run lint
npm run format:check
npm run typecheck
npm test
bash scripts/check-new-tool.sh
```

To run the end-to-end test, start the stack first:

```sh
docker compose up -d --build --wait
npx playwright install chromium
npm run e2e
```

- `npm test` runs the Vitest unit tests. It does not need the stack.
- `npm run e2e` signs in as `agent`, `supervisor`, and `auditor`. It requests a refund, approves it, and verifies the audit chain. It saves screenshots to `test-results/screens/`. Set `SCREENSHOT_DIR` to use a different folder.
- On Linux, `npx playwright install --with-deps chromium` also installs the system libraries.

To apply migrations and seed data from the host to the Compose database:

```sh
npm run db:migrate
npm run db:seed
```

These commands use `postgres://tools:local-development-only@localhost:5432/internal_tools` by default. If you change `POSTGRES_PASSWORD` in `.env`, set `MIGRATION_DATABASE_URL` to the new connection string.

## Repository layout

| Path                                                | Purpose                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/foundation`                               | Shared runtime: `defineRoute`, `registerTool`, approvals, audit chain, masking, idempotency, outbox |
| `packages/ui-kit`                                   | Shared React controls and the `api()` client                                                        |
| `packages/testing`                                  | Shared test helpers                                                                                 |
| `apps/api`                                          | Fastify server, OIDC sign-in, SQL migration (`db/`), seed data, and the API tool registry           |
| `apps/worker`                                       | Outbox worker, reconciler loop, and the worker tool registry                                        |
| `apps/web`                                          | React console shell and the web tool registry                                                       |
| `services/payment-simulator`                        | Local payment provider with signed webhooks and fault injection                                     |
| `tools/refunds`                                     | Refunds Console: registry, API routes, worker handlers, web pages, and tests                        |
| `tools/feature-flags`                               | Feature-Flag Panel: registry, migrations, seed, API routes, web pages, runbook, and tests           |
| `scripts/new-tool.ts`, `scripts/check-new-tool.sh`  | Tool generator and its check                                                                        |
| `e2e`                                               | Playwright configuration and specs                                                                  |
| `infra/keycloak`                                    | Local Keycloak realm with users and groups                                                          |
| `infra/prometheus.yml`                              | Prometheus scrape configuration                                                                     |
| `infra/terraform`                                   | Azure Terraform. Validated in CI. Not applied.                                                      |
| `docs/PRD.md`, `docs/SYSTEM_DESIGN.md`              | Product and design specifications                                                                   |
| `docs/adr`, `docs/runbooks`, `docs/threat-model.md` | Decisions, operator guides, and the threat model                                                    |
| `docs/clean-clone-report.md`                        | Step log of a clean-machine review of this README                                                   |
| `.devin`                                            | Tool development playbook and repository knowledge                                                  |
| `.github/workflows`                                 | CI: lint, typecheck, tests, end-to-end, dependency rules, security scans, Terraform checks          |

## Status of each capability

| Capability                                                               | Built | Simulated                                                | Documented                                                                         | Client-owned                                                                   |
| ------------------------------------------------------------------------ | ----- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Foundation runtime: permissions, CSRF, validation, idempotency, outbox   | Yes   |                                                          |                                                                                    |                                                                                |
| Generic approvals with self-approval and duplicate-approval blocks       | Yes   |                                                          |                                                                                    |                                                                                |
| Audit hash chain, append-only trigger, and least-privilege runtime role  | Yes   |                                                          |                                                                                    |                                                                                |
| Refund requests, tiers, balance reservation, daily auto limit            | Yes   |                                                          |                                                                                    |                                                                                |
| Kill switch (pause and resume execution)                                 | Yes   |                                                          |                                                                                    |                                                                                |
| Reconciliation and exception queue                                       | Yes   |                                                          |                                                                                    |                                                                                |
| Masked customer email with audited reveal                                | Yes   |                                                          |                                                                                    |                                                                                |
| CSV exports                                                              | Yes   |                                                          |                                                                                    |                                                                                |
| Tool generator and playbook                                              | Yes   |                                                          |                                                                                    |                                                                                |
| Prometheus metrics endpoint                                              | Yes   |                                                          |                                                                                    |                                                                                |
| Payment provider                                                         |       | Yes: local simulator. Optional Stripe test-mode adapter. | `docs/runbooks/stripe-test-mode.md`                                                | Production provider account and keys                                           |
| Identity provider                                                        |       | Yes: local Keycloak                                      | `docs/adr/0006-keycloak-local-identity.md`                                         | Production IdP (for example Entra ID), groups, and joiner-mover-leaver process |
| Customer and payment data                                                |       | Yes: synthetic seed data                                 |                                                                                    | Real data, data migration, and retention rules                                 |
| Distributed tracing                                                      |       |                                                          | Jaeger container only. No trace export.                                            | OpenTelemetry instrumentation and the trace back end                           |
| Azure deployment                                                         |       |                                                          | `infra/terraform` and `docs/adr/0007-azure-deployment.md`. Validated, not applied. | Subscription, state backend, apply pipeline, and approvals                     |
| Secrets management                                                       |       |                                                          | Key Vault in Terraform                                                             | Secret values, rotation, and access reviews                                    |
| Backups and disaster recovery                                            |       |                                                          | PostgreSQL settings in Terraform                                                   | Recovery tests and recovery targets                                            |
| Runbooks and threat model                                                |       |                                                          | `docs/runbooks`, `docs/threat-model.md`                                            | Review, on-call ownership, and sign-off                                        |
| Feature-Flag Panel: flags per environment, production approvals, history | Yes   |                                                          | `tools/feature-flags/runbooks/README.md`                                           |                                                                                |

## Terraform reference

The folder `infra/terraform` has Azure Terraform for `dev`, `staging`, and `prod`. CI runs `terraform fmt`, `terraform validate`, TFLint, and Trivy on it. Nobody has applied it. It creates no cloud resources in this prototype.

Modules: `network`, `postgres`, `app_service`, `worker`, `registry`, `key_vault`, `monitoring`, `alerts`, `storage_worm`, `front_door`, and `identity`.

To validate it locally, install Terraform, TFLint, and Trivy. Then run:

```sh
cd infra/terraform
terraform fmt -check -recursive
for env in dev staging prod; do
  terraform -chdir="envs/$env" init -backend=false -input=false
  terraform -chdir="envs/$env" validate
done
tflint --init
tflint --recursive --config "$PWD/.tflint.hcl"
trivy config --severity HIGH,CRITICAL --exit-code 1 .
```

Do not run `terraform plan` or `terraform apply` from this prototype. Read `infra/terraform/README.md` for the tool versions, the topology, and the state and apply procedure.

## What is simulated

- **Payment provider.** The payment simulator on port 4000 accepts refunds with an `Idempotency-Key` header. It sends signed webhooks to the API. It can inject faults and create provider-only refunds. It keeps its state in the `simulator-data` volume.
- **Identity.** Keycloak runs in development mode with a realm file from `infra/keycloak`. The users, groups, and client secret are local test values.
- **Data.** All payments, customers, emails, and card digits are synthetic. Emails use the domain `example.test`.
- **Tracing.** Jaeger runs, but no service sends traces to it.
- **Environment.** The console header shows a local environment badge. Cookies are not marked `Secure` because the stack uses HTTP.

## What the client owns

- The production identity provider, its groups, and access reviews.
- The Azure subscription, the Terraform state backend, and the deployment pipeline with approvals.
- Production secrets, key rotation, and the payment provider account.
- A managed database, backups, and recovery tests.
- Real customer data, data protection reviews, and retention rules.
- Threat model review, penetration tests, and compliance sign-off.
- On-call support, runbook ownership, and incident response.

## Troubleshooting

| Symptom                                                                           | Cause                                                              | Action                                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose up` fails with `port is already allocated`                        | Another process uses a port from the [port list](#urls-and-ports). | Stop that process, or change the host port in `docker-compose.yml`.                                                                              |
| After **Sign out**, the next sign-in uses the same user and shows no login form   | Keycloak keeps its own session.                                    | Use the [change the user](#change-the-user) steps.                                                                                               |
| The sign-in page shows `Sign-in service is not ready. Try again shortly.`         | Keycloak is still starting.                                        | Wait 30 seconds. Run `docker compose ps` and make sure that `keycloak` is `healthy`. Try again.                                                  |
| The sign-in page shows `Sign-in expired. Start again.`                            | The sign-in took more than 5 minutes, or the API restarted.        | Go to http://localhost:5173 and sign in again.                                                                                                   |
| `npm run db:migrate` fails with `password authentication failed for user "tools"` | The database password is not the local default.                    | Set `MIGRATION_DATABASE_URL=postgres://tools:<password>@localhost:5432/internal_tools`.                                                          |
| A refund stays **Approved**                                                       | Execution is paused, or the worker is stopped.                     | Sign in as `platform-admin` and click **Resume execution**. Run `docker compose logs worker`. Read `docs/runbooks/refund-stuck-in-executing.md`. |
| **Verify chain** shows **Audit chain integrity check failed**                     | Somebody changed an audit row, for example in demo 8.              | Read `docs/runbooks/audit-verify-failed.md`. On a local stack, run `docker compose down -v` and start again.                                     |
| `npm run e2e` fails with a strict mode error on the approval card                 | An earlier run left a pending request with the same note.          | Run `docker compose down -v`, then `docker compose up -d --build --wait`, then run the test again.                                               |
| Playwright cannot start Chromium on Linux                                         | System libraries are missing.                                      | Run `npx playwright install --with-deps chromium`.                                                                                               |
| A command fails with a Node.js syntax or engine error                             | The Node.js version is not 22.                                     | Run `nvm use 22`.                                                                                                                                |
| You want a clean start                                                            | Old data is in the Docker volumes.                                 | Run `docker compose down -v`, then `docker compose up -d --build --wait`.                                                                        |

## Security and production limits

Use only synthetic records in this prototype. Do not add production data or credentials. The local passwords and `.env.example` values are not production secrets. Before production use, the team must review the threat model, configure a production identity provider, set up secret storage, deploy a managed database, test recovery, and complete the deployment work.
