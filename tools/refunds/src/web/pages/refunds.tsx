import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownLeft } from 'lucide-react';
import { PageHeader } from '../components/common.js';
import { RefundTable } from '../components/refund-table.js';
import { RefundTimelineDialog } from '../components/refund-timeline-dialog.js';
import type { User } from '../types.js';
import { useRefunds } from '../hooks.js';
import { can } from '../permissions.js';

export function Refunds({ user }: { user: User }) {
  const [filter, setFilter] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useRefunds(filter);
  const items = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) => filter === 'all' || item.status === filter,
      ),
    [data, filter],
  );
  return (
    <div className="page">
      <PageHeader
        kicker="PAYMENTS / REFUNDS"
        title="Refunds"
        detail="Review refund requests, monitor execution, and open a complete audit timeline."
        action={
          can(user, 'refund.export') ? (
            <a className="secondary-btn" href="/api/refunds?format=csv">
              <ArrowDownLeft size={15} aria-hidden /> Export CSV
            </a>
          ) : undefined
        }
      />
      <div className="tabs" role="group" aria-label="Filter refunds by status">
        {['all', 'pending_approval', 'approved', 'succeeded', 'failed'].map(
          (item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item === 'all' ? 'All refunds' : item.replaceAll('_', ' ')}
            </button>
          ),
        )}
      </div>
      <section className="panel table-panel">
        <RefundTable
          filter={filter}
          items={items}
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          onSelect={(id) => setSearchParams({ id })}
        />
      </section>
      {searchParams.get('id') && (
        <RefundTimelineDialog
          id={searchParams.get('id')!}
          onClose={() => setSearchParams({})}
        />
      )}
    </div>
  );
}
