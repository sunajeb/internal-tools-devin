import { Navigate, Route, Routes } from 'react-router-dom';
import { WalletCards } from 'lucide-react';
import { AccessDenied } from './components/common.js';
import { canOpenPage, refundsNavigation } from './navigation.js';
import { Approvals } from './pages/approvals.js';
import { Audit } from './pages/audit.js';
import { Exceptions } from './pages/exceptions.js';
import { Overview } from './pages/overview.js';
import { Payments } from './pages/payments.js';
import { Refunds } from './pages/refunds.js';
import type { User } from './types.js';

function RefundsPages({ user }: { user: User }) {
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

export const tool = {
  id: 'refunds',
  name: 'Refunds Console',
  description: 'Payments operations',
  routePath: '*',
  icon: WalletCards,
  navigation: refundsNavigation,
  Pages: RefundsPages,
};

export { refundsNavigation } from './navigation.js';
export type { User } from './types.js';
