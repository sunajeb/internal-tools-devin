import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, LockKeyhole, Shield, ShieldCheck } from 'lucide-react';
import { api, Layout } from '@internal-tools/ui-kit';
import { webToolRegistry } from './tool-registry.js';

type User = { id: string; displayName: string; roles: string[] };
type Session = { authenticated: boolean; user?: User; environment: string };

function App() {
  const { data: session, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/api/session'),
  });
  if (isLoading) {
    return (
      <div className="loading">
        <span className="loader" />
        Loading secure workspace
      </div>
    );
  }
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
  const allLinks = webToolRegistry.flatMap((tool) => tool.navigation);
  const visibleLinks = allLinks.filter((item) =>
    item.roles.some((role) => user.roles.includes(role)),
  );
  const active =
    visibleLinks.find((item) => item.to === location.pathname) ??
    visibleLinks[0] ??
    allLinks[0]!;
  const activeTool =
    webToolRegistry.find((tool) =>
      tool.navigation.some((item) => item.to === active.to),
    ) ?? webToolRegistry[0]!;
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
            <span>{activeTool.name}</span>
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
        <Layout>
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
        </Layout>
      </main>
    </div>
  );
}

export default App;
