# ADR 0011: Shared design system

Status: accepted.

## Context

Each tool needs tables, forms, approval inboxes and audit views. Tools must look the same and meet WCAG 2.2 AA.

## Decision

- Put shared React controls in `packages/ui-kit` (`Layout`, `DataTable`, `Form`, `ApprovalInbox`, `AuditViewer`, `MaskedField`, `Dialog`, `ConfirmDialog`, `LoadingState`, `ErrorState`).
- Put design tokens in `apps/web/src/style.css`: the Inter variable font, warm neutral colors (for example `--ink: #37352f` and `--sidebar: #f7f7f5`), spacing and focus styles.
- Run axe checks in `e2e/specs/accessibility.spec.ts`. The CI end-to-end job fails on a serious or critical violation.

## Consequences

- A new tool gets the layout, the styles and the accessible controls without new CSS.
- A token change affects all tools. Review it with screenshots of each tool.
- Axe finds only part of the WCAG issues. Keyboard and screen-reader checks stay manual.
