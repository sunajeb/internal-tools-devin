# Internal Tools Foundation — Azure Terraform

**Validated in CI. Not applied. This prototype creates no cloud resources.**

## Topology

```mermaid
flowchart TD
  Users --> FD["Front Door Premium + WAF"]
  FD --> Web["Web App production and staging slots"]
  Web --> VNet["Virtual network"]
  VNet --> AppSubnet["App integration subnet"]
  VNet --> WorkerSubnet["Worker subnet"]
  AppSubnet --> PG["Private PostgreSQL Flexible Server"]
  WorkerSubnet --> PG
  PG --> HA["Zone-redundant HA in production"]
  AppSubnet --> KVPE["Key Vault private endpoint"]
  WorkerSubnet --> KVPE
  AppSubnet --> BlobPE["WORM storage private endpoint"]
  WorkerSubnet --> BlobPE
  ACR["Premium Container Registry"] -->|"Managed identity pull"| Web
  ACR -->|"Managed identity pull"| Worker["Private worker App Service"]
  Web --> LAW["Log Analytics and Application Insights"]
  Worker --> LAW
  PG --> LAW
  FD --> LAW
  OIDC["Entra ID OIDC application"] --> Web
```

## Modules

| Module | Purpose |
| --- | --- |
| `network` | Virtual network, app, data, and deployment runner subnets, security groups, and private DNS |
| `postgres` | Private PostgreSQL Flexible Server, database, Entra administrator, and diagnostics |
| `app_service` | Web app, staging slot, Front Door ingress restriction, and ACR permissions |
| `worker` | Private worker App Service with managed identity |
| `registry` | Premium Azure Container Registry |
| `key_vault` | Private Key Vault, role assignments, and diagnostics |
| `monitoring` | Log Analytics, Application Insights, and action group |
| `alerts` | Web, database, and outbox metric alerts |
| `storage_worm` | Private immutable audit-anchor storage |
| `front_door` | Front Door Premium, WAF, HTTPS route, and diagnostics |
| `identity` | Entra OIDC application, allowed-group assignments, and rotating client secret |

Each environment defines its own backend key and resource settings. The `dev`, `staging`, and `prod` roots use separate state.

## Design decisions

The registry keeps public network access so GitHub-hosted runners can push images. Admin user and anonymous pull remain disabled.
The client can move the registry behind a private endpoint and use self-hosted runners.

## Local validation

Install Terraform 1.16.5, TFLint 0.64.0, and Trivy 0.75.0. TFLint uses the AzureRM ruleset 0.32.0.
Run these commands from `infra/terraform`:

```sh
terraform version
terraform fmt -check -recursive
for env in dev staging prod; do
  terraform -chdir="envs/$env" init -backend=false -input=false
  terraform -chdir="envs/$env" validate
done
tflint --init
tflint --recursive --config "$PWD/.tflint.hcl"
trivy config --severity HIGH,CRITICAL --exit-code 1 .
trivy config .
```

These checks do not create cloud resources. Never run `terraform plan` or `terraform apply` from this prototype workspace.

## State, plan, and apply

1. Bootstrap a dedicated Azure storage account and private state container.
2. Replace backend placeholders in each environment, or pass `-backend-config` values to `terraform init`.
3. Use a separate state key for each environment. Keep state access restricted and enable storage versioning.
4. Run a plan in the pull request pipeline. Review the complete plan before approval.
5. Configure a deployment pipeline with GitHub environment `prod` and required reviewers.
6. Add an OIDC federated credential for the deployment pipeline. Do not store Azure credentials in GitHub secrets.
7. Run apply only from the approved deployment pipeline after manual approval.
8. Run the apply job from a self-hosted runner in the deployment runner subnet. Key Vault and storage disable public access.
   Requests from the runner subnet reach the staging slot directly. They do not go through the Front Door WAF or rate limit. Put only the approved apply runner in this subnet.

The client owns state storage, access control, recovery, and retention. This repository does not provision or apply the backend.

## Post-apply steps

1. Create the `session-secret` value in Key Vault outside Terraform.
2. Connect to PostgreSQL with an Entra administrator. Create web app, staging slot, and worker principals with `pgaadauth_create_principal`.
3. Push the first application image to ACR from an authorized GitHub-hosted runner.
4. Deploy each release to the staging slot. Run `/healthz` from the deployment runner before swapping slots.
5. Confirm the production slot serves traffic. Keep the previous slot available for rollback.

The app must emit `outbox_failed_total` as an OpenTelemetry counter through the Azure Monitor exporter. The exporter sends the increment for each interval (delta temporality). The alert adds the values in a 10-minute window and fires when the total is more than 0.

## Client-owned controls

- Provide the Azure subscription, landing zone, network ranges, and resource policies.
- Bootstrap the state storage account and define its access and recovery policies.
- Grant tenant admin consent for the Microsoft Graph permissions.
- Own the Entra security groups that may sign in.
- Own DNS, the custom domain, and TLS certificates when configured.
- Maintain action group recipients and on-call coverage.
- Review service cost and capacity. Run PostgreSQL backup restore drills.
- Run an approved apply at least monthly to rotate the OIDC password on time.
- The password expires 180 days after its rotation due time. Restrict Terraform state access.

## Security controls

| Control | Implementation | File |
| --- | --- | --- |
| Private database | Delegated subnet, disabled public access, and explicit NSG rules | `modules/postgres/main.tf`, `modules/network/main.tf` |
| Point-in-time recovery | 35-day backup retention and geo-redundant backup | `modules/postgres/main.tf` |
| High availability | Zone-redundant PostgreSQL only in production | `envs/prod/main.tf`, `modules/postgres/main.tf` |
| WORM audit anchors | 30-day deletion recovery, immutable container, seven-year production retention | `modules/storage_worm/main.tf` |
| Web application firewall | Front Door Premium managed rules and request rate limiting | `modules/front_door/main.tf` |
| Secret storage | Private Key Vault, RBAC, and Key Vault references | `modules/key_vault/main.tf`, `modules/app_service/main.tf` |
| Managed identities | ACR pull role assignments; no registry admin credentials | `modules/app_service/main.tf`, `modules/worker/main.tf`, `modules/registry/main.tf` |
| Zero-downtime release | Staging slot and documented warm-up and swap process | `modules/app_service/main.tf` |
| TLS 1.2 | Web and worker minimum TLS, storage minimum TLS, HTTPS ingress | `modules/app_service/main.tf`, `modules/worker/main.tf`, `modules/storage_worm/main.tf` |
| Centralized logs and alerts | Diagnostic settings, Log Analytics, App Insights, and alerts | `modules/monitoring/main.tf`, `modules/alerts/main.tf` |
| Entra SSO | OIDC app, group claims, and single-tenant audience | `modules/identity/main.tf` |

## Scanner exceptions

| Finding | Reason | File |
| --- | --- | --- |
| `AZU-0001` | Front Door restricts web ingress. The worker is private and has no client-facing endpoint. | `modules/app_service/main.tf`, `modules/worker/main.tf` |
| `AZU-0003` | The Node service owns OIDC. App Service authentication would duplicate it. The worker is not user-facing. | `modules/app_service/main.tf`, `modules/worker/main.tf` |
| `AZU-0017` | The Key Vault secret expiry comes from the rotating Entra password. Trivy cannot evaluate that expression. | `modules/identity/main.tf` |
| `AZU-0057` | Blob diagnostics use a separate diagnostic setting. The scanner checks account-level properties. | `modules/storage_worm/main.tf` |
| `AZU-0058` | Development and staging use required ZRS replication. Production uses GZRS. | `modules/storage_worm/main.tf` |
| `AZU-0060` | This prototype uses platform-managed keys. The client owns future CMK provisioning and rotation. | `modules/storage_worm/main.tf` |
| TFLint `azurerm_app_service_missing_auto_heal_setting` | Health check eviction replaces unhealthy instances. A request-count trigger recycles healthy instances. | `modules/app_service/main.tf`, `modules/worker/main.tf` |

Each exception has a reason beside its inline Trivy or TFLint directive.
