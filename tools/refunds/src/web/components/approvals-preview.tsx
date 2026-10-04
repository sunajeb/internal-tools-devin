import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { dateTime, LoadingState } from '@internal-tools/ui-kit';
import { approvalTitle } from '../formatting.js';
import { useRefundApprovals } from '../hooks.js';

export function ApprovalsPreview() {
  const { data, isLoading, error } = useRefundApprovals();
  return (
    <div className="preview-list">
      {(data?.items ?? []).slice(0, 3).map((item) => (
        <Link to="/approvals" key={item.approval_id} className="preview-item">
          <span className="preview-avatar" aria-hidden="true">
            {item.requester_id.slice(0, 1).toUpperCase()}
          </span>
          <span className="preview-copy">
            <b>{approvalTitle(item)}</b>
            <small>
              {item.requester_id} · {item.tier} review
            </small>
          </span>
          <span className="preview-time">
            {dateTime(item.created_at).split(',')[0]}
          </span>
        </Link>
      ))}
      {isLoading && <LoadingState label="Loading approvals" />}
      {error && (
        <div className="quiet-empty" role="alert">
          The approval queue is not available.
        </div>
      )}
      {data && !data.items.length && (
        <div className="quiet-empty">No pending approvals in your queue.</div>
      )}
      <Link to="/approvals" className="queue-link">
        Open approval inbox <ArrowUpRight size={13} aria-hidden />
      </Link>
    </div>
  );
}
