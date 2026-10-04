import { useEffect, useRef } from 'react';
import type { PropsWithChildren } from 'react';
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
      const firstItem = items[0];
      const lastItem = items.at(-1);
      if (!firstItem || !lastItem) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
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
