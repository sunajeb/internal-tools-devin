import { definePolicy, defineTool } from '@internal-tools/foundation';

export const refundsTool = defineTool({
  id: 'refunds',
  name: 'Refunds Console',
  owner: 'payments-ops@company.example',
  dataClass: 'restricted',
  roles: {
    agent: { idpGroup: 'refund-agent' },
    supervisor: { idpGroup: 'refund-supervisor' },
    finance: { idpGroup: 'refund-finance' },
    auditor: { idpGroup: 'auditor' },
    platform_admin: { idpGroup: 'platform-admin' },
  },
  permissions: {
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
  },
  approvalRules: {
    'refund.execute': definePolicy({
      version: 3,
      tiers: [
        {
          name: 'auto',
          when: (request: { amountMinor: bigint }) =>
            request.amountMinor <= 25_000n,
          steps: [],
        },
        {
          name: 'supervisor',
          when: (request: { amountMinor: bigint }) =>
            request.amountMinor <= 500_000n,
          steps: [['supervisor']],
        },
        {
          name: 'dual',
          when: () => true,
          steps: [['supervisor'], ['finance']],
        },
      ],
      expiresAfterHours: 72,
    }),
  },
});
