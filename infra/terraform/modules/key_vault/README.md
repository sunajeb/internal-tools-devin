# Key Vault

Creates a private, RBAC-controlled Key Vault and private endpoint.

## Key inputs

- `secret_reader_principal_ids` maps workload names to managed identity principal IDs.
- `private_endpoints_subnet_id` and `private_dns_zone_id` configure private access.
- `log_analytics_workspace_id` receives audit diagnostics.

## Outputs

The vault ID, name, and URI.

## Important notes

Soft-delete retention is 90 days. Purge protection is enabled and cannot be disabled.
Create the `session-secret` value outside Terraform. Terraform state contains the generated OIDC client secret.
