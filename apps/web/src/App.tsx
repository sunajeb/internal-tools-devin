import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, LockKeyhole, Shield } from 'lucide-react';
import {
  api,
  ErrorState,
  Layout,
  LoadingState,
  mainContentId,
} from '@internal-tools/ui-kit';
import { LedgerlineMark } from './LedgerlineMark.js';
import { webToolRegistry } from './tool-registry.js';

type User = { id: string; displayName: string; roles: string[] };
type Session = { authenticated: boolean; user?: User; environment: string };

function App() {
  const {
    data: session,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/api/session'),
  });
  if (isLoading) {
    return (
      <main className="app-status">
        <LoadingState label="Loading secure workspace" />
      </main>
    );
  }
  if (error) {
    return (
      <main className="app-status">
        <h1 className="sr-only">Ledgerline</h1>
        <ErrorState
          title="The workspace is not available"
          error={error}
          onRetry={() => void refetch()}
        />
      </main>
    );
  }
  if (!session?.authenticated) return <SignIn />;
  return <Shell session={session} />;
}

function SignIn() {
  useEffect(() => {
    document.title = 'Sign in · Ledgerline';
  }, []);
  return (
    <main className="login-shell">
      <div className="login-brand">
        <div className="brand-mark" aria-hidden="true">
          <LedgerlineMark size={18} />
        </div>
        <span>ledgerline</span>
        <small>INTERNAL OPERATIONS</small>
      </div>
      <section className="login-card">
        <div className="login-icon" aria-hidden="true">
          <LockKeyhole size={22} />
        </div>
        <p className="eyebrow">SECURE WORKSPACE</p>
        <h1>Sign in to Ledgerline</h1>
        <p className="muted">
          Use your company identity to access the payments operations console.
        </p>
        <a className="primary-btn full" href="/auth/login">
          Continue with company SSO <ArrowUpRight size={16} aria-hidden />
        </a>
        <div className="login-foot">
          <Shield size={15} aria-hidden /> Protected by your organization’s
          identity provider
        </div>
      </section>
      <div className="login-caption">
        Internal tools foundation <span aria-hidden="true">·</span> Access is
        monitored and audited
      </div>
    </main>
  );
}

function Shell({ session }: { session: Session }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const user = session.user!;
  const allLinks = webToolRegistry.flatMap((tool) => tool.navigation);
  const visibleLinks = allLinks.filter((item) =>
    item.roles.some((role) => user.roles.includes(role)),
  );
  const matchesPath = (to: string) =>
    to === '/'
      ? location.pathname === '/'
      : location.pathname === to || location.pathname.startsWith(`${to}/`);
  const active =
    visibleLinks
      .filter((item) => matchesPath(item.to))
      .sort((a, b) => b.to.length - a.to.length)[0] ??
    visibleLinks[0] ??
    allLinks[0]!;
  const landingRedirect =
    location.pathname === '/' &&
    visibleLinks.length > 0 &&
    !visibleLinks.some((item) => item.to === '/')
      ? visibleLinks[0]!.to
      : undefined;
  const activeTool =
    webToolRegistry.find((tool) =>
      tool.navigation.some((item) => item.to === active.to),
    ) ?? webToolRegistry[0]!;
  useEffect(() => {
    document.title = `${active.label} · ${activeTool.name} · Ledgerline`;
  }, [active.label, activeTool.name]);
  const logout = useMutation({
    mutationFn: () =>
      api<{ logoutUrl?: string }>('/api/logout', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: (result) => {
      if (result.logoutUrl) {
        window.location.assign(result.logoutUrl);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
  return (
    <div className="app-frame">
      <a className="skip-link" href={`#${mainContentId}`}>
        Skip to main content
      </a>
      <aside className="sidebar" aria-label="Workspace">
        <Link to="/" className="brand-lockup" aria-label="Ledgerline home">
          <div className="brand-mark" aria-hidden="true">
            <LedgerlineMark size={16} />
          </div>
          <div>
            <b>ledgerline</b>
            <small>OPS PLATFORM</small>
          </div>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="tool-select">
          <div className="tool-icon" aria-hidden="true">
            <activeTool.icon size={17} />
          </div>
          <div>
            <b>{activeTool.name}</b>
            <small>{activeTool.description}</small>
          </div>
        </div>
        <p className="nav-caption">OPERATIONS</p>
        <nav aria-label="Main navigation">
          {visibleLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`nav-item ${active.to === to ? 'selected' : ''}`}
              aria-current={active.to === to ? 'page' : undefined}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="uptime">
            <span className="pulse-dot" aria-hidden="true" />
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
      <div className="main-panel">
        <header className="topbar">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <span>{activeTool.name}</span>
            <span className="crumb-slash" aria-hidden="true">
              /
            </span>
            <b aria-current="page">{active.label}</b>
          </nav>
          <div className="top-actions">
            <div className="env-tag">
              <span aria-hidden="true" />
              {session.environment} ENVIRONMENT
            </div>
            <div className="top-divider" aria-hidden="true" />
            <div className="profile-btn">
              <span className="avatar" aria-hidden="true">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="profile-copy">
                <b>{user.displayName}</b>
                <small>{user.roles.join(' · ')}</small>
              </span>
              <button
                type="button"
                className="signout-btn"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                {logout.isPending ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        </header>
        {logout.error && (
          <div className="shell-alert" role="alert">
            Sign-out failed. {logout.error.message}
          </div>
        )}
        <Layout>
          {landingRedirect ? (
            <Navigate to={landingRedirect} replace />
          ) : (
            <Routes>
              {webToolRegistry.map((tool) => {
                const Pages = tool.Pages;
                return (
                  <Route
                    key={tool.id}
                    path={tool.routePath}
                    element={<Pages user={user} />}
                  />
                );
              })}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </Layout>
      </div>
    </div>
  );
}

export default App;
