# Entra identity

Creates an Entra web application, service principal, rotating password, and Key Vault secret.

## Key inputs

- `redirect_uri` sets the Front Door OIDC callback.
- `tenant_id` selects the Entra tenant.
- `key_vault_id` and `secret_writer_role_assignment_id` store the generated secret.

## Outputs

The OIDC client ID and issuer URL.

## Important notes

The client secret rotates every 180 days. Terraform state stores this secret and needs strict access controls.
The application requests Microsoft Graph delegated `User.Read` and group claims.
