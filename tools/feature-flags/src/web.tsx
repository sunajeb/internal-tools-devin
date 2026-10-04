import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { BadgeCheck, Flag, History, Search, ShieldCheck } from 'lucide-react';
import {
  api,
  dateTime,
  ErrorState,
  LoadingState,
} from '@internal-tools/ui-kit';

type User = { id: string; displayName: string; roles: string[] };
const environmentNames = ['development', 'staging', 'production'] as const;
type EnvironmentName = (typeof environmentNames)[number];
type EnvironmentState = {
  enabled: boolean;
  rolloutPercent: number;
  version: number;
  updatedBy: string;
  updatedAt: string;
};
type FlagSummary = {
  key: string;
  description: string;
  owner: string;
  environments: Record<EnvironmentName, EnvironmentState>;
  pendingProductionChange: boolean;
};
type PendingChange = {
  changeRequestId: string;
  environment: EnvironmentName;
  enabled: boolean;
  rolloutPercent: number;
  baseVersion: number;
  reason: string;
  requesterId: string;
  approvalRequestId: string;
  createdAt: string;
};
type FlagDetail = Omit<FlagSummary, 'pendingProductionChange'> & {
  createdAt: string;
  pendingChanges: PendingChange[];
};
type HistoryItem = {
  seq: string;
  occurredAt: string;
  actorId: string;
  action: string;
  objectType: string;
  result: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
type ApprovalItem = {
  approval_id: string;
  action: string;
  created_at: string;
  requester_id: string;
  flagKey?: string;
  environment?: string;
  reason?: string;
  current?: { enabled: boolean; rolloutPercent: number };
  proposed?: { enabled: boolean; rolloutPercent: number };
};

const readRoles = ['flag_editor', 'flag_approver', 'auditor', 'platform_admin'];
const base = '/tools/feature-flags';
const environmentLabels: Record<EnvironmentName, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
};
const actionLabels: Record<string, string> = {
  'feature-flags.environment_changed': 'Changed environment',
  'feature-flags.production_change_requested': 'Requested production change',
  'feature-flags.production_change_rejected': 'Rejected production change',
  'approval.approved': 'Approved production change',
  'approval.rejected': 'Rejected production change',
  'approval.self_approval_denied': 'Self-approval refused',
  'approval.duplicate_denied': 'Duplicate approval refused',
};

export const featureFlagsNavigation = [
  { to: base, label: 'Feature flags', icon: Flag, roles: readRoles },
  {
    to: `${base}/approvals`,
    label: 'Flag approvals',
    icon: BadgeCheck,
    roles: ['flag_approver'],
  },
];

function stateText(state?: { enabled: boolean; rolloutPercent: number }) {
  if (!state) return 'Unknown';
  return state.enabled ? `On, ${state.rolloutPercent}%` : 'Off';
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

function StateBadge({
  state,
}: {
  state?: { enabled: boolean; rolloutPercent: number };
}) {
  return (
    <span
      className={`status-badge ${state?.enabled ? 'status-succeeded' : ''}`}
    >
      <span />
      {stateText(state)}
    </span>
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

function FlagList() {
  const [search, setSearch] = useState('');
  const flags = useInfiniteQuery({
    queryKey: ['feature-flags', 'list', search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (pageParam) params.set('after', pageParam);
      return api<{ items: FlagSummary[]; nextCursor: string | null }>(
        `/api/tools/feature-flags/flags?${params}`,
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = flags.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="page">
      <PageHeader
        kicker="PLATFORM / FEATURE FLAGS"
        title="Feature flags"
        detail="Find a flag. Open it to change its environments. A production change needs approval."
      />
      <section className="panel table-panel">
        <div className="toolbar">
          <label className="searchbox" htmlFor="flag-search">
            <Search size={17} aria-hidden="true" />
            <input
              id="flag-search"
              type="search"
              aria-label="Search flags"
              placeholder="Search key, description or owner"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="result-count" role="status">
            {flags.isFetching ? 'Searching…' : `${items.length} flags`}
          </span>
        </div>
        {flags.error && (
          <ErrorState
            title="Could not load flags"
            error={flags.error}
            onRetry={() => void flags.refetch()}
          />
        )}
        {flags.isLoading && <LoadingState label="Loading flags" />}
        <div className="table-scroll">
          <table aria-label="Feature flags">
            <thead>
              <tr>
                <th scope="col">FLAG</th>
                <th scope="col">OWNER</th>
                {environmentNames.map((environment) => (
                  <th scope="col" key={environment}>
                    {environment.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((flag) => (
                <tr key={flag.key}>
                  <td>
                    <Link
                      className="mono-id"
                      to={`${base}/flags/${encodeURIComponent(flag.key)}`}
                    >
                      {flag.key}
                    </Link>
                    <div className="subline">{flag.description}</div>
                  </td>
                  <td>{flag.owner}</td>
                  {environmentNames.map((environment) => (
                    <td key={environment}>
                      <StateBadge state={flag.environments[environment]} />
                      {environment === 'production' &&
                        flag.pendingProductionChange && (
                          <div className="subline">
                            Change waits for approval
                          </div>
                        )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!flags.isLoading && !flags.error && items.length === 0 && (
          <div className="empty-state">
            <b>No flags found</b>
            <span>Change the search text and try again.</span>
          </div>
        )}
        {flags.hasNextPage && (
          <div className="pagination">
            <button
              type="button"
              className="secondary-btn"
              disabled={flags.isFetchingNextPage}
              onClick={() => void flags.fetchNextPage()}
            >
              Show more flags
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function EnvironmentForm({
  flagKey,
  environment,
  state,
  pending,
  canWrite,
  message,
  onMessage,
}: {
  flagKey: string;
  environment: EnvironmentName;
  state: EnvironmentState;
  pending?: PendingChange;
  canWrite: boolean;
  message?: string;
  onMessage: (message: string) => void;
}) {
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(state.enabled);
  const [rollout, setRollout] = useState(String(state.rolloutPercent));
  const [reason, setReason] = useState('');
  const production = environment === 'production';
  const id = `${environment}-${flagKey}`;
  const save = useMutation({
    mutationFn: () =>
      api<{ status: string }>(
        `/api/tools/feature-flags/flags/${encodeURIComponent(flagKey)}/environments/${environment}`,
        {
          method: 'PUT',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            enabled,
            rolloutPercent: Number(rollout),
            expectedVersion: state.version,
            ...(production ? { reason } : {}),
          }),
        },
      ),
    onSuccess: (result) => {
      onMessage(
        result.status === 'pending_approval'
          ? 'The production change waits for approval. A flag approver must approve it.'
          : `${environmentLabels[environment]} is updated.`,
      );
      return client.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });
  const locked = !canWrite || (production && Boolean(pending));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onMessage('');
    save.mutate();
  };
  return (
    <form className="panel" style={{ padding: 18 }} onSubmit={submit}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }} disabled={locked}>
        <legend className="section-subtitle">
          <b>{environmentLabels[environment]}</b>
        </legend>
        <div className="detail-list" style={{ gridTemplateColumns: '1fr' }}>
          <div className="detail-row">
            <span>Current state</span>
            <b>
              <StateBadge state={state} />
            </b>
          </div>
          <div className="detail-row">
            <span>Last change</span>
            <b>
              {state.updatedBy}, {dateTime(state.updatedAt)}
            </b>
          </div>
        </div>
        <label className="field-label" htmlFor={`${id}-enabled`}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id={`${id}-enabled`}
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enabled in {environment}
          </span>
        </label>
        <label className="field-label" htmlFor={`${id}-rollout`}>
          Rollout percent for {environment}
        </label>
        <input
          id={`${id}-rollout`}
          className="money-input"
          style={{ width: '100%', padding: '0 10px' }}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          required
          aria-describedby={`${id}-rollout-hint`}
          value={rollout}
          onChange={(event) => setRollout(event.target.value)}
        />
        <p id={`${id}-rollout-hint`} className="field-hint">
          Use a whole number from 0 to 100.
        </p>
        {production && (
          <>
            <label className="field-label" htmlFor={`${id}-reason`}>
              Reason for production change
            </label>
            <textarea
              id={`${id}-reason`}
              className="money-input"
              style={{ width: '100%', height: 70, padding: 10 }}
              required
              minLength={10}
              maxLength={500}
              aria-describedby={`${id}-reason-hint`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id={`${id}-reason-hint`} className="field-hint">
              Write 10 to 500 characters. {reason.length}/500 used.
            </p>
          </>
        )}
        <div className="modal-actions" style={{ marginTop: 14 }}>
          <button
            type="submit"
            className="primary-btn"
            disabled={save.isPending}
          >
            {production ? 'Request production change' : `Save ${environment}`}
          </button>
        </div>
      </fieldset>
      {production && pending && (
        <p className="notice" role="note">
          <ShieldCheck size={16} aria-hidden="true" />
          {pending.requesterId} requested {stateText(pending)} on{' '}
          {dateTime(pending.createdAt)}. Reason:{' '}
          {pending.reason.replace(/\.$/, '')}. The change waits for a flag
          approver.
        </p>
      )}
      {!canWrite && (
        <p className="subline">
          Your role can view this flag. It cannot change it.
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {save.error && (
        <p className="form-error" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

function FlagHistory({ flagKey }: { flagKey: string }) {
  const history = useInfiniteQuery({
    queryKey: ['feature-flags', 'history', flagKey],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ items: HistoryItem[]; nextCursor: string | null }>(
        `/api/tools/feature-flags/flags/${encodeURIComponent(flagKey)}/history${
          pageParam ? `?before=${pageParam}` : ''
        }`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const describe = (value: Record<string, unknown> | null) => {
    if (!value) return '';
    if ('enabled' in value) {
      const environment = value.environment ? `${value.environment}: ` : '';
      return `${environment}${stateText(value as { enabled: boolean; rolloutPercent: number })}`;
    }
    return Object.entries(value)
      .filter(([, item]) => typeof item !== 'object')
      .map(([name, item]) => `${name} ${String(item)}`)
      .join(', ');
  };
  return (
    <section className="panel table-panel" aria-labelledby="history-title">
      <div className="panel-head">
        <h2 id="history-title">
          <History size={16} aria-hidden="true" /> Change history
        </h2>
      </div>
      <div className="table-scroll">
        <table aria-label="Change history">
          <thead>
            <tr>
              <th scope="col">TIME</th>
              <th scope="col">ACTOR</th>
              <th scope="col">ACTION</th>
              <th scope="col">BEFORE</th>
              <th scope="col">AFTER</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.seq}>
                <td className="date-cell">{dateTime(item.occurredAt)}</td>
                <td>{item.actorId}</td>
                <td>{actionLabels[item.action] ?? item.action}</td>
                <td>{describe(item.before)}</td>
                <td>{describe(item.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.error && (
        <ErrorState
          title="Could not load history"
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      )}
      {history.isLoading && <LoadingState label="Loading history" />}
      {!history.isLoading && !history.error && items.length === 0 && (
        <div className="empty-state">
          <b>No changes yet</b>
          <span>The audit log has no events for this flag.</span>
        </div>
      )}
      {history.hasNextPage && (
        <div className="pagination">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void history.fetchNextPage()}
          >
            Show older events
          </button>
        </div>
      )}
    </section>
  );
}

function FlagDetailPage({ user }: { user: User }) {
  const { key = '' } = useParams();
  const flag = useQuery({
    queryKey: ['feature-flags', 'detail', key],
    queryFn: () =>
      api<FlagDetail>(
        `/api/tools/feature-flags/flags/${encodeURIComponent(key)}`,
      ),
  });
  const [messages, setMessages] = useState<
    Partial<Record<EnvironmentName, string>>
  >({});
  const canWrite = user.roles.includes('flag_editor');
  if (flag.error) {
    return (
      <div className="page">
        <PageHeader kicker="FEATURE FLAGS" title={key} detail="" />
        <ErrorState
          title="Could not load the flag"
          error={flag.error}
          onRetry={() => void flag.refetch()}
        />
        <Link className="secondary-btn" to={base}>
          Back to flags
        </Link>
      </div>
    );
  }
  if (!flag.data) return <LoadingState label="Loading flag" />;
  const data = flag.data;
  return (
    <div className="page">
      <PageHeader
        kicker={`FEATURE FLAGS / OWNER ${data.owner.toUpperCase()}`}
        title={data.key}
        detail={data.description}
        action={
          <Link className="secondary-btn" to={base}>
            Back to flags
          </Link>
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          marginBottom: 16,
        }}
      >
        {environmentNames.map((environment) => {
          const state = data.environments[environment];
          return (
            <EnvironmentForm
              key={`${environment}-${state.version}-${data.pendingChanges.length}`}
              flagKey={data.key}
              environment={environment}
              state={state}
              pending={data.pendingChanges.find(
                (change) => change.environment === environment,
              )}
              canWrite={canWrite}
              message={messages[environment]}
              onMessage={(message) =>
                setMessages((current) => ({
                  ...current,
                  [environment]: message,
                }))
              }
            />
          );
        })}
      </div>
      <FlagHistory flagKey={data.key} />
    </div>
  );
}

function ApprovalsPage({ user }: { user: User }) {
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const approvals = useQuery({
    queryKey: ['feature-flags', 'approvals'],
    queryFn: () =>
      api<{ items: ApprovalItem[] }>('/api/approvals?tool=feature-flags'),
  });
  const decide = useMutation({
    mutationFn: ({
      item,
      decision,
    }: {
      item: ApprovalItem;
      decision: 'approve' | 'reject';
    }) =>
      api(`/api/approvals/${item.approval_id}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ stepIndex: 0 }),
      }),
    onSuccess: (_result, { item, decision }) => {
      setMessage(
        decision === 'approve'
          ? `${item.flagKey ?? 'The flag'} is now ${stateText(item.proposed)} in production.`
          : `The production change for ${item.flagKey ?? 'the flag'} is rejected.`,
      );
      return client.invalidateQueries({ queryKey: ['feature-flags'] });
    },
  });
  const items = approvals.data?.items ?? [];
  return (
    <div className="page">
      <PageHeader
        kicker="FEATURE FLAGS / APPROVALS"
        title="Production approvals"
        detail="Review production flag changes. You cannot approve your own request."
      />
      {message && (
        <div className="notice" role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          {message}
        </div>
      )}
      {decide.error && (
        <div className="notice notice-warn" role="alert">
          {decide.error.message}
        </div>
      )}
      <section className="panel inbox-panel" aria-label="Approval inbox">
        {items.map((item) => {
          const own = item.requester_id === user.id;
          return (
            <article className="approval-card" key={item.approval_id}>
              <div className="approval-card-main">
                <div className="approval-symbol">
                  <Flag size={18} aria-hidden="true" />
                </div>
                <div className="approval-copy">
                  <div className="approval-title">
                    <b>
                      <Link
                        to={`${base}/flags/${encodeURIComponent(item.flagKey ?? '')}`}
                      >
                        {item.flagKey}
                      </Link>{' '}
                      in production
                    </b>
                  </div>
                  <div className="approval-meta">
                    {stateText(item.current)} to {stateText(item.proposed)}
                    <span className="meta-dot">·</span> requested by{' '}
                    <b>{item.requester_id}</b>
                    <span className="meta-dot">·</span>
                    {dateTime(item.created_at)}
                  </div>
                  <p>{item.reason}</p>
                </div>
              </div>
              <div className="approval-actions">
                {own && (
                  <span className="muted">
                    You cannot approve your own request.
                  </span>
                )}
                <button
                  type="button"
                  className="decline-btn"
                  aria-label={`Reject production change for ${item.flagKey}`}
                  disabled={decide.isPending || own}
                  onClick={() => decide.mutate({ item, decision: 'reject' })}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="primary-btn small-btn"
                  aria-label={`Approve production change for ${item.flagKey}`}
                  disabled={decide.isPending || own}
                  onClick={() => decide.mutate({ item, decision: 'approve' })}
                >
                  Approve
                </button>
              </div>
            </article>
          );
        })}
        {approvals.error && (
          <ErrorState
            title="Could not load approvals"
            error={approvals.error}
            onRetry={() => void approvals.refetch()}
          />
        )}
        {approvals.isLoading && <LoadingState label="Loading approvals" />}
        {!approvals.isLoading && !approvals.error && items.length === 0 && (
          <div className="empty-state">
            <b>No changes wait for approval</b>
            <span>New production requests show here.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function FeatureFlagsPages({ user }: { user: User }) {
  if (!user.roles.some((role) => readRoles.includes(role))) {
    return <AccessDenied />;
  }
  return (
    <Routes>
      <Route path="/" element={<FlagList />} />
      <Route path="/flags/:key" element={<FlagDetailPage user={user} />} />
      <Route
        path="/approvals"
        element={
          user.roles.includes('flag_approver') ? (
            <ApprovalsPage user={user} />
          ) : (
            <AccessDenied />
          )
        }
      />
      <Route path="*" element={<Navigate to={base} replace />} />
    </Routes>
  );
}

export const tool = {
  id: 'feature-flags',
  name: 'Feature-Flag Panel',
  description: 'Change feature flags. Production changes need approval.',
  routePath: '/tools/feature-flags/*',
  icon: Flag,
  navigation: featureFlagsNavigation,
  Pages: FeatureFlagsPages,
};
