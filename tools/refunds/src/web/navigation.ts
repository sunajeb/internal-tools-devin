import {
  Activity,
  BookOpenCheck,
  CreditCard,
  Fingerprint,
  LayoutDashboard,
  WalletCards,
} from 'lucide-react';
import { refundsPermissions } from '../permissions.js';
import type { User } from './types.js';

export const refundsNavigation = [
  {
    to: '/',
    label: 'Overview',
    icon: LayoutDashboard,
    roles: refundsPermissions['dashboard.read'],
  },
  {
    to: '/payments',
    label: 'Payments',
    icon: CreditCard,
    roles: refundsPermissions['charge.search'],
  },
  {
    to: '/refunds',
    label: 'Refunds',
    icon: WalletCards,
    roles: refundsPermissions['refund.read'],
  },
  {
    to: '/approvals',
    label: 'Approvals',
    icon: BookOpenCheck,
    roles: refundsPermissions['refund.approve'],
  },
  {
    to: '/exceptions',
    label: 'Reconciliation',
    icon: Activity,
    roles: refundsPermissions['exception.resolve'],
  },
  {
    to: '/audit',
    label: 'Audit & controls',
    icon: Fingerprint,
    roles: refundsPermissions['audit.read'],
  },
];

export function canOpenPage(user: User, path: string) {
  const item = refundsNavigation.find((navigation) => navigation.to === path);
  return !item || item.roles.some((role) => user.roles.includes(role));
}
