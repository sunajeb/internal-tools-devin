import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Check } from 'lucide-react';
import {
  api,
  dateTime,
  Dialog,
  ErrorState,
  LoadingState,
} from '@internal-tools/ui-kit';
import {
  PageHeader,
  EmptyState,
  CloseButton,
  Notice,
} from '../components/common.js';
import { humanizeKey, formatDetail } from '../formatting.js';
import type { User, Message } from '../types.js';
import { useExceptions } from '../hooks.js';

export function Exceptions({ user }: { user: User }) {
  const client = useQueryClient();
  const titleId = useId();
  const { data, isLoading, error, refetch } = useExceptions();
  const [message, setMessage] = useState<Message>();
  const [resolvingId, setResolvingId] = useState<string>();
  const [resolutionCode, setResolutionCode] = useState(
    'provider_record_confirmed',
  );
  const [resolutionNote, setResolutionNote] = useState('');
  const resolve = useMutation({
    mutationFn: ({
      id,
      resolutionCode: code,
      note,
    }: {
      id: string;
      resolutionCode: string;
      note: string;
    }) =>
      api(`/api/exceptions/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolutionCode: code, note }),
      }),
    onSuccess: () => {
      setMessage({ tone: 'success', text: 'Exception marked as resolved.' });
      setResolvingId(undefined);
      setResolutionNote('');
      client.invalidateQueries();
    },
    onError: (caught: Error) =>
      setMessage({ tone: 'error', text: caught.message }),
  });
  const run = useMutation({
    mutationFn: () =>
      api('/api/reconciliation/run', { method: 'POST', body: '{}' }),
    onSuccess: () =>
      setMessage({
        tone: 'success',
        text: 'Reconciliation queued. Results will appear in this view.',
      }),
    onError: (caught: Error) =>
      setMessage({ tone: 'error', text: caught.message }),
  });
  return (
    <div className="page">
      <PageHeader
        kicker="PAYMENTS / RECONCILIATION"
        title="Reconciliation"
        detail="Compare internal refund records with provider records. Resolve differences with an audited reason."
        action={
          user.roles.includes('finance') ? (
            <button
              className="secondary-btn"
              onClick={() => run.mutate()}
              disabled={run.isPending}
            >
              <Activity size={15} aria-hidden />{' '}
              {run.isPending ? 'Queueing…' : 'Run reconciliation'}
            </button>
          ) : undefined
        }
      />
      <Notice message={message} onDismiss={() => setMessage(undefined)} />
      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Open exceptions</h2>
            <p>{data ? data.items.length : '—'} items need Finance review</p>
          </div>
          <span className="exception-pill">
            <span aria-hidden="true" /> OPEN
          </span>
        </div>
        {error && (
          <ErrorState
            title="The exceptions are not available"
            error={error}
            onRetry={() => void refetch()}
          />
        )}
        {isLoading && <LoadingState label="Loading exceptions" />}
        {(data?.items ?? []).map((item) => (
          <div className="exception-row" key={item.id}>
            <div className="exception-type">
              <div className="exception-icon" aria-hidden="true">
                <Activity size={17} />
              </div>
              <div>
                <b>{item.exception_type.replaceAll('_', ' ')}</b>
                <small>Key: {item.reconciliation_key}</small>
              </div>
            </div>
            <dl className="exception-detail">
              {Object.entries(item.details).map(([key, value]) => (
                <div key={key}>
                  <dt>{humanizeKey(key)}</dt>
                  <dd>{formatDetail(key, value, item.details)}</dd>
                </div>
              ))}
            </dl>
            <span className="date-cell">{dateTime(item.created_at)}</span>
            {user.roles.includes('finance') && (
              <button
                type="button"
                className="secondary-btn compact-btn"
                aria-label={`Resolve ${item.exception_type.replaceAll('_', ' ')} for ${item.reconciliation_key}`}
                onClick={() => setResolvingId(item.id)}
                disabled={resolve.isPending}
              >
                Resolve
              </button>
            )}
          </div>
        ))}
        {data && !data.items.length && (
          <EmptyState
            icon={<Check />}
            title="No open exceptions"
            detail="Internal refunds match the provider records."
          />
        )}
      </section>
      {resolvingId && (
        <Dialog onClose={() => setResolvingId(undefined)} labelledBy={titleId}>
          <div className="modal-head">
            <div>
              <p className="eyebrow">RECONCILIATION REVIEW</p>
              <h2 id={titleId}>Resolve exception</h2>
            </div>
            <CloseButton onClose={() => setResolvingId(undefined)} />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              resolve.mutate({
                id: resolvingId,
                resolutionCode,
                note: resolutionNote,
              });
            }}
          >
            <label className="resolution-field">
              Resolution code
              <input
                value={resolutionCode}
                onChange={(event) => setResolutionCode(event.target.value)}
                minLength={2}
                maxLength={64}
                required
              />
            </label>
            <label className="resolution-field">
              Review note
              <textarea
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                minLength={10}
                maxLength={1000}
                aria-describedby="resolution-note-hint"
                placeholder="Describe the evidence reviewed and the outcome."
                required
              />
            </label>
            <p className="field-hint" id="resolution-note-hint">
              Enter 10 to 1,000 characters. The audit trail keeps this note.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setResolvingId(undefined)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-btn"
                disabled={
                  resolve.isPending ||
                  resolutionCode.trim().length < 2 ||
                  resolutionNote.trim().length < 10
                }
              >
                {resolve.isPending ? 'Saving…' : 'Confirm resolution'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
