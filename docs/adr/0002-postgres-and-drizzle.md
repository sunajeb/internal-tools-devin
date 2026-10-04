# ADR 0002: PostgreSQL as the system of record

Status: accepted.

Use PostgreSQL for tool data, approvals, sessions, idempotency and the outbox. Use migrations and database constraints as the final control for money rules. The prototype migration SQL is explicit and portable.
