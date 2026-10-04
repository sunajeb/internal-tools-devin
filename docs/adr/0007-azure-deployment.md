# ADR 0007: Azure production path

Status: accepted.

## Context

The company hosts production on Azure. The prototype must not create cloud resources or cost.

## Decision

- Run the prototype with Docker Compose only.
- Keep Azure Terraform in `infra/terraform` for `dev`, `staging` and `prod`.
- CI (`.github/workflows/terraform.yml`) runs `terraform fmt -check`, `terraform validate`, TFLint and Trivy. CI does not run `terraform plan` or `terraform apply`.

## Consequences

- The Terraform is validated only. Nobody has applied it. There is no live Azure deployment.
- There is no measured cost, no measured performance and no tested disaster recovery.
- The subscription, the state backend, the apply pipeline and its approvals are client-owned.
