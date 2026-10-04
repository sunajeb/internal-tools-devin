import { definePolicy, defineTool } from '@internal-tools/foundation';
import { refundsPermissions } from './permissions.js';

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
  permissions: refundsPermissions,
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
