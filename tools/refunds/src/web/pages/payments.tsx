import { useId, useState } from 'react';
import { ArrowUpRight, Search, SlidersHorizontal } from 'lucide-react';
import { decimalToMinor } from '@internal-tools/ui-kit';
import { ChargeDialog } from '../components/charge-dialog.js';
import { ChargeTable } from '../components/charge-table.js';
import { PageHeader } from '../components/common.js';
import { RefundDialog } from '../components/refund-dialog.js';
import type { User, Charge, ChargeSort } from '../types.js';
import { useCharges } from '../hooks.js';

export function Payments({ user }: { user: User }) {
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [sort, setSort] = useState<ChargeSort>('date_desc');
  const [selected, setSelected] = useState<Charge | null>(null);
  const [requestCharge, setRequestCharge] = useState<Charge | null>(null);
  const filterPanelId = useId();
  const minMinor = decimalToMinor(minAmount) ?? '';
  const maxMinor = decimalToMinor(maxAmount) ?? '';
  const amountFilterInvalid =
    (minAmount !== '' && !minMinor) || (maxAmount !== '' && !maxMinor);
  const amountRangeInvalid =
    Boolean(minMinor && maxMinor) && BigInt(minMinor) > BigInt(maxMinor);
  const { data, isFetching, isLoading, error, refetch } = useCharges({
    query,
    from,
    to,
    minMinor,
    maxMinor,
    sort,
    cursor,
  });
  return (
    <div className="page">
      <PageHeader
        kicker="PAYMENTS / SEARCH"
        title="Payments"
        detail="Search the full payment ledger. Results use database filters and keyset pagination."
      />
      <section className="panel table-panel">
        <div className="toolbar">
          <label className="searchbox">
            <Search size={17} aria-hidden />
            <input
              aria-label="Search payments"
              placeholder="Search charge, customer, email or last 4…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(undefined);
              }}
            />
          </label>
          <button
            className="secondary-btn"
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={filterPanelId}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} aria-hidden /> Filters
          </button>
          <span className="result-count" role="status">
            {isFetching
              ? 'Searching…'
              : error
                ? 'Search failed'
                : `${data?.items.length ?? 0} records`}
          </span>
        </div>
        {filtersOpen && (
          <div className="filter-panel" id={filterPanelId}>
            <label>
              From
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setCursor(undefined);
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setCursor(undefined);
                }}
              />
            </label>
            <label>
              Minimum amount
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                aria-invalid={amountFilterInvalid || amountRangeInvalid}
                aria-describedby={`${filterPanelId}-hint`}
                value={minAmount}
                onChange={(event) => {
                  setMinAmount(event.target.value);
                  setCursor(undefined);
                }}
              />
            </label>
            <label>
              Maximum amount
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                aria-invalid={amountFilterInvalid || amountRangeInvalid}
                aria-describedby={`${filterPanelId}-hint`}
                value={maxAmount}
                onChange={(event) => {
                  setMaxAmount(event.target.value);
                  setCursor(undefined);
                }}
              />
            </label>
            <p
              className={
                amountFilterInvalid || amountRangeInvalid
                  ? 'field-error'
                  : 'field-hint'
              }
              id={`${filterPanelId}-hint`}
              role={
                amountFilterInvalid || amountRangeInvalid ? 'alert' : undefined
              }
            >
              {amountFilterInvalid
                ? 'Enter amounts as numbers with up to two decimals, for example 25.50. The filter ignores other values.'
                : amountRangeInvalid
                  ? 'The minimum amount is more than the maximum amount.'
                  : 'Amounts use the payment currency, for example 25.50.'}
            </p>
            <button
              type="button"
              className="secondary-btn compact-btn"
              onClick={() => {
                setFrom('');
                setTo('');
                setMinAmount('');
                setMaxAmount('');
                setCursor(undefined);
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        <ChargeTable
          sort={sort}
          onSort={(next) => {
            setSort(next);
            setCursor(undefined);
          }}
          charges={data?.items ?? []}
          onSelect={setSelected}
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
        />
        <div className="pagination">
          <span>
            {cursor
              ? 'Showing the next result page.'
              : 'Showing the latest results.'}
          </span>
          {cursor && (
            <button
              type="button"
              className="secondary-btn compact-btn"
              onClick={() => setCursor(undefined)}
            >
              First page
            </button>
          )}
          {data?.nextCursor && (
            <button
              type="button"
              className="secondary-btn compact-btn"
              disabled={isFetching}
              onClick={() => setCursor(data.nextCursor ?? undefined)}
            >
              Next page <ArrowUpRight size={13} aria-hidden />
            </button>
          )}
        </div>
      </section>
      {selected && (
        <ChargeDialog
          chargeId={selected.id}
          user={user}
          onClose={() => setSelected(null)}
          onRequest={(charge) => {
            setSelected(null);
            setRequestCharge(charge);
          }}
        />
      )}
      {requestCharge && (
        <RefundDialog
          charge={requestCharge}
          onClose={() => setRequestCharge(null)}
        />
      )}
    </div>
  );
}
