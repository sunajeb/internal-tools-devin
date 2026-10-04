# Runbook: pause and resume execution

1. A Platform Admin can pause Refunds execution from the dashboard or API.
2. Confirm the pause event appears in the audit log and the execution-paused metric is one.
3. Approved refunds remain in the outbox. The worker does not send them while paused.
4. Resolve the incident and check the provider state before resuming.
5. Resume execution and monitor outbox depth, failed events and reconciliation.
