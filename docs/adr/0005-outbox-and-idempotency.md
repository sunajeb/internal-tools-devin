# ADR 0005: Outbox and stable idempotency

Status: accepted.

Commit a business change and its outbox event in one transaction. The worker uses the refund ID as the provider idempotency key. Retries reuse that key.
