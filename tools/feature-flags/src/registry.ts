import { defineTool } from '@internal-tools/foundation';

export const featureFlagsToolId = 'feature-flags';
export const productionChangeAction = 'feature-flags.production_change';

export const environments = ['development', 'staging', 'production'] as const;

export const featureFlagsTool = defineTool({
  id: featureFlagsToolId,
  name: 'Feature-Flag Panel',
  owner: 'platform-engineering@company.example',
  dataClass: 'internal',
  roles: {
    flag_editor: { idpGroup: 'flag-editor' },
    flag_approver: { idpGroup: 'flag-approver' },
    auditor: { idpGroup: 'auditor' },
    platform_admin: { idpGroup: 'platform-admin' },
  },
  permissions: {
    'feature-flags.read': [
      'flag_editor',
      'flag_approver',
      'auditor',
      'platform_admin',
    ],
    'feature-flags.write': ['flag_editor'],
    'feature-flags.approve': ['flag_approver'],
  },
  approvalPermissions: {
    [productionChangeAction]: 'feature-flags.approve',
  },
});
