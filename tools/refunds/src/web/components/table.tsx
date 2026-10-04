import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { ErrorState, LoadingState } from '@internal-tools/ui-kit';
import type { ChargeSort } from '../types.js';

export function TableStatusRow({
  colSpan,
  loading,
  error,
  onRetry,
  label,
  children,
}: {
  colSpan: number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        {error ? (
          <ErrorState
            title={`The ${label} are not available`}
            error={error}
            onRetry={onRetry}
          />
        ) : loading ? (
          <LoadingState label={`Loading ${label}`} />
        ) : (
          children
        )}
      </td>
    </tr>
  );
}

export function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: 'date' | 'amount';
  sort: ChargeSort;
  onSort: (sort: ChargeSort) => void;
}) {
  const active = sort.startsWith(column);
  const ascending = sort.endsWith('asc');
  const next = (
    active && !ascending ? `${column}_asc` : `${column}_desc`
  ) as ChargeSort;
  return (
    <th aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort-btn" onClick={() => onSort(next)}>
        {label}
        {!active ? (
          <ArrowUpDown size={11} aria-hidden />
        ) : ascending ? (
          <ArrowUp size={11} aria-hidden />
        ) : (
          <ArrowDown size={11} aria-hidden />
        )}
      </button>
    </th>
  );
}
