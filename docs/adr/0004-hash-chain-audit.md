# ADR 0004: Hash-chain audit events

Status: accepted.

Use an append-only database table and a SHA-256 chain under an advisory lock. Verify the chain on demand. Export anchors to immutable storage in production.
