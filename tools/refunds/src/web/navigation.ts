import {
  Activity,
  BookOpenCheck,
  CreditCard,
  Fingerprint,
  LayoutDashboard,
  WalletCards,
} from 'lucide-react';
import type { User } from './types.js';

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

export function canOpenPage(user: User, path: string) {
  const item = refundsNavigation.find((navigation) => navigation.to === path);
  return !item || item.roles.some((role) => user.roles.includes(role));
}
