import { useId } from 'react';
import {
  dateTime,
  Dialog,
  ErrorState,
  LoadingState,
  money,
} from '@internal-tools/ui-kit';
import { Detail, CloseButton, StatusBadge } from './common.js';
import { timelineLabel } from '../formatting.js';
import { useRefund } from '../hooks.js';

export function RefundTimelineDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const { data, isLoading, error, refetch } = useRefund(id);
  return (
    <Dialog onClose={onClose} labelledBy={titleId}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">REFUND TIMELINE</p>
          <h2 id={titleId}>{data?.id ?? id}</h2>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      {error ? (
        <ErrorState
          title="The refund is not available"
          error={error}
          onRetry={() => void refetch()}
        />
      ) : isLoading || !data ? (
        <LoadingState label="Loading refund history" />
      ) : (
        <>
          <div className="detail-highlight">
            <div>
              <span>Amount</span>
              <b>{money(data.amount_minor, data.currency)}</b>
            </div>
            <div>
              <span>Current status</span>
              <b>
                <StatusBadge status={data.status} />
              </b>
            </div>
          </div>
          <div className="detail-list">
            <Detail label="Payment" value={data.charge_id} />
            <Detail label="Requested by" value={data.requester_id} />
            <Detail
              label="Reason"
              value={data.reason_code.replaceAll('_', ' ')}
            />
          </div>
          <h3 className="section-subtitle">Activity</h3>
          <ol className="timeline-list" aria-label="Refund activity">
            {(data.timeline ?? []).map((event, index) => (
              <li className="timeline-event" key={`${event.action}-${index}`}>
                <span className="timeline-dot" aria-hidden="true" />
                <div>
                  <b>{timelineLabel(event)}</b>
                  <small>
                    {event.actorId}
                    {event.actorRoles?.length
                      ? ` (${event.actorRoles.join(', ')})`
                      : ''}{' '}
                    · {dateTime(event.occurredAt)}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          {!data.timeline?.length && (
            <p className="empty-inline">No activity is recorded yet.</p>
          )}
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
