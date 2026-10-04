# PostgreSQL

Creates a private PostgreSQL Flexible Server, database, Entra administrator, and diagnostics.

## Key inputs

- `sku_name`, `storage_mb`, and `high_availability_enabled` set capacity and resilience.
- `delegated_subnet_id`, `private_dns_zone_id`, and `private_dns_zone_link_id` connect private networking.
- `entra_admin_object_id` and `entra_admin_principal_name` identify the Entra administrator group.

## Outputs

The server ID, fully qualified domain name, and database name.

## Important notes

After deployment, create app and worker Entra principals with `pgaadauth_create_principal`. Terraform cannot create these database principals.
Geo-redundant backup is immutable after server creation. High availability cannot use a Burstable SKU.
