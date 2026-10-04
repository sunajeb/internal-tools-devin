# Runbook: outbox failures

1. Query `foundation.outbox` for rows with `status='failed'` and inspect worker logs.
2. Confirm whether the provider completed the refund. If the state is unknown, keep execution paused and contact the provider.
3. If the provider completed the refund, queue reconciliation. It updates the still-reserved refund and closes its outbox item.
4. If the provider confirms there is no refund, and the internal refund remains `executing`, an authorized operator may reset that outbox row to `pending`, set `attempts=0`, clear its lease and error, and set `next_attempt_at=now()`.
5. Retry the same outbox row. It keeps the refund ID as the provider idempotency key. Do not create a second record while provider state is unknown.
6. A refund already in `failed` state is terminal. Start a new request only after verifying that the provider did not process the earlier request.
