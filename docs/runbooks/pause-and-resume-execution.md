# Runbook: pause and resume execution

1. A Platform Admin pauses Refunds execution with **Pause execution** on **Overview**, or with `POST /api/admin/pause`.
2. Confirm that the audit log has the pause event and that the metric `execution_paused{tool="refunds"}` is `1`.
3. Approved refunds remain in the outbox. The worker does not send them while paused.
4. Resolve the incident and check the provider state before resuming.
5. Click **Resume execution**. Monitor `outbox_depth`, failed outbox rows and `reconciliation_exceptions_open`.
