# Internal Tools Foundation and Refunds Console

This repository contains a local prototype for internal tools. The Foundation supplies shared identity, access checks, approvals, audit events, idempotency, an outbox, and UI components. The Refunds Console is the reference tool.

This prototype uses synthetic data. It is not ready for production use.

## Architecture

```mermaid
flowchart LR
  Browser[React console] -->|OIDC session and API| API[Fastify API]
  API --> DB[(PostgreSQL 16)]
  API --> Outbox[Transactional outbox]
  Outbox --> Worker[Refund worker]
  Worker --> Provider[Payment simulator or Stripe test mode]
  Provider -->|Signed webhook| API
  Browser -->|Sign in| Identity[Local Keycloak]
  Prometheus -->|Metrics| API
  Worker -. trace target .-> Jaeger
```

The API checks permissions before it runs protected routes. It rejects a route that has no permission declaration. PostgreSQL locks a payment row before it reserves a refund amount. The worker uses an idempotency key when it calls the provider.

## Start the local stack

Requirements: Docker Compose and Node.js 22.

1. Copy `.env.example` to `.env` if you need to change a local value.
2. Run `docker compose up -d --build --wait`.
3. Open `http://localhost:5173`.
4. Sign in with one of the local accounts below.

Compose starts PostgreSQL, Keycloak, the payment simulator, the API, the worker, the web console, Jaeger, and Prometheus. The API applies the SQL migration and loads 100,000 synthetic charges with demo refunds and one reconciliation exception. Compose stays running until you stop it with `docker compose down`.

| Account            | Password              | Role                 |
| ------------------ | --------------------- | -------------------- |
| `agent`            | `LocalAgent123!`      | Agent                |
| `supervisor`       | `LocalSupervisor123!` | Supervisor           |
| `finance`          | `LocalFinance123!`    | Finance              |
| `auditor`          | `LocalAuditor123!`    | Auditor              |
| `platform-admin`   | `LocalPlatform123!`   | Platform Admin       |
| `agent-supervisor` | `LocalDualRole123!`   | Agent and Supervisor |

These accounts and passwords are for local development only. Do not reuse them outside this stack. The realm also has feature-flag role groups for later work. The Feature-Flag Panel is not part of this prototype.

## Try the main flows

1. Sign in as `agent`. Search for `ch_000001` on the Payments page.
2. Open the payment. Request a $320 refund and add a note with at least 10 characters. The page shows the Supervisor approval tier.
3. Sign out. Sign in as `supervisor`. Open Approvals and approve the request.
4. Return to the Refunds page. Open the refund to see its audit timeline.
5. Sign in as `auditor`. Open Audit & controls and verify the hash chain.
6. Sign in as `finance`. Open Reconciliation to review the seeded exception, or run a provider reconciliation.

The payment simulator supports duplicate requests, transient errors, provider failures, signed webhooks, and provider-only refunds. Its admin API uses the local-only `SIM_ADMIN_TOKEN` value in `.env.example`. The optional Stripe test adapter requires a Stripe test-mode key and a mapped `provider_charge_id` on each Stripe-backed charge; the synthetic demo charges use the simulator.

## KYC Review Queue

The KYC Review Queue is the second tool on the shared Foundation. It reuses Foundation sign-in, permissions, CSRF, audit, approvals, masking and logs. Its code is in `tools/kyc/`. The seed adds 50,000 synthetic KYC cases.

| Account       | Password              | Role                        |
| ------------- | --------------------- | --------------------------- |
| `kyc-analyst` | `LocalKycAnalyst123!` | KYC analyst                 |
| `kyc-lead`    | `LocalKycLead123!`    | KYC lead                    |
| `auditor`     | `LocalAuditor123!`    | Auditor (read only, masked) |

Demo steps:

1. Sign in as `kyc-analyst`. Open **KYC queue** or go to `http://localhost:5173/tools/kyc`.
2. Set **Status** to New and **Risk band** to High. Use **Next page** and **Previous page** to move through the results. The server uses keyset pagination.
3. Open a case. The customer name, date of birth and national ID are masked.
4. Select **Claim case**. Then select **Reveal** for the national ID. Write a reason and select **Reveal field**. The audit history shows the reveal.
5. Select **Approve** and confirm. The risk score is 70 or more, so the case waits for a KYC lead.
6. Sign out. Sign in as `kyc-lead`. Open **KYC approvals** and select **Approve as KYC lead**. The case status changes to Approved.
7. Sign in as `auditor`. Open the KYC queue. The data stays masked, and the page shows no Reveal or action buttons.

A case with a risk score below 70 closes immediately when the analyst approves it. An analyst can escalate a case in review. Only a KYC lead can decide an escalated case. A step that is not valid returns HTTP 409. See `tools/kyc/runbooks/README.md` for operations.

## Development commands

```sh
npm install
npm run lint
npm run typecheck
npm test
npm run db:migrate
npm run db:seed
npx playwright install chromium
npm run e2e
npm run new-tool -- case-review
```

The end-to-end test expects the Compose stack to be running. It saves screenshots to `/home/ubuntu/briefs/screens/`. SQL in `apps/api/db/001_foundation_refunds.sql` is the source of truth for constraints and triggers. Drizzle models support typed application queries and future migrations.

## What is included

| Area                                                                                                                 | Prototype status                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Shared registry, permission checks, approvals, audit hash chain, masking, idempotency, and outbox                    | Implemented in local code and covered by unit tests                                                                          |
| Refund requests, integer minor-unit amounts, balance reservation, daily cap, tier approvals, and self-approval block | Implemented with PostgreSQL constraints and application checks                                                               |
| Charge search, refund detail, approval inbox, reconciliation queue, audit viewer, pause control, and CSV exports     | Implemented in the web console and API                                                                                       |
| Identity and access                                                                                                  | Keycloak provides local OIDC sign-in and seeded test roles; production identity integration is not configured                |
| Provider calls and webhook handling                                                                                  | Payment simulator is the local default; an optional Stripe test-mode adapter is included                                     |
| Database and seeded records                                                                                          | PostgreSQL is local; all charge and customer data is synthetic                                                               |
| Metrics, Jaeger, security scans, and dependency checks                                                               | Prometheus metrics and a Jaeger UI are included. Trace export is not configured. CI includes security and dependency checks. |
| Azure deployment, network controls, backups, and secrets management                                                  | Outside this prototype. No Terraform configuration is included.                                                              |
| Feature-Flag Panel                                                                                                   | Not built in this scope                                                                                                      |

## Repository map

| Path                                   | Purpose                                            |
| -------------------------------------- | -------------------------------------------------- |
| `packages/foundation`                  | Shared policies and control helpers                |
| `packages/ui-kit`                      | Shared React controls                              |
| `packages/testing`                     | Shared test helpers                                |
| `apps/api`                             | API, SQL migration, seed data, and Drizzle models  |
| `apps/worker`                          | Outbox, provider, webhook, and reconciliation work |
| `apps/web`                             | React console                                      |
| `services/payment-simulator`           | Local provider simulator and fault controls        |
| `tools/refunds`                        | Refunds registry and policy                        |
| `scripts/new-tool.ts`                  | Generator for a new internal tool                  |
| `docs/PRD.md`, `docs/SYSTEM_DESIGN.md` | Source product and design specifications           |
| `docs/adr`, `docs/runbooks`            | Decisions and operator guides                      |
| `.devin`                               | Tool development playbook and knowledge            |

## Security and production limits

Use only local synthetic records in this prototype. Do not add production data or credentials. The local realm passwords and `.env.example` values are not production secrets. Before production use, the team must review the threat model, configure a production identity provider, set secret storage, deploy a managed database, test recovery, and complete the deployment work.
