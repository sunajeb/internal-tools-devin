import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  Pause,
  ShieldCheck,
  WalletCards,
  XCircle,
} from 'lucide-react';
import { api, ErrorState } from '@internal-tools/ui-kit';
import { ApprovalsPreview } from '../components/approvals-preview.js';
import { PageHeader, Stat } from '../components/common.js';
import { RefundTable } from '../components/refund-table.js';
import { canOpenPage } from '../navigation.js';
import { can } from '../permissions.js';
import type { User } from '../types.js';
import { useDashboard } from '../hooks.js';

export function Overview({ user }: { user: User }) {
  const client = useQueryClient();
  const {
    data: dashboard,
    isLoading: dashboardLoading,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useDashboard();
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
  const action = can(user, 'execution.pause') ? (
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
        {can(user, 'refund.read') && (
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
        )}
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
          {can(user, 'refund.approve') && <ApprovalsPreview />}
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
