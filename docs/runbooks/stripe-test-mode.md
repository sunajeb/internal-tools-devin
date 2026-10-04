# Runbook: Stripe test mode

1. Set `STRIPE_SECRET_KEY` to a test-mode key that starts with `sk_test_`.
2. Keep the synthetic demo charges on the simulator provider.
3. For a Stripe-backed charge, set its unique `provider_charge_id` to a valid Stripe test-mode charge ID.
4. Confirm the mapping before approving refunds. The worker fails and releases a reservation when a Stripe charge mapping is missing.
5. Never use a live-mode key or production charge ID in this prototype.
