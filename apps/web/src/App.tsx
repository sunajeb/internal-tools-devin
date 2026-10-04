import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
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
  CircleHelp,
  Clock3,
  CreditCard,
  Fingerprint,
  LayoutDashboard,
  LockKeyhole,
  Pause,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react';
import { api, dateTime, money } from './api';

// <DEVIN-TOOL-IMPORTS>

type User = { id: string; displayName: string; roles: string[] };
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
  timeline?: Array<{ action: string; occurredAt: string; actorId: string }>;
};
type Approval = Refund & {
  approval_id: string;
  requester_id: string;
  note: string;
  tier: string;
  steps: Array<{ roles: string[]; approvals: unknown[] }>;
};
type Session = { authenticated: boolean; user?: User; environment: string };

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/refunds', label: 'Refunds', icon: WalletCards },
  { to: '/approvals', label: 'Approvals', icon: BookOpenCheck },
  { to: '/exceptions', label: 'Reconciliation', icon: Activity },
  { to: '/audit', label: 'Audit & controls', icon: Fingerprint },
  // <DEVIN-TOOL-NAV>
];

const pageRoles: Record<string, string[]> = {
  '/': ['agent', 'supervisor', 'finance', 'auditor', 'platform_admin'],
  '/payments': ['agent', 'supervisor', 'finance', 'auditor'],
  '/refunds': ['agent', 'supervisor', 'finance', 'auditor'],
  '/approvals': ['supervisor', 'finance'],
  '/exceptions': ['finance'],
  '/audit': ['auditor', 'platform_admin'],
};

function canOpenPage(user: User, path: string) {
  const roles = pageRoles[path];
  return !roles || roles.some((role) => user.roles.includes(role));
}

function App() {
  const { data: session, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/api/session'),
  });
  if (isLoading)
    return (
      <div className="loading">
        <span className="loader" />
        Loading secure workspace
      </div>
    );
  if (!session?.authenticated) return <SignIn />;
  return <Shell session={session} />;
}

function SignIn() {
  return (
    <main className="login-shell">
      <div className="login-brand">
        <div className="brand-mark">
          <ShieldCheck size={22} />
        </div>
        <span>ledgerline</span>
        <small>INTERNAL OPERATIONS</small>
      </div>
      <section className="login-card">
        <div className="login-icon">
          <LockKeyhole size={22} />
        </div>
        <p className="eyebrow">SECURE WORKSPACE</p>
        <h1>Sign in to Ledgerline</h1>
        <p className="muted">
          Use your company identity to access the payments operations console.
        </p>
        <a className="primary-btn full" href="/auth/login">
          Continue with company SSO <ArrowUpRight size={16} />
        </a>
        <div className="login-foot">
          <Shield size={15} /> Protected by your organization’s identity
          provider
        </div>
      </section>
      <div className="login-caption">
        Internal tools foundation <span>·</span> Access is monitored and audited
      </div>
    </main>
  );
}

function Shell({ session }: { session: Session }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = session.user!;
  const visibleLinks = links.filter((item) => canOpenPage(user, item.to));
  const active =
    visibleLinks.find((item) => item.to === location.pathname) ??
    visibleLinks[0] ??
    links[0]!;
  const logout = useMutation({
    mutationFn: () => api('/api/logout', { method: 'POST', body: '{}' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
  });
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link to="/" className="brand-lockup">
          <div className="brand-mark">
            <ShieldCheck size={19} />
          </div>
          <div>
            <b>ledgerline</b>
            <small>OPS PLATFORM</small>
          </div>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="tool-select">
          <div className="tool-icon">
            <WalletCards size={17} />
          </div>
          <div>
            <b>Refunds Console</b>
            <small>Payments operations</small>
          </div>
        </div>
        <p className="nav-caption">OPERATIONS</p>
        <nav aria-label="Main navigation">
          {visibleLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`nav-item ${active.to === to ? 'selected' : ''}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="uptime">
            <span className="pulse-dot" />
            <div>
              <b>Local prototype</b>
              <small>Internal tools workspace</small>
            </div>
          </div>
          <div className="sidebar-version">
            FOUNDATION <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Payments</span>
            <span className="crumb-slash">/</span>
            <b>{active.label}</b>
          </div>
          <div className="top-actions">
            <div className="env-tag">
              <span />
              {session.environment} ENVIRONMENT
            </div>
            <div className="top-divider" />
            <button
              className="profile-btn"
              aria-label="Sign out"
              onClick={() => logout.mutate()}
            >
              <span className="avatar">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-copy">
                <b>{user.displayName}</b>
                <small>{user.roles.join(' · ')}</small>
              </span>
              <span className="signout-label">Sign out</span>
            </button>
          </div>
        </header>
        <Routes>
          <Route
            path="/"
            element={
              canOpenPage(user, '/') ? (
                <Overview user={user} />
              ) : (
                <AccessDenied />
              )
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
          {/* <DEVIN-TOOL-ROUTES> */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
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
  const { data: dashboard } = useQuery({
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
  const action = user.roles.includes('platform_admin') ? (
    <button
      className="secondary-btn"
      onClick={() => pause.mutate(!dashboard?.executionPaused)}
      disabled={pause.isPending}
    >
      <Pause size={15} />
      {dashboard?.executionPaused ? 'Resume execution' : 'Pause execution'}
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
      {dashboard?.executionPaused && (
        <div className="alert-banner">
          <Pause size={17} />
          <div>
            <b>Refund execution is paused</b>
            <span>
              Approved refunds remain queued until a Platform Admin resumes
              processing.
            </span>
          </div>
        </div>
      )}
      <div className="stat-grid">
        <Stat
          icon={<WalletCards />}
          label="Total refunds"
          value={String(total)}
          delta="Across all statuses"
          tone="blue"
        />
        <Stat
          icon={<Clock3 />}
          label="Awaiting approval"
          value={String(dashboard?.pendingApprovals ?? 0)}
          delta="Needs reviewer attention"
          tone="amber"
        />
        <Stat
          icon={<BadgeCheck />}
          label="Successfully refunded"
          value={String(success)}
          delta="Provider confirmed"
          tone="green"
        />
        <Stat
          icon={<Activity />}
          label="Open exceptions"
          value={String(dashboard?.openExceptions ?? 0)}
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
              View all <ArrowUpRight size={14} />
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
            <Link className="round-link" to="/approvals">
              <ArrowUpRight size={15} />
            </Link>
          </div>
          {user.roles.some((role) =>
            ['supervisor', 'finance'].includes(role),
          ) && <ApprovalsPreview />}
          <div className="summary-divider" />
          <div className="policy-callout">
            <div className="policy-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <b>Approval policy active</b>
              <p>Thresholds are versioned and dual-controlled.</p>
              <span className="policy-version">
                <span /> POLICY V1 · ACTIVE
              </span>
            </div>
          </div>
        </section>
      </div>
      <footer className="page-footer">
        <ShieldCheck size={14} /> Every action is permission-checked and added
        to the tamper-evident audit trail.
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
      <div className={`stat-icon ${tone}`}>{icon}</div>
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
  const [selected, setSelected] = useState<Charge | null>(null);
  const [requestCharge, setRequestCharge] = useState<Charge | null>(null);
  const minMinor = decimalToMinor(minAmount);
  const maxMinor = decimalToMinor(maxAmount);
  const { data, isFetching } = useQuery({
    queryKey: ['charges', query, from, to, minMinor, maxMinor, cursor],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (minMinor) params.set('minMinor', minMinor);
      if (maxMinor) params.set('maxMinor', maxMinor);
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
            <Search size={17} />
            <input
              aria-label="Search payments"
              placeholder="Search charge, customer, email or last 4…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(undefined);
              }}
            />
            <kbd>⌘ K</kbd>
          </label>
          <button
            className="secondary-btn"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} /> Filters
          </button>
          <span className="result-count">
            {isFetching ? 'Searching…' : `${data?.items.length ?? 0} records`}
          </span>
        </div>
        {filtersOpen && (
          <div className="filter-panel">
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
                type="number"
                min="0"
                step="0.01"
                placeholder="$0.00"
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
                type="number"
                min="0"
                step="0.01"
                placeholder="$0.00"
                value={maxAmount}
                onChange={(event) => {
                  setMaxAmount(event.target.value);
                  setCursor(undefined);
                }}
              />
            </label>
            <button
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
        <ChargeTable charges={data?.items ?? []} onSelect={setSelected} />
        <div className="pagination">
          <span>
            {cursor
              ? 'Showing the next result page.'
              : 'Showing the latest results.'}
          </span>
          {cursor && (
            <button
              className="secondary-btn compact-btn"
              onClick={() => setCursor(undefined)}
            >
              First page
            </button>
          )}
          {data?.nextCursor && (
            <button
              className="secondary-btn compact-btn"
              disabled={isFetching}
              onClick={() => setCursor(data.nextCursor!)}
            >
              Next page <ArrowUpRight size={13} />
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

function decimalToMinor(value: string): string {
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return '';
  const [dollars = '0', cents = ''] = value.split('.');
  return (
    BigInt(dollars || '0') * 100n +
    BigInt((cents + '00').slice(0, 2))
  ).toString();
}

function ChargeTable({
  charges,
  onSelect,
}: {
  charges: Charge[];
  onSelect: (charge: Charge) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>PAYMENT</th>
            <th>CUSTOMER</th>
            <th>AMOUNT</th>
            <th>REFUNDED</th>
            <th>STATUS</th>
            <th>DATE</th>
          </tr>
        </thead>
        <tbody>
          {charges.map((charge) => (
            <tr
              key={charge.id}
              onClick={() => onSelect(charge)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(charge);
                }
              }}
              tabIndex={0}
              aria-label={`Open payment ${charge.id}`}
              className="clickable-row"
            >
              <td>
                <span className="mono-id">{charge.id}</span>
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
          {!charges.length && (
            <tr>
              <td colSpan={6}>
                <EmptyState
                  icon={<Search />}
                  title="No payments found"
                  detail="Try another payment, customer, email, or card number."
                />
              </td>
            </tr>
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
  const { data: charge, isLoading } = useQuery({
    queryKey: ['charge', chargeId],
    queryFn: () => api<Charge>(`/api/charges/${chargeId}`),
  });
  const reveal = useMutation({
    mutationFn: () =>
      api<{ customerEmail: string }>(`/api/charges/${chargeId}/reveal-email`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: (result) => setRevealedEmail(result.customerEmail),
  });
  if (isLoading || !charge)
    return (
      <Modal onClose={onClose}>
        <div className="loading">
          <span className="loader" />
          Loading payment
        </div>
      </Modal>
    );
  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">PAYMENT DETAIL</p>
          <h2>{charge.id}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
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
              className="reveal-btn"
              onClick={() => reveal.mutate()}
              disabled={reveal.isPending || Boolean(revealedEmail)}
            >
              {revealedEmail
                ? 'Revealed'
                : reveal.isPending
                  ? 'Revealing…'
                  : 'Reveal'}
            </button>
          )}
        </div>
        <Detail
          label="Card"
          value={`${charge.card_brand.toUpperCase()} ending ${charge.card_last4}`}
        />
        <Detail label="Created" value={dateTime(charge.created_at)} />
      </div>
      <h3 className="section-subtitle">Refund history</h3>
      {(charge.refunds ?? []).length ? (
        <div className="mini-list">
          {charge.refunds?.map((refund) => (
            <div key={refund.id}>
              <span className="timeline-dot" />
              <div>
                <b>
                  {money(refund.amount_minor, refund.currency)} ·{' '}
                  {refund.reason_code.replaceAll('_', ' ')}
                </b>
                <small>{dateTime(refund.created_at)}</small>
              </div>
              <StatusBadge status={refund.status} />
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-inline">
          No refunds have been requested for this payment.
        </p>
      )}
      <div className="modal-actions">
        <button className="secondary-btn" onClick={onClose}>
          Close
        </button>
        <button
          className="primary-btn"
          onClick={() => onRequest(charge)}
          disabled={Number(charge.refundable_minor) <= 0}
        >
          Request refund <ArrowDownLeft size={16} />
        </button>
      </div>
    </Modal>
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
  const [amount, setAmount] = useState(
    charge.refundable_minor ??
      String(Number(charge.amount_minor) - Number(charge.refunded_minor)),
  );
  const [reason, setReason] = useState('service_issue');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const amountMinor = BigInt(amount || '0');
  const tier =
    amountMinor <= 25_000n
      ? 'Instant refund'
      : amountMinor <= 500_000n
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
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">NEW REFUND REQUEST</p>
          <h2>Refund payment</h2>
          <p className="modal-subtitle">
            {charge.id} · {money(charge.amount_minor, charge.currency)} original
            payment
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <label className="field-label" htmlFor="refund-amount">
          Refund amount <span>USD</span>
        </label>
        <div className="money-input">
          <span>$</span>
          <input
            id="refund-amount"
            type="number"
            min="0.01"
            max={(Number(charge.refundable_minor ?? 0) / 100).toFixed(2)}
            step="0.01"
            value={
              amount
                ? `${BigInt(amount) / 100n}.${String(BigInt(amount) % 100n).padStart(2, '0')}`
                : ''
            }
            onChange={(event) => {
              const value = event.target.value;
              const [whole = '0', fraction = ''] = value.split('.');
              setAmount(
                /^\d+$/.test(whole) && /^\d{0,2}$/.test(fraction)
                  ? (
                      BigInt(whole) * 100n +
                      BigInt((fraction + '00').slice(0, 2))
                    ).toString()
                  : '0',
              );
            }}
            required
          />
        </div>
        <div className="balance-hint">
          Available to refund:{' '}
          <b>{money(charge.refundable_minor ?? '0', charge.currency)}</b>
          <button
            type="button"
            onClick={() => setAmount(charge.refundable_minor ?? '0')}
          >
            Full balance
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
          Internal note <span>{note.length}/1,000</span>
        </label>
        <textarea
          id="note"
          minLength={10}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add context for reviewers (10–1,000 characters)"
          required
        />
        <div className="tier-preview">
          <div className="tier-shield">
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
          <span className="tier-policy">POLICY V1</span>
        </div>
        {error && (
          <div className="form-error">
            <XCircle size={15} />
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
            disabled={mutation.isPending || note.trim().length < 10}
          >
            {mutation.isPending ? 'Submitting…' : 'Submit request'}{' '}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Refunds({ user }: { user: User }) {
  const [filter, setFilter] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const { data } = useQuery({
    queryKey: ['refunds'],
    queryFn: () => api<{ items: Refund[] }>('/api/refunds'),
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
              <ArrowDownLeft size={15} /> Export CSV
            </a>
          ) : undefined
        }
      />
      <div className="tabs">
        {['all', 'pending_approval', 'approved', 'succeeded', 'failed'].map(
          (item) => (
            <button
              key={item}
              className={filter === item ? 'active' : ''}
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
  onSelect,
}: {
  compact?: boolean;
  filter?: string;
  items?: Refund[];
  onSelect?: (id: string) => void;
}) {
  const { data } = useQuery({
    queryKey: ['refunds'],
    queryFn: () => api<{ items: Refund[] }>('/api/refunds'),
    enabled: !passedItems,
  });
  const items = (passedItems ?? data?.items ?? [])
    .filter((item) => filter === 'all' || item.status === filter)
    .slice(0, compact ? 6 : 100);
  return (
    <div className="table-scroll">
      <table>
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
              tabIndex={0}
              aria-label={`Open refund ${item.id}`}
              onClick={() =>
                onSelect
                  ? onSelect(item.id)
                  : (window.location.href = `/refunds?id=${item.id}`)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (onSelect) onSelect(item.id);
                  else window.location.href = `/refunds?id=${item.id}`;
                }
              }}
            >
              <td>
                <span className="mono-id">{item.id.slice(0, 8)}…</span>
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
          {!items.length && (
            <tr>
              <td colSpan={6}>
                <EmptyState
                  icon={<WalletCards />}
                  title="No refunds in this view"
                  detail="New refund requests will appear here."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RefundTimelineDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['refund', id],
    queryFn: () => api<Refund>(`/api/refunds/${id}`),
  });
  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">REFUND TIMELINE</p>
          <h2>{data?.id ?? id}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {isLoading || !data ? (
        <div className="loading">
          <span className="loader" />
          Loading refund history
        </div>
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
          <div className="timeline-list">
            {(data.timeline ?? []).map((event, index) => (
              <div className="timeline-event" key={`${event.action}-${index}`}>
                <span className="timeline-dot" />
                <div>
                  <b>{event.action.replaceAll(/[._]/g, ' ')}</b>
                  <small>
                    {event.actorId} · {dateTime(event.occurredAt)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="modal-actions">
        <button className="secondary-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function Approvals({ user }: { user: User }) {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<{ items: Approval[] }>('/api/approvals'),
  });
  const [message, setMessage] = useState('');
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
      api(`/api/approvals/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ stepIndex, decision }),
      }),
    onSuccess: () => {
      setMessage('Approval recorded. The request has been updated.');
      client.invalidateQueries();
    },
    onError: (error: Error) => setMessage(error.message),
  });
  return (
    <div className="page">
      <PageHeader
        kicker="PAYMENTS / REVIEW QUEUE"
        title="Approval inbox"
        detail="Review actions that require a second person. Self-approval is blocked by the server."
        action={
          <span className="inbox-count">
            {data?.items.length ?? 0} OPEN REQUESTS
          </span>
        }
      />
      {message && (
        <div
          className={`notice ${message.includes('cannot') ? 'notice-warn' : ''}`}
        >
          <ShieldCheck size={16} />
          {message}
          <button aria-label="Dismiss" onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="panel inbox-panel">
        <div className="panel-head">
          <div>
            <h2>Waiting for your review</h2>
            <p>Approval steps must complete in policy order.</p>
          </div>
          <div className="filter-chip">
            <SlidersHorizontal size={14} /> All roles
          </div>
        </div>
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
        {!data?.items.length && (
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
  return (
    <article className="approval-card">
      <div className="approval-card-main">
        <div className="approval-symbol">
          <WalletCards size={18} />
        </div>
        <div className="approval-copy">
          <div className="approval-title">
            <b>{money(item.amount_minor, item.currency)} refund request</b>
            <StatusBadge status={item.tier} />
          </div>
          <div className="approval-meta">
            Payment <span className="mono-id">{item.charge_id}</span>
            <span className="meta-dot">·</span> submitted by{' '}
            <b>{item.requester_id}</b>
            <span className="meta-dot">·</span>
            {dateTime(item.created_at)}
          </div>
          <p>{item.note}</p>
          <div className="approval-steps">
            {steps.map((step, index) => (
              <span
                key={index}
                className={step.approvals.length ? 'step-done' : 'step-wait'}
              >
                {step.approvals.length ? (
                  <Check size={12} />
                ) : (
                  <Clock3 size={12} />
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
          className="decline-btn"
          disabled={loading || selfApproval}
          onClick={() => onApprove(waiting[0]?.index ?? 0, 'reject')}
        >
          Decline
        </button>
        {waiting.map(({ step, index }) => (
          <button
            key={index}
            className="primary-btn small-btn"
            disabled={loading || selfApproval}
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
  const { data } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<{ items: Approval[] }>('/api/approvals'),
  });
  return (
    <div className="preview-list">
      {(data?.items ?? []).slice(0, 3).map((item) => (
        <Link to="/approvals" key={item.approval_id} className="preview-item">
          <span className="preview-avatar">
            {item.requester_id.slice(0, 1).toUpperCase()}
          </span>
          <span className="preview-copy">
            <b>{money(item.amount_minor, item.currency)} refund</b>
            <small>
              {item.requester_id} · {item.tier} review
            </small>
          </span>
          <span className="preview-time">
            {dateTime(item.created_at).split(',')[0]}
          </span>
        </Link>
      ))}
      {!data?.items.length && (
        <div className="quiet-empty">No pending approvals in your queue.</div>
      )}
      <Link to="/approvals" className="queue-link">
        Open approval inbox <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}

function Exceptions({ user }: { user: User }) {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ['exceptions'],
    queryFn: () =>
      api<{
        items: Array<{
          id: string;
          exception_type: string;
          reconciliation_key: string;
          details: Record<string, string>;
          created_at: string;
        }>;
      }>('/api/exceptions'),
  });
  const [message, setMessage] = useState('');
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
      setMessage('Exception marked as resolved.');
      setResolvingId(undefined);
      setResolutionNote('');
      client.invalidateQueries();
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const run = useMutation({
    mutationFn: () =>
      api('/api/reconciliation/run', { method: 'POST', body: '{}' }),
    onSuccess: () =>
      setMessage('Reconciliation queued. Results will appear in this view.'),
    onError: (error: Error) => setMessage(error.message),
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
              <Activity size={15} />{' '}
              {run.isPending ? 'Queueing…' : 'Run reconciliation'}
            </button>
          ) : undefined
        }
      />
      {message && (
        <div className="notice">
          <ShieldCheck size={16} />
          {message}
        </div>
      )}
      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Open exceptions</h2>
            <p>{data?.items.length ?? 0} items need Finance review</p>
          </div>
          <span className="exception-pill">
            <span /> OPEN
          </span>
        </div>
        {(data?.items ?? []).map((item) => (
          <div className="exception-row" key={item.id}>
            <div className="exception-type">
              <div className="exception-icon">
                <Activity size={17} />
              </div>
              <div>
                <b>{item.exception_type.replaceAll('_', ' ')}</b>
                <small>Key: {item.reconciliation_key}</small>
              </div>
            </div>
            <div className="exception-detail">
              {JSON.stringify(item.details)}
            </div>
            <span className="date-cell">{dateTime(item.created_at)}</span>
            {user.roles.includes('finance') && (
              <button
                className="secondary-btn compact-btn"
                onClick={() => setResolvingId(item.id)}
                disabled={resolve.isPending}
              >
                Resolve
              </button>
            )}
          </div>
        ))}
        {!data?.items.length && (
          <EmptyState
            icon={<Check />}
            title="No open exceptions"
            detail="Internal refunds match the provider records."
          />
        )}
      </section>
      {resolvingId && (
        <Modal onClose={() => setResolvingId(undefined)}>
          <div className="modal-head">
            <div>
              <p className="eyebrow">RECONCILIATION REVIEW</p>
              <h2>Resolve exception</h2>
            </div>
            <button
              className="icon-btn"
              onClick={() => setResolvingId(undefined)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <label className="resolution-field">
            Resolution code
            <input
              value={resolutionCode}
              onChange={(event) => setResolutionCode(event.target.value)}
              maxLength={64}
            />
          </label>
          <label className="resolution-field">
            Review note
            <textarea
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              minLength={10}
              maxLength={1000}
              placeholder="Describe the evidence reviewed and the outcome."
            />
          </label>
          <div className="modal-actions">
            <button
              className="secondary-btn"
              onClick={() => setResolvingId(undefined)}
            >
              Cancel
            </button>
            <button
              className="primary-btn"
              disabled={
                resolve.isPending ||
                resolutionCode.trim().length < 2 ||
                resolutionNote.trim().length < 10
              }
              onClick={() =>
                resolve.mutate({
                  id: resolvingId,
                  resolutionCode,
                  note: resolutionNote,
                })
              }
            >
              {resolve.isPending ? 'Saving…' : 'Confirm resolution'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Audit() {
  const { data } = useQuery({
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
            <ShieldCheck size={16} />
            {verify.isPending ? 'Verifying…' : 'Verify chain'}
          </button>
        }
      />
      {verify.data && (
        <div
          className={`verify-banner ${verify.data.valid ? 'verified' : 'invalid'}`}
        >
          <div className="verify-icon">
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
            <ArrowDownLeft size={15} /> Export
          </a>
        </div>
        {(data?.items ?? []).map((row) => (
          <div className="audit-row" key={row.seq}>
            <div className="audit-index">
              {String(row.seq).padStart(5, '0')}
            </div>
            <div className="audit-main">
              <b>{row.event_data.action.replaceAll(/[._]/g, ' ')}</b>
              <small>
                {row.event_data.actorId} <span>·</span>{' '}
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
        {!data?.items.length && (
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
      <span />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        {children}
      </section>
    </div>
  );
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
      <div className="empty-icon">{icon}</div>
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

export default App;
