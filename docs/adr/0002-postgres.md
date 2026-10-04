# ADR 0002: PostgreSQL as the system of record

Status: accepted.

## Context

Tools store approvals, sessions, idempotency keys, outbox items and audit events. Money rules must hold even if application code has a defect.

## Decision

- Use PostgreSQL 16 for all tool data.
- Access the database with the `pg` driver and parameterized SQL. There is no ORM. Drizzle was removed.
- Keep versioned SQL migrations in `apps/api/db/` for the Foundation and the Refunds Console. Keep tool migrations in `tools/<id>/migrations/`. `apps/api/src/migrate.ts` applies them in order.
- Put money rules in database constraints and triggers: the refundable balance check, the refund state transition trigger and the append-only audit trigger.

## Consequences

- Reviewers can read the exact SQL. The constraints stop an over-refund even if the API has a defect.
- There are no generated types from the schema. Each query declares its row type by hand. A schema change needs a manual check of the queries.
- Migrations run at API start-up and with `npm run db:migrate`.
