import { useId } from 'react';
import { Check, Clock3, WalletCards } from 'lucide-react';
import { dateTime } from '@internal-tools/ui-kit';
import { StatusBadge } from './common.js';
import { approvalTitle } from '../formatting.js';
import type { User, Approval } from '../types.js';

export function ApprovalCard({
  item,
  user,
  onApprove,
  loading,
}: {
  item: Approval;
  user: User;
  onApprove: (index: number, decision: string) => void;
  loading: boolean;
}) {
  const steps = item.steps ?? [];
  const waiting = steps
    .map((step, index) => ({ step, index }))
    .filter(
      ({ step, index }) =>
        !step.approvals.length &&
        steps
          .slice(0, index)
          .every((previous) => previous.approvals.length > 0) &&
        step.roles.some((role) => user.roles.includes(role)),
    );
  const selfApproval = item.requester_id === user.id;
  const titleId = useId();
  const title = approvalTitle(item);
  const requestName = item.charge_id ? `${title} for ${item.charge_id}` : title;
  return (
    <article className="approval-card" aria-labelledby={titleId}>
      <div className="approval-card-main">
        <div className="approval-symbol" aria-hidden="true">
          <WalletCards size={18} />
        </div>
        <div className="approval-copy">
          <div className="approval-title">
            <h3 id={titleId}>{title}</h3>
            <StatusBadge status={item.tier} />
          </div>
          <div className="approval-meta">
            {item.charge_id && (
              <>
                Payment <span className="mono-id">{item.charge_id}</span>
                <span className="meta-dot" aria-hidden="true">
                  ·
                </span>{' '}
              </>
            )}
            submitted by <b>{item.requester_id}</b>
            <span className="meta-dot" aria-hidden="true">
              ·
            </span>
            {dateTime(item.created_at)}
          </div>
          <p>{item.note}</p>
          <div className="approval-steps" aria-label="Approval steps">
            {steps.map((step, index) => (
              <span
                key={index}
                className={step.approvals.length ? 'step-done' : 'step-wait'}
              >
                {step.approvals.length ? (
                  <Check size={12} aria-hidden />
                ) : (
                  <Clock3 size={12} aria-hidden />
                )}
                {step.roles[0]}
                {step.approvals.length ? ' approved' : ' approval'}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="approval-actions">
        {selfApproval && (
          <span className="muted">
            Requesters cannot approve their own refund.
          </span>
        )}
        <button
          type="button"
          className="decline-btn"
          disabled={loading || selfApproval}
          aria-label={`Decline ${requestName}`}
          onClick={() => onApprove(waiting[0]?.index ?? 0, 'reject')}
        >
          Decline
        </button>
        {waiting.map(({ step, index }) => (
          <button
            key={index}
            type="button"
            className="primary-btn small-btn"
            disabled={loading || selfApproval}
            aria-label={`Approve as ${step.roles[0]}: ${requestName}`}
            onClick={() => onApprove(index, 'approve')}
          >
            Approve as {step.roles[0]}
          </button>
        ))}
      </div>
    </article>
  );
}
