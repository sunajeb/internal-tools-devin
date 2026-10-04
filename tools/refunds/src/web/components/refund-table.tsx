import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WalletCards } from 'lucide-react';
import { api, dateTime, money } from '@internal-tools/ui-kit';
import { EmptyState, StatusBadge } from './common.js';
import { TableStatusRow } from './table.js';
import type { Refund } from '../types.js';

export function RefundTable({
  compact = false,
  filter = 'all',
  items: passedItems,
  loading,
  error,
  onRetry,
  onSelect,
}: {
  compact?: boolean;
  filter?: string;
  items?: Refund[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onSelect?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const own = useQuery({
    queryKey: ['refunds'],
    queryFn: () => api<{ items: Refund[] }>('/api/refunds'),
    enabled: !passedItems,
  });
  const items = (passedItems ?? own.data?.items ?? [])
    .filter((item) => filter === 'all' || item.status === filter)
    .slice(0, compact ? 6 : 100);
  const open = (id: string) =>
    onSelect ? onSelect(id) : navigate(`/refunds?id=${encodeURIComponent(id)}`);
  const tableLoading = passedItems ? loading : own.isLoading;
  const tableError = passedItems ? error : own.error;
  return (
    <div className="table-scroll">
      <table aria-label={compact ? 'Recent refunds' : 'Refunds'}>
        <thead>
          <tr>
            <th>REFUND</th>
            <th>PAYMENT</th>
            <th>AMOUNT</th>
            <th>REQUESTED BY</th>
            <th>STATUS</th>
            <th>CREATED</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="clickable-row"
              onClick={() => open(item.id)}
            >
              <td>
                <button
                  type="button"
                  className="row-link mono-id"
                  aria-label={`Open refund ${item.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    open(item.id);
                  }}
                >
                  {item.id.slice(0, 8)}…
                </button>
                <small className="subline">
                  {item.reason_code.replaceAll('_', ' ')}
                </small>
              </td>
              <td>
                <span className="mono-id">{item.charge_id}</span>
              </td>
              <td className="amount-cell">
                {money(item.amount_minor, item.currency)}
              </td>
              <td>{item.requester_id}</td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td className="date-cell">{dateTime(item.created_at)}</td>
            </tr>
          ))}
          {(!items.length || Boolean(tableError)) && (
            <TableStatusRow
              colSpan={6}
              loading={tableLoading}
              error={tableError}
              onRetry={onRetry ?? (() => void own.refetch())}
              label="refunds"
            >
              <EmptyState
                icon={<WalletCards />}
                title="No refunds in this view"
                detail="New refund requests will appear here."
              />
            </TableStatusRow>
          )}
        </tbody>
      </table>
    </div>
  );
}
