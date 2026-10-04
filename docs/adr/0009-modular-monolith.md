# ADR 0009: Modular monolith

Status: accepted.

## Context

The company will build many internal tools. One service for each tool increases the operations cost for each new tool.

## Decision

- Deploy one stack: one API, one worker and one web console. Each tool is a module in `tools/<id>`.
- Each tool has its own database schema (for example `refunds` and `feature_flags`). The Foundation uses the `foundation` schema.
- The dependency-cruiser rule `no-cross-tool-imports` in `.dependency-cruiser.cjs` stops a tool from importing another tool. Shared code goes in `packages/`. CI runs this rule.

## Consequences

- A new tool adds code and a migration. It adds no infrastructure.
- All tools share one database role, `app_runtime`. This role can read and write each tool schema. A defect or an injection in one tool can affect the data of other tools. This is a known blast radius. A split into one role for each schema is a later step.
- All tools share one release. A defect in one tool can block the release of other tools.
