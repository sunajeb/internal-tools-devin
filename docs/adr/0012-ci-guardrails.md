# ADR 0012: CI guardrails for agent-written code

Status: accepted.

## Context

An AI agent writes much of the tool code. Reviewers need automatic checks before they read a pull request.

## Decision

- `scripts/new-tool.ts` generates a new tool with the correct shape. `scripts/check-new-tool.sh` generates a tool in a temporary copy, then runs the type check, the tests and ESLint on it.
- `.github/workflows/ci.yml` runs lint, type check, unit and integration tests, end-to-end and axe tests, and dependency-cruiser.
- The security job runs `npm audit --audit-level=high`, Semgrep and gitleaks.
- The image job runs Trivy on the container images and creates an SPDX SBOM.
- `.github/workflows/terraform.yml` validates the Terraform.

## Consequences

- A generated tool that does not compile or does not pass its tests fails CI.
- The checks find known patterns only. They do not find a wrong business rule. A human review of each pull request is still necessary.
- The scans add time to each CI run.
