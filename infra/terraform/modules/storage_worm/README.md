# WORM audit storage

Creates a private StorageV2 account and an immutable audit anchor container.

## Key inputs

- `replication_type` selects ZRS or GZRS replication.
- `retention_days` defaults to 2555 days, or seven years.
- `immutability_locked` permanently locks the retention policy when true.

## Outputs

The storage account ID, account name, and container name.

## Important notes

Development uses one-day retention. Staging uses seven days. Production uses 2555 days and a locked policy.
A locked policy cannot be shortened or removed. Locking is permanent.
