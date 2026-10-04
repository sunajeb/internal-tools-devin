# ADR 0008: Local payment simulator

Status: accepted.

## Context

Tests must force rare provider faults. The prototype must run without provider credentials.

## Decision

Use a small local service (`services/payment-simulator`) as the default provider. It supports idempotency keys, signed webhooks, a list API for reconciliation and fault injection on `POST /admin/faults`. A Stripe adapter in `tools/refunds/src/provider.ts` works with test-mode keys.

## Consequences

- The payment provider is simulated. The Stripe adapter is for test mode only.
- A production provider integration, its account and its keys are client-owned.
