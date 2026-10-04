import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  BookOpenCheck,
  Check,
  Clock3,
  CreditCard,
  Fingerprint,
  LayoutDashboard,
  Pause,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
  X,
  XCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from 'lucide-react';
import {
  api,
  dateTime,
  decimalToMinor,
  Dialog,
  ErrorState,
  LoadingState,
  minorToDecimal,
  money,
} from '@internal-tools/ui-kit';

export type User = { id: string; displayName: string; roles: string[] };
type Charge = {
  id: string;
  customer_id: string;
  customer_email: string;
  card_brand: string;
  card_last4: string;
  amount_minor: string;
  currency: string;
  refunded_minor: string;
  refundable_minor?: string;
  created_at: string;
  refunds?: Refund[];
};
type Refund = {
  id: string;
  charge_id: string;
  amount_minor: string;
  currency: string;
  reason_code: string;
  status: string;
  tier: string;
  requester_id: string;
  created_at: string;
  note?: string;
  approval_id?: string;
  approvalSteps?: string[][];
  timeline?: TimelineEvent[];
};
type TimelineEvent = {
  action: string;
  occurredAt: string;
  actorId: string;
  actorRoles?: string[];
  after?: { stepIndex?: number } | null;
};
type ChargeSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
type Approval = Refund & {
  approval_id: string;
  requester_id: string;
  note: string;
  tier: string;
  steps: Array<{ roles: string[]; approvals: unknown[] }>;
};
export const refundsNavigation = [
  {
    to: '/',
    label: 'Overview',
    icon: LayoutDashboard,
    roles: ['agent', 'supervisor', 'finance', 'auditor', 'platform_admin'],
  },
  {
    to: '/payments',
    label: 'Payments',
    icon: CreditCard,
    roles: ['agent', 'supervisor', 'finance', 'auditor'],
  },
  {
    to: '/refunds',
    label: 'Refunds',
    icon: WalletCards,
    roles: ['agent', 'supervisor', 'finance', 'auditor'],
  },
  {
    to: '/approvals',
    label: 'Approvals',
    icon: BookOpenCheck,
    roles: ['supervisor', 'finance'],
  },
  {
    to: '/exceptions',
    label: 'Reconciliation',
    icon: Activity,
    roles: ['finance'],
  },
  {
    to: '/audit',
    label: 'Audit & controls',
    icon: Fingerprint,
    roles: ['auditor', 'platform_admin'],
  },
];

function canOpenPage(user: User, path: string) {
  const item = refundsNavigation.find((navigation) => navigation.to === path);
  return !item || item.roles.some((role) => user.roles.includes(role));
}

export function RefundsPages({ user }: { user: User }) {
  return (
    <Routes>
      <Route
        path="/"
        element={
          canOpenPage(user, '/') ? <Overview user={user} /> : <AccessDenied />
        }
      />
      <Route
        path="/payments"
        element={
          canOpenPage(user, '/payments') ? (
            <Payments user={user} />
          ) : (
            <AccessDenied />
          )
        }
      />
      <Route
        path="/refunds"
        element={
          canOpenPage(user, '/refunds') ? (
            <Refunds user={user} />
          ) : (
            <AccessDenied />
          )
        }
      />
      <Route
        path="/approvals"
        element={
          canOpenPage(user, '/approvals') ? (
            <Approvals user={user} />
          ) : (
            <AccessDenied />
          )
        }
      />
      <Route
        path="/exceptions"
        element={
          canOpenPage(user, '/exceptions') ? (
            <Exceptions user={user} />
          ) : (
            <AccessDenied />
          )
        }
      />
      <Route
        path="/audit"
        element={canOpenPage(user, '/audit') ? <Audit /> : <AccessDenied />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AccessDenied() {
  return (
    <div className="page">
      <PageHeader
        kicker="ACCESS CONTROL"
        title="Access restricted"
        detail="Your role does not have permission to open this section."
      />
    </div>
  );
}

function PageHeader({
  kicker,
  title,
  detail,
  action,
}: {
  kicker: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p className="page-detail">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function Overview({ user }: { user: User }) {
  const client = useQueryClient();
  const {
    data: dashboard,
    isLoading: dashboardLoading,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      api<{
        states: Array<{ status: string; count: number }>;
        pendingApprovals: number;
        openExceptions: number;
        executionPaused: boolean;
      }>('/api/dashboard'),
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) =>
      api('/api/admin/pause', {
        method: 'POST',
        body: JSON.stringify({ paused }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['dashboard'] }),
  });
  const total =
    dashboard?.states.reduce((sum, item) => sum + item.count, 0) ?? 0;
  const success =
    dashboard?.states.find((item) => item.status === 'succeeded')?.count ?? 0;
  const statValue = (value: number | undefined) =>
    dashboard ? String(value ?? 0) : '—';
  const action = user.roles.includes('platform_admin') ? (
    <button
      className="secondary-btn"
      onClick={() => pause.mutate(!dashboard?.executionPaused)}
      disabled={pause.isPending}
    >
      <Pause size={15} aria-hidden />
      {pause.isPending
        ? 'Saving…'
        : dashboard?.executionPaused
          ? 'Resume execution'
          : 'Pause execution'}
    </button>
  ) : undefined;
  return (
    <div className="page">
      <PageHeader
        kicker="PAYMENTS / OPERATIONS"
        title={`Good morning, ${user.displayName.split(' ')[0]!}`}
        detail="Here is your payments operations snapshot for today."
        action={action}
      />
      {pause.error && (
        <div className="notice notice-warn" role="alert">
          <XCircle size={16} aria-hidden />
          The execution state did not change. {pause.error.message}
        </div>
      )}
      {dashboardError && (
        <ErrorState
          title="The dashboard figures are not available"
          error={dashboardError}
          onRetry={() => void refetchDashboard()}
        />
      )}
      {dashboard?.executionPaused && (
        <div className="alert-banner" role="status">
          <Pause size={17} aria-hidden />
          <div>
            <b>Refund execution is paused</b>
            <span>
              Approved refunds remain queued until a Platform Admin resumes
              processing.
            </span>
          </div>
        </div>
      )}
      <div className="stat-grid" aria-busy={dashboardLoading}>
        <Stat
          icon={<WalletCards />}
          label="Total refunds"
          value={dashboard ? String(total) : '—'}
          delta="Across all statuses"
          tone="blue"
        />
        <Stat
          icon={<Clock3 />}
          label="Awaiting approval"
          value={statValue(dashboard?.pendingApprovals)}
          delta="Needs reviewer attention"
          tone="amber"
        />
        <Stat
          icon={<BadgeCheck />}
          label="Successfully refunded"
          value={dashboard ? String(success) : '—'}
          delta="Provider confirmed"
          tone="green"
        />
        <Stat
          icon={<Activity />}
          label="Open exceptions"
          value={statValue(dashboard?.openExceptions)}
          delta="Reconciliation queue"
          tone="purple"
        />
      </div>
      <div className="content-grid">
        <section className="panel overview-panel">
          <div className="panel-head">
            <div>
              <h2>Recent refund activity</h2>
              <p>Latest requests and payment events</p>
            </div>
            <Link className="text-link" to="/refunds">
              View all refunds <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
          <RefundTable compact />
        </section>
        <section className="panel side-summary">
          <div className="panel-head">
            <div>
              <h2>Approval queue</h2>
              <p>Across your permitted roles</p>
            </div>
            {canOpenPage(user, '/approvals') && (
              <Link
                className="round-link"
                to="/approvals"
                aria-label="Open approval inbox"
                title="Open approval inbox"
              >
                <ArrowUpRight size={15} aria-hidden />
              </Link>
            )}
          </div>
          {user.roles.some((role) =>
            ['supervisor', 'finance'].includes(role),
          ) && <ApprovalsPreview />}
          <div className="summary-divider" />
          <div className="policy-callout">
            <div className="policy-icon" aria-hidden="true">
              <ShieldCheck size={18} />
            </div>
            <div>
              <b>Approval policy active</b>
              <p>Thresholds are versioned and dual-controlled.</p>
              <span className="policy-version">
                <span aria-hidden="true" /> POLICY V3 · ACTIVE
              </span>
            </div>
          </div>
        </section>
      </div>
      <footer className="page-footer">
        <ShieldCheck size={14} aria-hidden /> Every action is permission-checked
        and added to the tamper-evident audit trail.
      </footer>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  delta,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  delta: string;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`} aria-hidden="true">
        {icon}
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-delta">{delta}</div>
    </div>
  );
}

function Payments({ user }: { user: User }) {
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
  const { data, isFetching, isLoading, error, refetch } = useQuery({
    queryKey: ['charges', query, from, to, minMinor, maxMinor, sort, cursor],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (minMinor) params.set('minMinor', minMinor);
      if (maxMinor) params.set('maxMinor', maxMinor);
      params.set('sort', sort);
      if (cursor) params.set('cursor', cursor);
      return api<{ items: Charge[]; nextCursor: string | null }>(
        `/api/charges?${params}`,
      );
    },
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
              onClick={() => setCursor(data.nextCursor!)}
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

function TableStatusRow({
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

function SortHeader({
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

function ChargeTable({
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

function ChargeDialog({
  chargeId,
  user,
  onClose,
  onRequest,
}: {
  chargeId: string;
  user: User;
  onClose: () => void;
  onRequest: (charge: Charge) => void;
}) {
  const [revealedEmail, setRevealedEmail] = useState<string>();
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealAttempted, setRevealAttempted] = useState(false);
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const revealFormId = useId();
  const reasonId = useId();
  const reasonError =
    revealReason.trim().length < 10
      ? `Enter a reason of 10 or more characters. The reason has ${revealReason.trim().length}.`
      : '';
  const showReasonError = Boolean(reasonError && revealAttempted);
  useEffect(() => {
    if (revealOpen) reasonRef.current?.focus();
  }, [revealOpen]);
  const {
    data: charge,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['charge', chargeId],
    queryFn: () => api<Charge>(`/api/charges/${chargeId}`),
  });
  const reveal = useMutation({
    mutationFn: (reason: string) =>
      api<{ customerEmail: string }>(`/api/charges/${chargeId}/reveal-email`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (result) => {
      setRevealedEmail(result.customerEmail);
      setRevealOpen(false);
    },
  });
  const closeReveal = () => {
    setRevealOpen(false);
    setRevealReason('');
    setRevealAttempted(false);
    reveal.reset();
    revealButtonRef.current?.focus();
  };
  if (isLoading || !charge)
    return (
      <Dialog onClose={onClose} label="Payment detail">
        <div className="modal-head">
          <div>
            <p className="eyebrow">PAYMENT DETAIL</p>
            <h2>{chargeId}</h2>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        {error ? (
          <ErrorState
            title="The payment is not available"
            error={error}
            onRetry={() => void refetch()}
          />
        ) : (
          <LoadingState label="Loading payment" />
        )}
      </Dialog>
    );
  return (
    <Dialog onClose={onClose} labelledBy={titleId}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">PAYMENT DETAIL</p>
          <h2 id={titleId}>{charge.id}</h2>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="detail-highlight">
        <div>
          <span>Payment amount</span>
          <b>{money(charge.amount_minor, charge.currency)}</b>
        </div>
        <div>
          <span>Refundable balance</span>
          <b className="green-text">
            {money(charge.refundable_minor ?? '0', charge.currency)}
          </b>
        </div>
      </div>
      <div className="detail-list">
        <Detail label="Customer" value={charge.customer_id} />
        <div className="detail-row">
          <span>Email</span>
          <b>{revealedEmail ?? charge.customer_email}</b>
          {user.roles.some((role) =>
            ['supervisor', 'finance', 'auditor'].includes(role),
          ) && (
            <button
              ref={revealButtonRef}
              type="button"
              className="reveal-btn"
              aria-label={revealedEmail ? 'Email revealed' : 'Reveal email'}
              aria-expanded={revealedEmail ? undefined : revealOpen}
              aria-controls={revealOpen ? revealFormId : undefined}
              onClick={() => setRevealOpen(true)}
              disabled={revealOpen || Boolean(revealedEmail)}
            >
              {revealedEmail ? 'Revealed' : 'Reveal'}
            </button>
          )}
        </div>
        {revealOpen && !revealedEmail && (
          <form
            id={revealFormId}
            className="reveal-form"
            aria-label="Reveal email"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setRevealAttempted(true);
              if (reasonError) {
                reasonRef.current?.focus();
                return;
              }
              reveal.mutate(revealReason.trim());
            }}
          >
            <label htmlFor={reasonId}>Reason for reveal</label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              value={revealReason}
              maxLength={500}
              required
              aria-invalid={showReasonError}
              aria-describedby={`${reasonId}-hint${showReasonError ? ` ${reasonId}-error` : ''}`}
              placeholder="For example: customer asked for a receipt by email"
              onChange={(event) => setRevealReason(event.target.value)}
            />
            <p id={`${reasonId}-hint`} className="field-hint">
              The audit log keeps this reason. Enter 10 to 500 characters.
            </p>
            {showReasonError && (
              <p id={`${reasonId}-error`} className="field-error">
                {reasonError}
              </p>
            )}
            {reveal.error && (
              <p className="field-error" role="alert">
                The email was not revealed. {reveal.error.message}
              </p>
            )}
            <div className="reveal-actions">
              <button
                type="button"
                className="secondary-btn small-btn"
                onClick={closeReveal}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-btn small-btn"
                disabled={reveal.isPending}
              >
                {reveal.isPending ? 'Revealing…' : 'Reveal email'}
              </button>
            </div>
          </form>
        )}
        <Detail
          label="Card"
          value={`${charge.card_brand.toUpperCase()} ending ${charge.card_last4}`}
        />
        <Detail label="Created" value={dateTime(charge.created_at)} />
      </div>
      <h3 className="section-subtitle">Refund history</h3>
      {(charge.refunds ?? []).length ? (
        <ul className="mini-list" aria-label="Refund history">
          {charge.refunds?.map((refund) => (
            <li key={refund.id}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <b>
                  {money(refund.amount_minor, refund.currency)} ·{' '}
                  {refund.reason_code.replaceAll('_', ' ')}
                </b>
                <small>{dateTime(refund.created_at)}</small>
              </div>
              <StatusBadge status={refund.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">
          No refunds have been requested for this payment.
        </p>
      )}
      {BigInt(charge.refundable_minor ?? '0') <= 0n && (
        <p className="field-hint">
          This payment has no refundable balance. You cannot request a refund.
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary-btn" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="primary-btn"
          onClick={() => onRequest(charge)}
          disabled={BigInt(charge.refundable_minor ?? '0') <= 0n}
        >
          Request refund <ArrowDownLeft size={16} aria-hidden />
        </button>
      </div>
    </Dialog>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={onClose}
      aria-label="Close dialog"
    >
      <X size={18} aria-hidden />
    </button>
  );
}

function currencySymbol(currency: string) {
  return (
    new Intl.NumberFormat('en-US', { style: 'currency', currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}

function RefundDialog({
  charge,
  onClose,
}: {
  charge: Charge;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const currency = charge.currency.toUpperCase();
  const refundableMinor =
    charge.refundable_minor ??
    String(BigInt(charge.amount_minor) - BigInt(charge.refunded_minor));
  const [amountText, setAmountText] = useState(() =>
    minorToDecimal(refundableMinor, currency),
  );
  const [reason, setReason] = useState('service_issue');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const titleId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const parsedMinor = decimalToMinor(amountText, currency);
  const amountMinor = parsedMinor === undefined ? 0n : BigInt(parsedMinor);
  const amountError =
    parsedMinor === undefined
      ? `Enter an amount in ${currency}, for example ${minorToDecimal(2500, currency)}.`
      : amountMinor <= 0n
        ? 'Enter an amount that is more than zero.'
        : amountMinor > BigInt(refundableMinor)
          ? `The amount is more than the available balance of ${money(refundableMinor, currency)}.`
          : '';
  const noteError =
    note.trim().length < 10
      ? `Enter a note of 10 or more characters. The note has ${note.trim().length}.`
      : '';
  const showAmountError = Boolean(
    amountError && (submitAttempted || amountText !== ''),
  );
  const showNoteError = Boolean(noteError && submitAttempted);
  const cumulativeMinor = BigInt(charge.refunded_minor) + amountMinor;
  const tier =
    cumulativeMinor <= 25_000n
      ? 'Instant refund'
      : cumulativeMinor <= 500_000n
        ? 'Supervisor approval'
        : 'Supervisor + Finance approval';
  const mutation = useMutation({
    mutationFn: () =>
      api<Refund>('/api/refunds', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          chargeId: charge.id,
          amountMinor: amountMinor.toString(),
          reasonCode: reason,
          note,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries();
      onClose();
    },
    onError: (caught: Error) => setError(caught.message),
  });
  return (
    <Dialog onClose={onClose} labelledBy={titleId}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">NEW REFUND REQUEST</p>
          <h2 id={titleId}>Refund payment</h2>
          <p className="modal-subtitle">
            {charge.id} · {money(charge.amount_minor, charge.currency)} original
            payment
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitAttempted(true);
          if (amountError) {
            amountRef.current?.focus();
            return;
          }
          if (noteError) {
            noteRef.current?.focus();
            return;
          }
          mutation.mutate();
        }}
      >
        <label className="field-label" htmlFor="refund-amount">
          Refund amount <span>{currency}</span>
        </label>
        <div className="money-input">
          <span aria-hidden="true">{currencySymbol(currency)}</span>
          <input
            ref={amountRef}
            id="refund-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            data-autofocus
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-invalid={showAmountError}
            aria-describedby={
              showAmountError
                ? 'refund-amount-error refund-amount-balance'
                : 'refund-amount-balance'
            }
            required
          />
        </div>
        {showAmountError && (
          <p className="field-error" id="refund-amount-error">
            {amountError}
          </p>
        )}
        <div className="balance-hint" id="refund-amount-balance">
          Available to refund: <b>{money(refundableMinor, charge.currency)}</b>
          <button
            type="button"
            onClick={() =>
              setAmountText(minorToDecimal(refundableMinor, currency))
            }
          >
            Use full balance
          </button>
        </div>
        <label className="field-label" htmlFor="reason">
          Reason code
        </label>
        <select
          id="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          <option value="service_issue">Service issue</option>
          <option value="duplicate">Duplicate payment</option>
          <option value="fraud_review">Fraud review</option>
          <option value="goodwill">Goodwill</option>
          <option value="other">Other</option>
        </select>
        <label className="field-label" htmlFor="note">
          Internal note <span aria-hidden="true">{note.length}/1,000</span>
        </label>
        <textarea
          ref={noteRef}
          id="note"
          minLength={10}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add context for reviewers (10–1,000 characters)"
          aria-invalid={showNoteError}
          aria-describedby="note-hint"
          required
        />
        <p
          className={showNoteError ? 'field-error' : 'field-hint'}
          id="note-hint"
        >
          {showNoteError
            ? noteError
            : 'Enter 10 to 1,000 characters. Reviewers see this note.'}
        </p>
        <div className="tier-preview" aria-live="polite">
          <div className="tier-shield" aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <div>
            <span>APPROVAL PREVIEW</span>
            <b>{tier}</b>
            <small>
              {tier === 'Instant refund'
                ? 'This request can execute after submission.'
                : 'This request will appear in the eligible approver inbox.'}
            </small>
          </div>
          <span className="tier-policy">POLICY V3</span>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <XCircle size={15} aria-hidden />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            type="submit"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Submitting…' : 'Submit request'}{' '}
            <ArrowUpRight size={16} aria-hidden />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Refunds({ user }: { user: User }) {
  const [filter, setFilter] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['refunds', filter],
    queryFn: () =>
      api<{ items: Refund[] }>(
        filter === 'all' ? '/api/refunds' : `/api/refunds?status=${filter}`,
      ),
    refetchInterval: 2_000,
  });
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
          user.roles.some((role) => ['finance', 'auditor'].includes(role)) ? (
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

function RefundTable({
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

function timelineLabel(event: TimelineEvent) {
  if (
    event.action === 'approval.approved' ||
    event.action === 'approval.rejected'
  ) {
    const step =
      typeof event.after?.stepIndex === 'number'
        ? ` step ${event.after.stepIndex + 1}`
        : '';
    return `Approval${step} ${event.action === 'approval.approved' ? 'approved' : 'declined'}`;
  }
  return event.action.replaceAll(/[._]/g, ' ');
}

function approvalTitle(item: Approval) {
  return item.amount_minor
    ? `${money(item.amount_minor, item.currency || 'USD')} refund request`
    : 'Refund request';
}

function RefundTimelineDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['refund', id],
    queryFn: () => api<Refund>(`/api/refunds/${encodeURIComponent(id)}`),
  });
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

function Approvals({ user }: { user: User }) {
  const client = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<{ items: Approval[] }>('/api/approvals?tool=refunds'),
  });
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

function ApprovalCard({
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

function ApprovalsPreview() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<{ items: Approval[] }>('/api/approvals?tool=refunds'),
  });
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

function Exceptions({ user }: { user: User }) {
  const client = useQueryClient();
  const titleId = useId();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exceptions'],
    queryFn: () =>
      api<{
        items: Array<{
          id: string;
          exception_type: string;
          reconciliation_key: string;
          details: Record<string, unknown>;
          created_at: string;
        }>;
      }>('/api/exceptions'),
  });
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

function Audit() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      api<{
        items: Array<{
          seq: number;
          event_data: {
            action: string;
            actorId: string;
            objectType: string;
            objectId: string;
            occurredAt: string;
            result: string;
          };
          hash: string;
        }>;
      }>('/api/audit'),
  });
  const verify = useMutation({
    mutationFn: () =>
      api<{ valid: boolean; eventCount?: number; firstBrokenEventId?: string }>(
        '/api/audit/verify',
      ),
  });
  return (
    <div className="page">
      <PageHeader
        kicker="FOUNDATION / GOVERNANCE"
        title="Audit & controls"
        detail="Review append-only events and verify the SHA-256 event chain."
        action={
          <button
            className="primary-btn"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
          >
            <ShieldCheck size={16} aria-hidden />
            {verify.isPending ? 'Verifying…' : 'Verify chain'}
          </button>
        }
      />
      {verify.error && (
        <div className="notice notice-warn" role="alert">
          <XCircle size={16} aria-hidden />
          The chain check did not run. {verify.error.message}
        </div>
      )}
      {verify.data && (
        <div
          className={`verify-banner ${verify.data.valid ? 'verified' : 'invalid'}`}
          role={verify.data.valid ? 'status' : 'alert'}
        >
          <div className="verify-icon" aria-hidden="true">
            {verify.data.valid ? <Check size={18} /> : <XCircle size={18} />}
          </div>
          <div>
            <b>
              {verify.data.valid
                ? 'Audit chain verified'
                : 'Audit chain integrity check failed'}
            </b>
            <span>
              {verify.data.valid
                ? `${verify.data.eventCount} events were verified. No changes were detected.`
                : `First broken event: ${verify.data.firstBrokenEventId}`}
            </span>
          </div>
          <span className="verify-time">
            {verify.data.valid ? 'VERIFIED JUST NOW' : 'ACTION REQUIRED'}
          </span>
        </div>
      )}
      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Recent audit events</h2>
            <p>Latest 100 events · immutable evidence</p>
          </div>
          <a className="secondary-btn" href="/api/audit?format=csv">
            <ArrowDownLeft size={15} aria-hidden /> Export audit CSV
          </a>
        </div>
        {error && (
          <ErrorState
            title="The audit events are not available"
            error={error}
            onRetry={() => void refetch()}
          />
        )}
        {isLoading && <LoadingState label="Loading audit events" />}
        {(data?.items ?? []).map((row) => (
          <div className="audit-row" key={row.seq}>
            <div className="audit-index">
              {String(row.seq).padStart(5, '0')}
            </div>
            <div className="audit-main">
              <b>{row.event_data.action.replaceAll(/[._]/g, ' ')}</b>
              <small>
                {row.event_data.actorId} <span aria-hidden="true">·</span>{' '}
                {row.event_data.objectType}{' '}
                {row.event_data.objectId.slice(0, 12)}
              </small>
            </div>
            <div className="audit-hash">
              <code>{row.hash.slice(0, 16)}…</code>
              <small>SHA-256 HASH</small>
            </div>
            <span className="date-cell">
              {dateTime(row.event_data.occurredAt)}
            </span>
          </div>
        ))}
        {data && !data.items.length && (
          <EmptyState
            icon={<Fingerprint />}
            title="No audit events yet"
            detail="Sign-ins, refunds, approvals, and policy actions will be recorded here."
          />
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().replaceAll(' ', '_');
  return (
    <span className={`status-badge status-${key}`}>
      <span aria-hidden="true" />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

type Message = { tone: 'success' | 'error'; text: string };

function Notice({
  message,
  onDismiss,
}: {
  message?: Message;
  onDismiss: () => void;
}) {
  if (!message) return null;
  const error = message.tone === 'error';
  return (
    <div
      className={`notice ${error ? 'notice-warn' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {error ? (
        <XCircle size={16} aria-hidden />
      ) : (
        <ShieldCheck size={16} aria-hidden />
      )}
      {message.text}
      <button type="button" aria-label="Dismiss message" onClick={onDismiss}>
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

function humanizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
}

function formatDetail(
  key: string,
  value: unknown,
  details: Record<string, unknown>,
) {
  if (value === null || value === undefined || value === '') return '—';
  if (/minor$/i.test(key) && /^-?\d+$/.test(String(value))) {
    return typeof details.currency === 'string'
      ? money(String(value), details.currency)
      : `${String(value)} minor units`;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

export const refundsWebTool = {
  id: 'refunds',
  name: 'Refunds Console',
  description: 'Payments operations',
  routePath: '*',
  icon: WalletCards,
  navigation: refundsNavigation,
  Pages: RefundsPages,
};

export const tool = refundsWebTool;
export default RefundsPages;
