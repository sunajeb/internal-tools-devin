import type { ToolDefinition } from '@internal-tools/foundation';

export function permissionMatrix(tool: ToolDefinition) {
  const roles = [
    ...new Set([...Object.keys(tool.roles), 'auditor', 'platform_admin']),
  ];
  return roles.flatMap((role) =>
    Object.entries(tool.permissions).map(([permission, allowed]) => ({
      role,
      permission,
      expected:
        allowed.includes(role) ||
        (role === 'auditor' && permission.startsWith('audit.')),
    })),
  );
}

export const sessionFor = (id: string, roles: string[]) => ({ id, roles });
