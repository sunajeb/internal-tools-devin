# Repository knowledge

## Conventions

- Use Node 22, npm workspaces and strict TypeScript.
- Keep each tool in `tools/<id>`. Use `@internal-tools/foundation` and `@internal-tools/ui-kit` public exports.
- Declare each route with `defineRoute({ method, path, permission, params?, query?, body?, idempotent?, handler(ctx) })` and mount the tool with one line in `apps/api/src/tool-registry.ts`. `registerTool` refuses a route whose permission is not in the tool matrix.
- The handler context gives `tx`, `user`, `audit`, `approvals`, `outbox`, `mask` and `log`. Do not write tool-specific sign-in, CSRF, audit, approval or logging code.
- Follow `.devin/playbooks/add-internal-tool.md` to add a tool. `bash scripts/check-new-tool.sh` proves that the generator output compiles and passes tests.
- Store money as integer minor units and keep the currency code with each amount.
- Put provider calls in the outbox. Use the refund ID as the provider idempotency key.
- Write business changes and audit events in one database transaction.
- Use Zod at API boundaries. Use database constraints as a second control.
- Use keyset pagination for large lists. Do not use `OFFSET` for payment search.
- Do not store full card numbers, security codes or bank account numbers.
- Keep production secrets out of source, logs, images and commits.

## Definition of done

1. Add or update the registry entry and the permission matrix.
2. Add input validation, database constraints, audit events and tests.
3. Keep external effects idempotent and recoverable through the outbox.
4. Run lint, typecheck, unit and integration tests.
5. Update the runbook and user documentation.
6. Confirm no secret, restricted customer field or PAN entered the diff.
