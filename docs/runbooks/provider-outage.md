# Runbook: provider outage

1. Confirm the provider incident from its status page and alert the payments owner.
2. Pause execution if retries could cause an unknown outcome.
3. Keep new requests and approvals queued. Do not bypass the outbox.
4. Retry with the same stable provider idempotency key after recovery.
5. Reconcile the affected period and resolve exceptions with Finance.
