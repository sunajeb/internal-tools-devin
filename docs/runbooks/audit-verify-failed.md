# Runbook: audit verify failed

1. Stop policy and refund changes if audit integrity is not known.
2. Record the first broken event ID and the latest exported anchor.
3. Compare the event chain with the immutable anchor export.
4. Preserve database, application and identity-provider logs.
5. Notify Security and Compliance. Do not repair or delete evidence in place.
