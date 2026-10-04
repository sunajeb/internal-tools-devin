export const refundsPermissions = {
  'charge.search': ['agent', 'supervisor', 'finance', 'auditor'],
  'customer.reveal': ['supervisor', 'finance', 'auditor'],
  'refund.request': ['agent', 'supervisor'],
  'refund.approve': ['supervisor', 'finance'],
  'refund.read': ['agent', 'supervisor', 'finance', 'auditor'],
  'refund.read_all': ['supervisor', 'finance', 'auditor'],
  'dashboard.read': [
    'agent',
    'supervisor',
    'finance',
    'auditor',
    'platform_admin',
  ],
  'exception.resolve': ['finance'],
  'refund.export': ['finance', 'auditor'],
  'audit.read': ['auditor', 'platform_admin'],
  'execution.pause': ['platform_admin'],
};

export type RefundsPermission = keyof typeof refundsPermissions;
