# Add an internal tool

## Steps

1. Read the product requirement and confirm the tool owner, roles, data class and approval rules.
2. Run `npm run new-tool -- <tool-id>`.
3. Add the tool permission matrix to its registry entry. Give every route one permission.
4. Validate every request with a shared Zod schema. Keep business logic in the tool module.
5. Use Foundation approvals for maker-checker actions. Do not add tool-specific sign-in or audit code.
6. Write audit events in the same transaction as each business change.
7. Use the Foundation outbox for calls to other systems. Reuse a stable idempotency key.
8. Add migrations, tests, a page and a runbook for the tool.
9. Run `npm run lint`, `npm run typecheck` and `npm test`.
10. Review the permission matrix and the threat model. Open a pull request for an engineer to review.

## Conventions

- Keep each tool under `tools/<tool-id>`.
- Import Foundation and UI kit public package entries only.
- Store currency amounts as integer minor units.
- Mask confidential and restricted fields. Audit each reveal and export.
- Use database filtering and keyset pages for large lists.
- Use synthetic records in local and test environments.

## Definition of done

- Registry entry includes owner, roles, data class and approval policy.
- Every API route has a permission and schema.
- Database constraints protect important business rules.
- Tests cover success, refusal, concurrency and retry cases.
- The page is keyboard accessible and uses shared UI components.
- A runbook explains the main alert and recovery steps.
- Lint, typecheck, tests and applicable security checks pass.
