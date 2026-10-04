# Container registry

Creates a Premium Azure Container Registry with managed identity pulls and diagnostics.

## Key inputs

- `name` must be globally unique and meet Azure Registry naming rules.
- `zone_redundancy_enabled` enables zone redundancy for production.
- `log_analytics_workspace_id` receives registry diagnostics.

## Outputs

The registry ID, name, and login server.

## Important notes

Public access remains enabled so GitHub-hosted runners can push images. Move to a private endpoint and self-hosted runners when the client is ready.
The registry has no admin credentials. Workloads use managed identities.
