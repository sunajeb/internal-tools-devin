import type { PropsWithChildren, ReactNode } from 'react';

export function Layout({ children }: PropsWithChildren) {
  return <main className="shared-layout">{children}</main>;
}

export function DataTable<T>({
  rows,
  renderRow,
}: {
  rows: T[];
  renderRow: (row: T) => ReactNode;
}) {
  return (
    <div className="shared-data-table">
      {rows.map((row, index) => (
        <div key={index}>{renderRow(row)}</div>
      ))}
    </div>
  );
}

export function Form({
  children,
  onSubmit,
}: PropsWithChildren<{ onSubmit: () => void }>) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

export function ApprovalInbox({ children }: PropsWithChildren) {
  return <section aria-label="Approval inbox">{children}</section>;
}

export function AuditViewer({
  events,
}: {
  events: Array<{ id: string; action: string }>;
}) {
  return (
    <ol>
      {events.map((event) => (
        <li key={event.id}>{event.action}</li>
      ))}
    </ol>
  );
}

export function MaskedField({
  value,
  masked = '••••••••',
}: {
  value: string;
  masked?: string;
}) {
  return <span>{masked || value}</span>;
}

export function ConfirmDialog({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <section role="dialog" aria-modal="true">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
