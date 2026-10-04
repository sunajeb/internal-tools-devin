# ADR 0004: Hash-chain audit events

Status: accepted.

## Context

Auditors must detect a changed or deleted audit event. A database owner can disable triggers.

## Decision

- Store audit events in `foundation.audit_events`. The runtime role `app_runtime` has only `INSERT` and `SELECT`. A trigger refuses `UPDATE` and `DELETE`.
- Link each event to the previous event with SHA-256 (`packages/foundation/src/audit.ts`). A transaction advisory lock serializes writes.
- `GET /api/audit/verify` recomputes the chain and returns the first broken event.

## Consequences

- The local stack detects a change to one event. Demo 8 in the README shows this.
- The hash is not keyed. A database owner who rewrites all events after the change can make a new valid chain. Production needs an external, immutable copy of the chain head (for example a locked WORM storage container). The prototype has no head export.
- The advisory lock limits audit write throughput to one writer at a time.
