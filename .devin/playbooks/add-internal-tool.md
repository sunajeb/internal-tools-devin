# Add an internal tool

## Outcome

A new tool in `tools/<tool-id>` that gets sign-in, permissions, CSRF checks, input validation, idempotency, audit, approvals, the outbox and logs from the Foundation. The tool adds no code of its own for these controls.

## Steps

1. Read the product requirement. Confirm the tool owner, roles, data class and approval rules.
2. Run `npm run new-tool -- <tool-id>`, then `npm install`. The generator writes `tools/<tool-id>/**` and changes only these shared files:
   - one line in `apps/api/src/tool-registry.ts`
   - one line in `apps/web/src/tool-registry.ts`
   - one project reference in `tsconfig.json`, `apps/api/tsconfig.json` and `apps/web/tsconfig.json`
3. Edit `src/registry.ts`. Declare the roles with their identity-provider groups and the permission matrix. Use role names with a tool prefix (for example `flag_editor`) so that roles do not collide across tools. Add the groups and local users to `infra/keycloak/internal-tools-realm.json`.
4. Edit `src/api.ts`. Declare every route with `defineRoute`:

   ```ts
   defineRoute({
     method: 'POST',
     path: '/api/tools/<tool-id>/things',
     permission: '<tool-id>.write', // must exist in the registry matrix
     params: ParamsSchema, // optional Zod schemas
     query: QuerySchema,
     body: BodySchema,
     idempotent: true, // requires an Idempotency-Key header
     handler: async ({ tx, user, params, query, body, audit, approvals, outbox, mask, log }) => {
       // tx is the open database transaction for this request
       await audit({ action: '<tool-id>.thing_created', objectType: 'thing', objectId: id, after: {...} });
       return { statusCode: 201, body: thing }; // or return a plain object for 200
     },
   });
   ```

   The Foundation rejects a route with no permission, or with a permission that the matrix does not declare, at start-up. It checks the session, CSRF (non-GET), Zod input and the permission before the handler runs. It audits each denied attempt.

5. For a maker-checker action, call `approvals.create({ action, objectType, objectId, tier, policyVersion, contentHash, steps: [{ roles: ['<approver-role>'], approvals: [] }], summary })` in the handler. Add `approvalHandlers: { '<action>': async (ctx, approval, decision) => {...} }` to the registration. The Foundation serves `GET /api/approvals?tool=<tool-id>` and `POST /api/approvals/:id/approve|reject`. It blocks self-approval, duplicate approval by one user and steps out of order. The handler runs in the same transaction as the final decision.
6. For a call to another system, call `outbox.enqueue(kind, payload, idempotencyKey)` in the handler. Add the outbox handler in a worker registration in `apps/worker/src/tool-registry.ts`.
7. Put SQL in `migrations/NNN_name.sql` (applied in order by `npm run db:migrate`) and synthetic data in `seed.sql` (applied by `npm run db:seed`). Use database constraints for important business rules.
8. Edit `src/web.tsx`. Export `tool = { id, name, description, routePath: '/tools/<tool-id>/*', icon, navigation, Pages }`. Use `api()` from `@internal-tools/ui-kit` so that CSRF and errors work. Render the approvals for the tool from `GET /api/approvals?tool=<tool-id>`.
9. Add tests next to the code (`src/*.test.ts`): the permission matrix for every route and role, refusals, approvals and the audit events. Add a Playwright spec in `e2e/specs/<tool-id>.spec.ts`.
10. Write `runbooks/README.md`.
11. Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` and `npm run e2e`.
12. Open a pull request. The diff must contain only the tool directory, the generated registry lines and references, the realm data, a README row and the e2e spec.

## Conventions

- Import only the public entry points of `@internal-tools/foundation` and `@internal-tools/ui-kit`. dependency-cruiser enforces this.
- Store currency amounts as integer minor units with a currency code.
- Mask confidential and restricted fields with `mask()`. Audit each reveal and export.
- Use database filters and keyset pages for large lists. Do not use `OFFSET`.
- Use synthetic records only.

## Definition of done

- The registry declares owner, roles, data class and permissions.
- Every route has a permission and Zod schemas for its input.
- Database constraints protect important business rules.
- Tests cover success, refusal, concurrency and retry cases.
- The page works with a keyboard and uses shared UI components.
- A runbook explains the main alert and the recovery steps.
- Lint, format, typecheck, tests and e2e pass.
