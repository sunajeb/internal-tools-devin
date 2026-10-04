# Entra identity

Creates an Entra web application, service principal, rotating password, and Key Vault secret.

## Key inputs

- `redirect_uri` sets the Front Door OIDC callback.
- `tenant_id` selects the Entra tenant.
- `allowed_group_object_ids` lists the security groups that may sign in.
- `key_vault_id` and `secret_writer_role_assignment_id` store the generated secret.
- `key_vault_network_dependency_ids` delays secret creation until private access exists.

## Outputs

The OIDC client ID and issuer URL.

## Important notes

The client owns the Entra security groups that may sign in.
The password expires 180 days after its rotation due time.
The client must run an approved apply at least monthly so Terraform rotates the password on time.
Terraform state stores the password. Restrict state access.
The application requests Microsoft Graph delegated `User.Read` and group claims.
