# Worker

Creates a separate Linux App Service plan and private worker app.

## Key inputs

- `worker_subnet_id` provides isolated VNet integration.
- `worker_command` selects the container process.
- Registry, database, and monitoring values configure runtime access.

## Outputs

The worker app ID and managed identity principal ID.

## Important notes

The worker endpoint is private. The process must listen on `WEBSITES_PORT` and answer `/health/live` for App Service probes.
The worker uses managed identity for registry pulls.
It retains Key Vault Secrets User for future secrets and has no sign-in settings.
