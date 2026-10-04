# Runbook: audit verify failed

1. Stop policy and refund changes if audit integrity is not known.
2. Record the first broken event ID. **Verify chain** on **Audit & controls** and `GET /api/audit/verify` show it.
3. Compare the event chain with the external immutable anchor. The prototype does not export an anchor. Production must add this export before this step is possible.
4. Preserve database, application and identity-provider logs.
5. Notify Security and Compliance. Do not repair or delete evidence in place.

On a local stack, run `docker compose down -v` and start again to get a valid chain.
