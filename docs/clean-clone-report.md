# Clean-clone report

This report records a run of every README step on a new clone. The reviewer followed the README exactly and fixed each step that was wrong or unclear.

| Field   | Value                                                                          |
| ------- | ------------------------------------------------------------------------------ |
| Date    | 4 October 2026                                                                 |
| Base    | `devin/1791105966-foundation-refunds` at `e0be40b` (Feature-Flag Panel merged) |
| Machine | Linux, Docker Engine 29.7.2, Docker Compose v5.4.0                             |
| Node.js | 22.23.3, selected with `nvm use` and `.nvmrc`                                  |
| Data    | Empty Docker volumes at the start                                              |

## Result

| #   | README step                     | Result                                                                                                                                                                 |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Quick start                     | Pass. `docker compose up -d --build --wait` started all services.                                                                                                      |
| 2   | Health checks                   | Pass. `{"status":"ok"}`, `{"status":"ready"}`, `{"status":"ok"}`, Keycloak `200`, `Prometheus Server is Ready.`, and the 4 gauges on `/metrics`.                       |
| 3   | Seeded logins                   | Pass. Each seeded user signed in through the Keycloak form. **Sign out** ended the Keycloak session.                                                                   |
| 4   | Demo 1. Refund request          | Pass.                                                                                                                                                                  |
| 5   | Demo 2. Approval                | Pass. The refund became **Succeeded**, then **Reconciled**.                                                                                                            |
| 6   | Demo 3. Self-approval block     | Pass. The UI disabled the buttons. A direct call returned HTTP 403 `You cannot approve a request that you submitted.`                                                  |
| 7   | Demo 4. Dual approval           | Pass.                                                                                                                                                                  |
| 8   | Demo 5. Kill switch             | Failed as written. Fixed in the README (F1).                                                                                                                           |
| 9   | Demo 6. Reconciliation          | Failed as written. Fixed in the README (F2).                                                                                                                           |
| 10  | Demo 7. Masked reveal           | Failed as written. Fixed in the README (F3).                                                                                                                           |
| 11  | Demo 8. Audit verify and tamper | Pass. Runtime role: `permission denied for table audit_events`. Owner: `audit_events is append-only`. After the trigger bypass, verify reports the first broken event. |
| 12  | Demo 9. Jaeger                  | Pass as documented. The UI opens with no services.                                                                                                                     |
| 13  | Demo 10. Prometheus             | Pass. Target `internal-tools-api` is up. `approvals_pending` returns a value.                                                                                          |
| 14  | Feature-Flag Panel demo         | Pass in `e2e/specs/feature-flags.spec.ts`. A production change applied only after `flag-approver` approved it.                                                         |
| 15  | Tests                           | `npm install`, `npm run lint`, `npm run format:check`, `npm run typecheck` and `bash scripts/check-new-tool.sh` passed. `npm test` failed once (F4). Fixed.            |
| 16  | End-to-end tests                | Pass. `npm run e2e`: 12 passed.                                                                                                                                        |
| 17  | Add a tool                      | Pass. `bash scripts/check-new-tool.sh` generated, compiled and tested a tool in a temporary copy.                                                                      |

## Failed steps and fixes

### F1: Demo 5 told `platform-admin` to watch the Refunds page

The `platform-admin` user has no **Refunds** page. The README step 6 could not be done as that user.

- Fix (README): `platform-admin` clicks **Resume execution** on **Overview**. Then `supervisor` opens **Refunds** to see **Succeeded**.

### F2: Demo 6 asked the user to select a resolution code

The **Resolve** dialog has a text field **Resolution code** with the value `provider_record_confirmed`, a **Review note** field and a **Confirm resolution** button. There is no list to select from.

- Fix (README): the step now names the real fields and the button.

### F3: Demo 7 did not show the reveal reason

**Reveal** opens a dialog that needs a reason of at least 10 characters. The email shows only after **Reveal email**. The audit action is `customer.email_revealed`.

- Fix (README): the step now includes the reason and the **Reveal email** button.

### F4: One integration test expected an intermediate refund state

`tools/refunds/src/money-correctness.test.ts` (criterion C6) waited for the status `succeeded`. On a fast run, the reconciler moved the refund to `reconciled` before the test read it. `reconciled` is a valid later state.

- Fix (minimal test change): the test accepts `succeeded` or `reconciled`. Result: 272 passed, 12 skipped.

### Other README corrections

- `npm test` runs integration tests when the stack runs. The README said that it does not need the stack.
- `npm run e2e` runs 12 tests. The README described one test.
- Demo 3 now says that the approval ID is `approval_id` from `GET /api/approvals`.
- The repository layout states that Drizzle was removed and that database access uses `pg` with SQL migrations in `apps/api/db/`.
