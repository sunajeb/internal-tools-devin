import { useMutation } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  Check,
  Fingerprint,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  api,
  dateTime,
  ErrorState,
  LoadingState,
} from '@internal-tools/ui-kit';
import { PageHeader, EmptyState } from '../components/common.js';
import { useAuditEvents } from '../hooks.js';

export function Audit() {
  const { data, isLoading, error, refetch } = useAuditEvents();
  const verify = useMutation({
    mutationFn: () =>
      api<{ valid: boolean; eventCount?: number; firstBrokenEventId?: string }>(
        '/api/audit/verify',
      ),
  });
  return (
    <div className="page">
      <PageHeader
        kicker="FOUNDATION / GOVERNANCE"
        title="Audit & controls"
        detail="Review append-only events and verify the SHA-256 event chain."
        action={
          <button
            className="primary-btn"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
          >
            <ShieldCheck size={16} aria-hidden />
            {verify.isPending ? 'Verifying…' : 'Verify chain'}
          </button>
        }
      />
      {verify.error && (
        <div className="notice notice-warn" role="alert">
          <XCircle size={16} aria-hidden />
          The chain check did not run. {verify.error.message}
        </div>
      )}
      {verify.data && (
        <div
          className={`verify-banner ${verify.data.valid ? 'verified' : 'invalid'}`}
          role={verify.data.valid ? 'status' : 'alert'}
        >
          <div className="verify-icon" aria-hidden="true">
            {verify.data.valid ? <Check size={18} /> : <XCircle size={18} />}
          </div>
          <div>
            <b>
              {verify.data.valid
                ? 'Audit chain verified'
                : 'Audit chain integrity check failed'}
            </b>
            <span>
              {verify.data.valid
                ? `${verify.data.eventCount} events were verified. No changes were detected.`
                : `First broken event: ${verify.data.firstBrokenEventId}`}
            </span>
          </div>
          <span className="verify-time">
            {verify.data.valid ? 'VERIFIED JUST NOW' : 'ACTION REQUIRED'}
          </span>
        </div>
      )}
      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Recent audit events</h2>
            <p>Latest 100 events · immutable evidence</p>
          </div>
          <a className="secondary-btn" href="/api/audit?format=csv">
            <ArrowDownLeft size={15} aria-hidden /> Export audit CSV
          </a>
        </div>
        {error && (
          <ErrorState
            title="The audit events are not available"
            error={error}
            onRetry={() => void refetch()}
          />
        )}
        {isLoading && <LoadingState label="Loading audit events" />}
        {(data?.items ?? []).map((row) => (
          <div className="audit-row" key={row.seq}>
            <div className="audit-index">
              {String(row.seq).padStart(5, '0')}
            </div>
            <div className="audit-main">
              <b>{row.event_data.action.replaceAll(/[._]/g, ' ')}</b>
              <small>
                {row.event_data.actorId} <span aria-hidden="true">·</span>{' '}
                {row.event_data.objectType}{' '}
                {row.event_data.objectId.slice(0, 12)}
              </small>
            </div>
            <div className="audit-hash">
              <code>{row.hash.slice(0, 16)}…</code>
              <small>SHA-256 HASH</small>
            </div>
            <span className="date-cell">
              {dateTime(row.event_data.occurredAt)}
            </span>
          </div>
        ))}
        {data && !data.items.length && (
          <EmptyState
            icon={<Fingerprint />}
            title="No audit events yet"
            detail="Sign-ins, refunds, approvals, and policy actions will be recorded here."
          />
        )}
      </section>
    </div>
  );
}
