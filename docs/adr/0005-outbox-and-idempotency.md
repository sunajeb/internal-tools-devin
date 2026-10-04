# ADR 0005: Outbox and stable idempotency

Status: accepted.

## Context

A process can stop between a database commit and a provider call. A retry must not send a second refund.

## Decision

- Commit the business change, the audit event and the outbox row in one transaction.
- The worker claims outbox rows with `FOR UPDATE SKIP LOCKED` and retries with exponential backoff and jitter, up to 8 attempts.
- The worker sends the refund ID as the provider idempotency key. Each retry reuses the key.
- API routes that change state accept an `Idempotency-Key` header. The Foundation stores the request hash and the response in `foundation.idempotency_keys`.

## Consequences

- The provider executes at most one refund for each refund ID.
- Exactly-once applies to one refund ID. It does not apply to one customer intent. Two refund requests for the same intent get two IDs and can both execute if both are approved.
- The prototype does not delete old idempotency keys.
