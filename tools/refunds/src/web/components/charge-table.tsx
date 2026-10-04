import { Search } from 'lucide-react';
import { dateTime, money } from '@internal-tools/ui-kit';
import { EmptyState, StatusBadge } from './common.js';
import { TableStatusRow, SortHeader } from './table.js';
import type { Charge, ChargeSort } from '../types.js';

export function ChargeTable({
  charges,
  sort,
  onSort,
  onSelect,
  loading,
  error,
  onRetry,
}: {
  charges: Charge[];
  sort: ChargeSort;
  onSort: (sort: ChargeSort) => void;
  onSelect: (charge: Charge) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="table-scroll">
      <table aria-label="Payments">
        <thead>
          <tr>
            <th>PAYMENT</th>
            <th>CUSTOMER</th>
            <SortHeader
              label="AMOUNT"
              column="amount"
              sort={sort}
              onSort={onSort}
            />
            <th>REFUNDED</th>
            <th>STATUS</th>
            <SortHeader
              label="DATE"
              column="date"
              sort={sort}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {charges.map((charge) => (
            <tr
              key={charge.id}
              onClick={() => onSelect(charge)}
              className="clickable-row"
            >
              <td>
                <button
                  type="button"
                  className="row-link mono-id"
                  aria-label={`Open payment ${charge.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(charge);
                  }}
                >
                  {charge.id}
                </button>
                <small className="subline">
                  {charge.card_brand.toUpperCase()} ···· {charge.card_last4}
                </small>
              </td>
              <td>
                <b>{charge.customer_id}</b>
                <small className="subline">{charge.customer_email}</small>
              </td>
              <td className="amount-cell">
                {money(charge.amount_minor, charge.currency)}
              </td>
              <td>{money(charge.refunded_minor, charge.currency)}</td>
              <td>
                <StatusBadge
                  status={
                    Number(charge.refunded_minor)
                      ? 'partially refunded'
                      : 'paid'
                  }
                />
              </td>
              <td className="date-cell">{dateTime(charge.created_at)}</td>
            </tr>
          ))}
          {(!charges.length || Boolean(error)) && (
            <TableStatusRow
              colSpan={6}
              loading={loading}
              error={error}
              onRetry={onRetry}
              label="payments"
            >
              <EmptyState
                icon={<Search />}
                title="No payments found"
                detail="Try another payment, customer, email, or card number."
              />
            </TableStatusRow>
          )}
        </tbody>
      </table>
    </div>
  );
}
