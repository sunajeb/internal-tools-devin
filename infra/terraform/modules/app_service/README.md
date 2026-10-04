# Web application

Creates a Linux App Service plan, a production web app, a staging slot, identity permissions, and diagnostics.

## Key inputs

- `plan_sku`, `worker_count`, and `zone_balancing_enabled` set compute capacity.
- `app_integration_subnet_id` connects outbound traffic to the virtual network.
- `deployment_runner_subnet_id` allows the runner to reach the staging slot.
- `front_door_profile_guid` restricts inbound traffic to the trusted Front Door profile.
- Registry, Key Vault, database, and Application Insights inputs configure the container.

## Outputs

The app ID, name, hostname, production identity, and staging identity.

## Important notes

App and SCM ingress default to deny. Run the staging `/healthz` check from the deployment runner before a slot swap.
The app uses managed identity for ACR pulls and Key Vault references.
