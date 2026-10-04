# Runbook: outbox failures

1. Query `foundation.outbox` for rows with `status='failed'` and inspect worker logs.
2. Confirm whether the provider completed the refund. If the state is unknown, keep execution paused and contact the provider.
3. If the provider completed the refund, queue reconciliation. It updates the still-reserved refund and closes its outbox item.
4. Do this step only if the provider confirms that no refund exists and the internal refund is still `executing`. An authorized operator resets the outbox row: set `status` to `pending`, set `attempts=0`, clear the lease and the error, and set `next_attempt_at=now()`.
5. Retry the same outbox row. It keeps the refund ID as the provider idempotency key. Do not create a second record while provider state is unknown.
6. A refund already in `failed` state is terminal. Start a new request only after verifying that the provider did not process the earlier request.
