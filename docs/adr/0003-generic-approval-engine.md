# ADR 0003: One generic approval engine

Status: accepted.

## Context

Refunds and flag changes need approvals. Separation of duties must work the same way in each tool.

## Decision

Approval rules live in the Foundation (`packages/foundation/src/approvals.ts` and `runtime.ts`). A tool declares the steps, the roles for each step, the permission that approves and a policy version. The engine stores requests in `foundation.approval_requests` and decisions in `foundation.approvals`.

## Consequences

- The engine refuses self-approval and writes the audit event `approval.self_approval_denied`.
- Unique indexes stop one person from approving two steps and stop two approvals of one step.
- Steps complete in order. A later step is refused until the earlier steps are complete.
- Each request records the policy version and a content hash.
- Policy versions are stored in `foundation.policy_versions`. There is no user interface or API to propose or approve a policy change. Policy values change through a code review.
