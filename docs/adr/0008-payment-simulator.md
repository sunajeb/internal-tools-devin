# ADR 0008: Local payment simulator

Status: accepted.

Use a small local service as the default provider. It supports idempotency, webhooks and controlled failures without credentials. A Stripe adapter is included for test-mode keys and mapped test charges; production provider integration remains out of scope.
