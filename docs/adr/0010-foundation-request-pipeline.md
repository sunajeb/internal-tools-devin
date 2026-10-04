# ADR 0010: One Foundation request pipeline

Status: accepted.

## Context

A tool author can forget a permission check or an audit event. Each control must apply to every route.

## Decision

- Tools declare routes with `defineRoute` and register with `registerTool` (`packages/foundation`).
- `defineRoute` throws if a route has no permission.
- `registerTool` throws if a route uses a permission that the tool permission matrix does not declare. The API does not start.
- The Foundation applies the session, CSRF, input validation, permission and idempotency checks before the tool handler runs.
- If a route that is not `GET` returns a success status and writes no audit event, the Foundation fails the request.

## Consequences

- A tool cannot skip the main controls. Tests in `packages/foundation/src/foundation.test.ts` and `apps/api/test/security-controls.test.ts` cover the start-up failures.
- The audit check runs at request time, not at build time. A test must call each mutating route to find a missing audit event.
- Routes outside the Foundation (sign-in, session, audit and metrics) live in `apps/api/src/server.ts` and need separate review.
