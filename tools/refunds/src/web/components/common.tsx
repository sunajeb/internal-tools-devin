import type { ReactNode } from 'react';
import { ShieldCheck, X, XCircle } from 'lucide-react';
import type { Message } from '../types.js';

export function AccessDenied() {
  return (
    <div className="page">
      <PageHeader
        kicker="ACCESS CONTROL"
        title="Access restricted"
        detail="Your role does not have permission to open this section."
      />
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  detail,
  action,
}: {
  kicker: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p className="page-detail">{detail}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({
  icon,
  label,
  value,
  delta,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  delta: string;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`} aria-hidden="true">
        {icon}
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-delta">{delta}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onClose}
      aria-label="Close dialog"
    >
      <X size={18} aria-hidden />
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().replaceAll(' ', '_');
  return (
    <span className={`status-badge status-${key}`}>
      <span aria-hidden="true" />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function Notice({
  message,
  onDismiss,
}: {
  message?: Message;
  onDismiss: () => void;
}) {
  if (!message) return null;
  const error = message.tone === 'error';
  return (
    <div
      className={`notice ${error ? 'notice-warn' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {error ? (
        <XCircle size={16} aria-hidden />
      ) : (
        <ShieldCheck size={16} aria-hidden />
      )}
      {message.text}
      <button type="button" aria-label="Dismiss message" onClick={onDismiss}>
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}
