import { useEffect, useId, useRef } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
export {
  api,
  dateTime,
  decimalToMinor,
  minorToDecimal,
  minorUnitDigits,
  money,
} from './api.js';

export const mainContentId = 'main-content';

export function Layout({ children }: PropsWithChildren) {
  return (
    <main id={mainContentId} className="shared-layout" tabIndex={-1}>
      {children}
    </main>
  );
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

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Dialog({
  children,
  onClose,
  labelledBy,
  label,
  className = 'modal-card',
}: PropsWithChildren<{
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  className?: string;
}>) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    const first =
      dialog?.querySelector<HTMLElement>('[data-autofocus]') ??
      dialog?.querySelector<HTMLElement>(focusableSelector);
    (first ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      if (!items.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === firstItem || active === dialogRef.current)
      ) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}

export function ConfirmDialog({
  title,
  children,
  onClose = () => undefined,
}: PropsWithChildren<{ title: string; onClose?: () => void }>) {
  const titleId = useId();
  return (
    <Dialog labelledBy={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </Dialog>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading" role="status">
      <span className="loader" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : 'The service did not respond.';
  return (
    <div className="error-state" role="alert">
      <b>{title}</b>
      <span>{detail}</span>
      {onRetry && (
        <button
          type="button"
          className="secondary-btn compact-btn"
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </div>
  );
}
