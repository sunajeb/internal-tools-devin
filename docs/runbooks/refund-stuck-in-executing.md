# Runbook: refund stuck in executing

1. Find the refund ID in the refund timeline and inspect its outbox event.
2. Check the provider dashboard with the stable refund ID as the idempotency key.
3. Do not create a second provider refund.
4. If the provider has completed the refund, run reconciliation and confirm the webhook inbox event.
5. If the provider confirms no refund exists, retry the same outbox event. Follow the outbox-failure runbook when the row has reached its retry limit.
6. Escalate if the provider state is unknown. Keep the refund paused until the provider confirms its state.
