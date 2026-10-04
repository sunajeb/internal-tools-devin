import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, SlidersHorizontal } from 'lucide-react';
import { api, ErrorState, LoadingState } from '@internal-tools/ui-kit';
import { ApprovalCard } from '../components/approval-card.js';
import { PageHeader, EmptyState, Notice } from '../components/common.js';
import type { User, Message } from '../types.js';
import { useRefundApprovals } from '../hooks.js';

export function Approvals({ user }: { user: User }) {
  const client = useQueryClient();
  const { data, isLoading, error, refetch } = useRefundApprovals();
  const [message, setMessage] = useState<Message>();
  const approve = useMutation({
    mutationFn: ({
      id,
      stepIndex,
      decision,
    }: {
      id: string;
      stepIndex: number;
      decision: string;
    }) =>
      api(
        `/api/approvals/${id}/${decision === 'reject' ? 'reject' : 'approve'}`,
        {
          method: 'POST',
          body: JSON.stringify({ stepIndex, decision }),
        },
      ),
    onSuccess: (_result, { decision }) => {
      setMessage({
        tone: 'success',
        text:
          decision === 'reject'
            ? 'Decline recorded. The request is closed.'
            : 'Approval recorded. The request has been updated.',
      });
      client.invalidateQueries();
    },
    onError: (caught: Error) =>
      setMessage({ tone: 'error', text: caught.message }),
  });
  return (
    <div className="page">
      <PageHeader
        kicker="PAYMENTS / REVIEW QUEUE"
        title="Approval inbox"
        detail="Review actions that require a second person. Self-approval is blocked by the server."
        action={
          <span className="inbox-count">
            {data ? data.items.length : '—'} OPEN REQUESTS
          </span>
        }
      />
      <Notice message={message} onDismiss={() => setMessage(undefined)} />
      <section className="panel inbox-panel">
        <div className="panel-head">
          <div>
            <h2>Waiting for your review</h2>
            <p>Approval steps must complete in policy order.</p>
          </div>
          <div className="filter-chip">
            <SlidersHorizontal size={14} aria-hidden /> All roles
          </div>
        </div>
        {error && (
          <ErrorState
            title="The approval requests are not available"
            error={error}
            onRetry={() => void refetch()}
          />
        )}
        {isLoading && <LoadingState label="Loading approval requests" />}
        {(data?.items ?? []).map((item) => (
          <ApprovalCard
            key={item.approval_id}
            item={item}
            user={user}
            onApprove={(stepIndex, decision) =>
              approve.mutate({ id: item.approval_id, stepIndex, decision })
            }
            loading={approve.isPending}
          />
        ))}
        {data && !data.items.length && (
          <EmptyState
            icon={<Check />}
            title="You are all caught up"
            detail="There are no requests waiting for an approval you can provide."
          />
        )}
      </section>
    </div>
  );
}
