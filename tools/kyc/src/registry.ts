import { definePolicy, defineTool } from '@internal-tools/foundation';

export const kycHighRiskThreshold = 70;

export const kycTool = defineTool({
  id: 'kyc',
  name: 'KYC Review Queue',
  owner: 'kyc-operations@company.example',
  dataClass: 'restricted',
  roles: {
    kyc_analyst: { idpGroup: 'kyc-analyst' },
    kyc_lead: { idpGroup: 'kyc-lead' },
    auditor: { idpGroup: 'auditor' },
  },
  permissions: {
    'kyc.read': ['kyc_analyst', 'kyc_lead', 'auditor'],
    'kyc.reveal': ['kyc_analyst', 'kyc_lead'],
    'kyc.work': ['kyc_analyst', 'kyc_lead'],
    'kyc.decide_escalated': ['kyc_lead'],
    'kyc.approve': ['kyc_lead'],
  },
  approvalPermissions: {
    'kyc.case_approval': 'kyc.approve',
  },
  approvalRules: {
    'kyc.case_approval': definePolicy({
      version: 1,
      tiers: [
        {
          name: 'standard',
          when: (request: { riskScore: number }) =>
            request.riskScore < kycHighRiskThreshold,
          steps: [],
        },
        {
          name: 'lead',
          when: () => true,
          steps: [['kyc_lead']],
        },
      ],
      expiresAfterHours: 72,
    }),
  },
});
