import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  Clock3,
  Eye,
  Search,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import {
  api,
  dateTime,
  Dialog,
  ErrorState,
  LoadingState,
} from '@internal-tools/ui-kit';

type User = { id: string; displayName: string; roles: string[] };
type CaseStatus = 'new' | 'in_review' | 'escalated' | 'approved' | 'rejected';
type PiiField = 'customer_name' | 'date_of_birth' | 'national_id';
type KycCase = {
  id: string;
  reference: string;
  customer_name: string;
  date_of_birth: string;
  national_id: string;
  country: string;
  risk_score: number;
  risk_band: 'low' | 'medium' | 'high';
  status: CaseStatus;
  assignee: string | null;
  sla_due_at: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  pending_approval_id: string | null;
};
type CaseDetail = KycCase & {
  pending_approval: {
    id: string;
    status: string;
    requester_id: string;
    expires_at: string;
  } | null;
  timeline: Array<{
    seq: string;
    action: string;
    actor_id: string;
    occurred_at: string;
    result: string;
  }>;
};
type Approval = {
  approval_id: string;
  requester_id: string;
  created_at: string;
  tier: string;
  case_id: string;
  case_reference: string;
  risk_score: number;
  country: string;
  note: string | null;
  steps: Array<{ roles: string[]; approvals: unknown[] }>;
};

const statusLabels: Record<CaseStatus, string> = {
  new: 'New',
  in_review: 'In review',
  escalated: 'Escalated',
  approved: 'Approved',
  rejected: 'Rejected',
};
const statusStyles: Record<CaseStatus, string> = {
  new: 'pending',
  in_review: 'executing',
  escalated: 'supervisor',
  approved: 'approved',
  rejected: 'rejected',
};
const countries = [
  'CA',
  'DE',
  'ES',
  'FR',
  'GB',
  'IE',
  'IT',
  'NL',
  'PL',
  'PT',
  'SE',
  'US',
];
const piiLabels: Record<PiiField, string> = {
  customer_name: 'Customer name',
  date_of_birth: 'Date of birth',
  national_id: 'National ID',
};
const workerRoles = ['kyc_analyst', 'kyc_lead'];

export const kycNavigation = [
  {
    to: '/tools/kyc',
    label: 'KYC queue',
    icon: UserCheck,
    roles: ['kyc_analyst', 'kyc_lead', 'auditor'],
  },
  {
    to: '/tools/kyc/approvals',
    label: 'KYC approvals',
    icon: BookOpenCheck,
    roles: ['kyc_lead'],
  },
];

const hasRole = (user: User, roles: string[]) =>
  roles.some((role) => user.roles.includes(role));

export function KycPages({ user }: { user: User }) {
  if (!hasRole(user, kycNavigation[0]!.roles)) return <AccessDenied />;
  return (
    <Routes>
      <Route index element={<Queue user={user} />} />
      <Route path="cases/:id" element={<CaseView user={user} />} />
      <Route
        path="approvals"
        element={
          hasRole(user, kycNavigation[1]!.roles) ? (
            <Approvals user={user} />
          ) : (
            <AccessDenied />
          )
        }
      />
      <Route path="*" element={<Navigate to="/tools/kyc" replace />} />
    </Routes>
  );
}

function Queue({ user }: { user: User }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [risk, setRisk] = useState('');
  const [sort, setSort] = useState('sla_due_at');
  const [dir, setDir] = useState('asc');
  const [mine, setMine] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const resetPages = () => setCursors([]);
  const { data, isFetching, error } = useQuery({
    queryKey: [
      'kyc',
      'cases',
      query,
      status,
      country,
      risk,
      sort,
      dir,
      mine,
      cursor,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ sort, dir, limit: '25' });
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      if (country) params.set('country', country);
      if (risk) params.set('risk', risk);
      if (mine) params.set('assignee', 'me');
      if (cursor) params.set('cursor', cursor);
      return api<{ items: KycCase[]; nextCursor: string | null }>(
        `/api/tools/kyc/cases?${params}`,
      );
    },
    placeholderData: (previous) => previous,
  });
  const select = (
    label: string,
    value: string,
    set: (value: string) => void,
    options: Array<[string, string]>,
  ) => (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) => {
          set(event.target.value);
          resetPages();
        }}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="page">
      <PageHeader
        kicker="KYC / REVIEW QUEUE"
        title="KYC review queue"
        detail="Claim a case, check the customer, and record a decision. Personal data stays hidden until you reveal it with a reason."
      />
      <section className="panel table-panel">
        <div className="toolbar">
          <label className="searchbox">
            <Search size={17} />
            <input
              aria-label="Search cases"
              placeholder="Search case reference or customer name"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                resetPages();
              }}
            />
          </label>
          <span className="result-count" aria-live="polite">
            {isFetching
              ? 'Searching…'
              : `${data?.items.length ?? 0} cases on this page`}
          </span>
        </div>
        <div className="filter-panel" role="group" aria-label="Queue filters">
          {select('Status', status, setStatus, [
            ['', 'All statuses'],
            ...Object.entries(statusLabels),
          ])}
          {select('Country', country, setCountry, [
            ['', 'All countries'],
            ...countries.map((code): [string, string] => [code, code]),
          ])}
          {select('Risk band', risk, setRisk, [
            ['', 'All risk bands'],
            ['low', 'Low (0–39)'],
            ['medium', 'Medium (40–69)'],
            ['high', 'High (70–100)'],
          ])}
          {select('Sort by', sort, setSort, [
            ['sla_due_at', 'SLA due time'],
            ['created_at', 'Created time'],
            ['risk_score', 'Risk score'],
          ])}
          {select('Order', dir, setDir, [
            ['asc', 'Ascending'],
            ['desc', 'Descending'],
          ])}
          {hasRole(user, workerRoles) &&
            select(
              'Assignee',
              mine ? 'me' : '',
              (value) => setMine(value === 'me'),
              [
                ['', 'Anyone'],
                ['me', 'Only my cases'],
              ],
            )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}
        <CaseTable cases={data?.items ?? []} />
        <nav className="pagination" aria-label="Queue pages">
          <span>Page {cursors.length + 1}</span>
          <button
            className="secondary-btn compact-btn"
            disabled={!cursors.length || isFetching}
            onClick={() => setCursors((pages) => pages.slice(0, -1))}
          >
            <ArrowLeft size={13} /> Previous page
          </button>
          <button
            className="secondary-btn compact-btn"
            disabled={!data?.nextCursor || isFetching}
            onClick={() =>
              data?.nextCursor &&
              setCursors((pages) => [...pages, data.nextCursor!])
            }
          >
            Next page <ArrowRight size={13} />
          </button>
        </nav>
      </section>
    </div>
  );
}

function CaseTable({ cases }: { cases: KycCase[] }) {
  const navigate = useNavigate();
  return (
    <div className="table-scroll">
      <table aria-label="KYC cases">
        <thead>
          <tr>
            <th scope="col">CASE</th>
            <th scope="col">CUSTOMER</th>
            <th scope="col">COUNTRY</th>
            <th scope="col">RISK</th>
            <th scope="col">STATUS</th>
            <th scope="col">ASSIGNEE</th>
            <th scope="col">SLA DUE</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => (
            <tr
              key={item.id}
              className="clickable-row"
              onClick={() => navigate(`/tools/kyc/cases/${item.id}`)}
            >
              <td>
                <Link
                  className="mono-id"
                  to={`/tools/kyc/cases/${item.id}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {item.reference}
                </Link>
              </td>
              <td>
                <b>{item.customer_name}</b>
                <small className="subline">ID {item.national_id}</small>
              </td>
              <td>{item.country}</td>
              <td>
                <b>{item.risk_score}</b>
                <small className="subline">{item.risk_band}</small>
              </td>
              <td>
                <StatusBadge status={item.status} />
              </td>
              <td>{item.assignee ?? 'Not assigned'}</td>
              <td className="date-cell">{dateTime(item.sla_due_at)}</td>
            </tr>
          ))}
          {!cases.length && (
            <tr>
              <td colSpan={7}>
                <EmptyState
                  icon={<Search />}
                  title="No cases found"
                  detail="Change the search text or the filters."
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type Action = 'approve' | 'reject' | 'escalate';
const actionText: Record<
  Action,
  { label: string; field: string; help: string }
> = {
  approve: {
    label: 'Approve',
    field: 'Decision note (optional)',
    help: 'A KYC lead must approve a case with a risk score of 70 or more.',
  },
  reject: {
    label: 'Reject',
    field: 'Reason for rejection',
    help: 'Write a minimum of 10 characters.',
  },
  escalate: {
    label: 'Escalate',
    field: 'Reason for escalation',
    help: 'A KYC lead decides escalated cases. Write a minimum of 10 characters.',
  },
};

function CaseView({ user }: { user: User }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const [revealed, setRevealed] = useState<Partial<Record<PiiField, string>>>(
    {},
  );
  const [revealField, setRevealField] = useState<PiiField>();
  const [action, setAction] = useState<Action>();
  const [message, setMessage] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['kyc', 'case', id],
    queryFn: () => api<CaseDetail>(`/api/tools/kyc/cases/${id}`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['kyc'] });
  const claim = useMutation({
    mutationFn: () =>
      api(`/api/tools/kyc/cases/${id}/claim`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: '{}',
      }),
    onSuccess: () => {
      setMessage('You claimed this case. The status is now in review.');
      return refresh();
    },
    onError: (failure: Error) => setMessage(failure.message),
  });
  if (isLoading) {
    return (
      <div className="page">
        <LoadingState label="Loading case" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState
          title="The case is not available"
          error={error ?? new Error('Case not found.')}
        />
        <Link className="text-link" to="/tools/kyc">
          Back to the queue
        </Link>
      </div>
    );
  }
  const isWorker = hasRole(user, workerRoles);
  const isLead = user.roles.includes('kyc_lead');
  const waiting =
    data.pending_approval?.status === 'pending' &&
    new Date(data.pending_approval.expires_at) > new Date();
  const canReveal = isWorker && (data.assignee === user.id || isLead);
  const canDecide =
    isWorker &&
    !waiting &&
    ((data.status === 'in_review' && data.assignee === user.id) ||
      (data.status === 'escalated' && isLead));
  return (
    <div className="page">
      <Link className="text-link" to="/tools/kyc">
        <ArrowLeft size={14} /> Back to the queue
      </Link>
      <PageHeader
        kicker="KYC / CASE"
        title={data.reference}
        detail={`Risk score ${data.risk_score} (${data.risk_band}). SLA due ${dateTime(data.sla_due_at)}.`}
        action={<StatusBadge status={data.status} />}
      />
      {message && (
        <div className="notice" role="status">
          <ShieldCheck size={16} />
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {waiting && (
        <div className="notice notice-warn" role="status">
          <Clock3 size={16} />
          This case waits for a KYC lead approval.{' '}
          {data.pending_approval!.requester_id} sent the request. A different
          KYC lead must approve it.
        </div>
      )}
      <div className="content-grid">
        <section className="panel" aria-labelledby="kyc-customer-heading">
          <div className="panel-head">
            <div>
              <h2 id="kyc-customer-heading">Customer</h2>
              <p>
                {canReveal
                  ? 'Each reveal needs a reason. The audit log records it.'
                  : 'Personal data is hidden for your role or because you do not own this case.'}
              </p>
            </div>
          </div>
          <div className="detail-list">
            {(Object.keys(piiLabels) as PiiField[]).map((field) => (
              <div className="detail-row" key={field}>
                <span>{piiLabels[field]}</span>
                <b data-testid={`kyc-${field}`}>
                  {revealed[field] ?? data[field]}
                </b>
                {canReveal && (
                  <button
                    className="reveal-btn"
                    disabled={Boolean(revealed[field])}
                    aria-label={`Reveal ${piiLabels[field].toLowerCase()}`}
                    onClick={() => setRevealField(field)}
                  >
                    <Eye size={13} /> {revealed[field] ? 'Revealed' : 'Reveal'}
                  </button>
                )}
              </div>
            ))}
            <Detail label="Country" value={data.country} />
          </div>
        </section>
        <section className="panel" aria-labelledby="kyc-case-heading">
          <div className="panel-head">
            <div>
              <h2 id="kyc-case-heading">Case</h2>
              <p>
                Valid steps: new → in review → approved, rejected or escalated.
              </p>
            </div>
          </div>
          <div className="detail-list">
            <Detail label="Assignee" value={data.assignee ?? 'Not assigned'} />
            <Detail label="Created" value={dateTime(data.created_at)} />
            <Detail label="SLA due" value={dateTime(data.sla_due_at)} />
            {data.decided_by && (
              <Detail
                label="Decided"
                value={`${data.decided_by} · ${dateTime(data.decided_at!)}`}
              />
            )}
          </div>
          {isWorker && (
            <div className="modal-actions">
              {data.status === 'new' && (
                <button
                  className="primary-btn"
                  disabled={claim.isPending}
                  onClick={() => claim.mutate()}
                >
                  <UserCheck size={15} /> Claim case
                </button>
              )}
              {canDecide &&
                (['approve', 'reject', 'escalate'] as Action[])
                  .filter(
                    (item) =>
                      item !== 'escalate' || data.status === 'in_review',
                  )
                  .map((item) => (
                    <button
                      key={item}
                      className={
                        item === 'approve' ? 'primary-btn' : 'secondary-btn'
                      }
                      onClick={() => setAction(item)}
                    >
                      {actionText[item].label}
                    </button>
                  ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel" aria-labelledby="kyc-history-heading">
        <div className="panel-head">
          <div>
            <h2 id="kyc-history-heading">Audit history</h2>
            <p>The Foundation audit log records each step.</p>
          </div>
        </div>
        {data.timeline.length ? (
          <div className="timeline-list" role="list">
            {data.timeline.map((event) => (
              <div className="timeline-event" role="listitem" key={event.seq}>
                <span className="timeline-dot" />
                <div>
                  <b>{event.action.replace('kyc.', '').replaceAll('_', ' ')}</b>
                  <small>
                    {event.actor_id} · {dateTime(event.occurred_at)} ·{' '}
                    {event.result}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-inline">No events are recorded for this case.</p>
        )}
      </section>
      {revealField && (
        <RevealDialog
          caseId={data.id}
          field={revealField}
          onClose={() => setRevealField(undefined)}
          onRevealed={(value) => {
            setRevealed((current) => ({ ...current, [revealField]: value }));
            setRevealField(undefined);
            void refresh();
          }}
        />
      )}
      {action && (
        <ActionDialog
          caseId={data.id}
          action={action}
          onClose={() => setAction(undefined)}
          onDone={(text) => {
            setAction(undefined);
            setMessage(text);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function RevealDialog({
  caseId,
  field,
  onClose,
  onRevealed,
}: {
  caseId: string;
  field: PiiField;
  onClose: () => void;
  onRevealed: (value: string) => void;
}) {
  const [reason, setReason] = useState('');
  const reveal = useMutation({
    mutationFn: () =>
      api<{ value: string }>(`/api/tools/kyc/cases/${caseId}/reveal`, {
        method: 'POST',
        body: JSON.stringify({ field, reason }),
      }),
    onSuccess: (result) => onRevealed(result.value),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    reveal.mutate();
  };
  return (
    <Dialog onClose={onClose} labelledBy="kyc-reveal-title">
      <form onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">AUDITED ACTION</p>
            <h2 id="kyc-reveal-title">
              Reveal {piiLabels[field].toLowerCase()}
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <label className="field-label">
          Reason for access
          <textarea
            data-autofocus
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <p className="modal-subtitle">
          Write a minimum of 10 characters. The audit log keeps your reason.
        </p>
        {reveal.error && (
          <p className="form-error" role="alert">
            {reveal.error.message}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-btn"
            disabled={reveal.isPending || reason.trim().length < 10}
          >
            Reveal field
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ActionDialog({
  caseId,
  action,
  onClose,
  onDone,
}: {
  caseId: string;
  action: Action;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const optional = action === 'approve';
  const mutation = useMutation({
    mutationFn: () =>
      api<{ status: CaseStatus; approval_id?: string }>(
        `/api/tools/kyc/cases/${caseId}/${action}`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(
            optional
              ? text.trim()
                ? { note: text.trim() }
                : {}
              : { reason: text },
          ),
        },
      ),
    onSuccess: (result) =>
      onDone(
        result.approval_id
          ? 'The risk score is 70 or more. A different KYC lead must approve this case.'
          : `The case status is now ${statusLabels[result.status].toLowerCase()}.`,
      ),
  });
  const copy = actionText[action];
  return (
    <Dialog onClose={onClose} labelledBy="kyc-action-title">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">CASE DECISION</p>
            <h2 id="kyc-action-title">{copy.label} case</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <label className="field-label">
          {copy.field}
          <textarea
            data-autofocus
            required={!optional}
            minLength={optional ? undefined : 10}
            maxLength={500}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <p className="modal-subtitle">{copy.help}</p>
        {mutation.error && (
          <p className="form-error" role="alert">
            {mutation.error.message}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-btn"
            disabled={
              mutation.isPending || (!optional && text.trim().length < 10)
            }
          >
            Confirm {copy.label.toLowerCase()}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Approvals({ user }: { user: User }) {
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const { data } = useQuery({
    queryKey: ['kyc', 'approvals'],
    queryFn: () => api<{ items: Approval[] }>('/api/approvals?tool=kyc'),
  });
  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: 'approve' | 'reject';
    }) =>
      api(`/api/approvals/${id}/${decision}`, { method: 'POST', body: '{}' }),
    onSuccess: (_result, { decision }) => {
      setMessage(
        decision === 'approve'
          ? 'Approval recorded. The case is now approved.'
          : 'Request declined. The case stays open for the analyst.',
      );
      return client.invalidateQueries({ queryKey: ['kyc'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });
  return (
    <div className="page">
      <PageHeader
        kicker="KYC / APPROVALS"
        title="KYC approval inbox"
        detail="High-risk approvals need a second person. The server blocks approval of your own request."
        action={
          <span className="inbox-count">
            {data?.items.length ?? 0} OPEN REQUESTS
          </span>
        }
      />
      {message && (
        <div className="notice" role="status">
          <ShieldCheck size={16} />
          {message}
          <button aria-label="Dismiss message" onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}
      <section className="panel inbox-panel" aria-label="KYC approval requests">
        {(data?.items ?? []).map((item) => {
          const own = item.requester_id === user.id;
          return (
            <article className="approval-card" key={item.approval_id}>
              <div className="approval-card-main">
                <div className="approval-symbol">
                  <UserCheck size={18} />
                </div>
                <div className="approval-copy">
                  <div className="approval-title">
                    <b>Approve case {item.case_reference}</b>
                    <StatusBadge status={item.tier} />
                  </div>
                  <div className="approval-meta">
                    Risk score {item.risk_score} · {item.country}
                    <span className="meta-dot">·</span> sent by{' '}
                    <b>{item.requester_id}</b>
                    <span className="meta-dot">·</span>
                    {dateTime(item.created_at)}
                  </div>
                  {item.note && <p>{item.note}</p>}
                  <Link
                    className="text-link"
                    to={`/tools/kyc/cases/${item.case_id}`}
                  >
                    Open case {item.case_reference}
                  </Link>
                </div>
              </div>
              <div className="approval-actions">
                {own && (
                  <span className="subline">
                    You cannot approve your own request.
                  </span>
                )}
                <button
                  className="decline-btn"
                  disabled={decide.isPending || own}
                  onClick={() =>
                    decide.mutate({ id: item.approval_id, decision: 'reject' })
                  }
                >
                  Decline
                </button>
                <button
                  className="primary-btn small-btn"
                  disabled={decide.isPending || own}
                  onClick={() =>
                    decide.mutate({ id: item.approval_id, decision: 'approve' })
                  }
                >
                  Approve as KYC lead
                </button>
              </div>
            </article>
          );
        })}
        {!data?.items.length && (
          <EmptyState
            icon={<Check />}
            title="No open requests"
            detail="No KYC case waits for your approval."
          />
        )}
      </section>
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
        <p>{detail}</p>
      </div>
      {action}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status as CaseStatus] ?? status;
  return (
    <span className={`status-badge status-${style}`}>
      <span />
      {statusLabels[status as CaseStatus] ?? status.replaceAll('_', ' ')}
    </span>
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

function AccessDenied() {
  return (
    <div className="page">
      <EmptyState
        icon={<ShieldCheck />}
        title="You do not have access"
        detail="Ask your manager for a KYC role in the company directory."
      />
    </div>
  );
}

export const kycWebTool = {
  id: 'kyc',
  name: 'KYC Review Queue',
  description: 'Customer due diligence',
  routePath: '/tools/kyc/*',
  icon: UserCheck,
  navigation: kycNavigation,
  Pages: KycPages,
};

export const tool = kycWebTool;
export default KycPages;
