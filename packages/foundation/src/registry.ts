export type DataClass = 'public' | 'internal' | 'confidential' | 'restricted';

export interface ToolDefinition {
  id: string;
  name: string;
  owner: string;
  dataClass: DataClass;
  roles: Record<string, { idpGroup: string }>;
  permissions: Record<string, string[]>;
  approvalRules?: Record<string, unknown>;
}

export function defineTool<T extends ToolDefinition>(tool: T): T {
  if (!tool.id || !tool.owner || Object.keys(tool.permissions).length === 0) {
    throw new Error('A tool requires an id, owner, and permission matrix');
  }
  return Object.freeze(tool);
}

export interface RouteDefinition<T = unknown> {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  permission: string;
  schema?: unknown;
  idempotent?: boolean;
  handler: (input: T) => unknown;
}

export function defineRoute<T>(route: RouteDefinition<T>): RouteDefinition<T> {
  if (!route.permission)
    throw new Error(`Route ${route.path} has no permission`);
  return route;
}

export function assertRoutesHavePermissions(
  routes: Array<Partial<RouteDefinition>>,
): void {
  const missing = routes
    .filter((route) => !route.permission)
    .map((route) => route.path ?? '<unknown>');
  if (missing.length)
    throw new Error(`Routes require permissions: ${missing.join(', ')}`);
}

export interface UserIdentity {
  id: string;
  roles: string[];
}

export function authorize(
  user: UserIdentity | null,
  permission: string,
  tool: ToolDefinition,
): boolean {
  if (!user) return false;
  if (user.roles.includes('platform_admin') && permission === 'execution.pause')
    return true;
  if (user.roles.includes('auditor') && permission.startsWith('audit.'))
    return true;
  const allowed = tool.permissions[permission] ?? [];
  return allowed.some((role) => user.roles.includes(role));
}

export interface ApprovalTier<T> {
  name: string;
  when: (request: T) => boolean;
  steps: string[][];
}

export interface Policy<T> {
  version: number;
  tiers: ApprovalTier<T>[];
  expiresAfterHours: number;
}

export function definePolicy<T>(policy: Policy<T>): Policy<T> {
  if (
    !Number.isInteger(policy.version) ||
    policy.version < 1 ||
    policy.tiers.length === 0
  ) {
    throw new Error('Policy requires a positive version and at least one tier');
  }
  return Object.freeze(policy);
}

export function tierFor<T>(policy: Policy<T>, request: T): ApprovalTier<T> {
  const tier = policy.tiers.find((candidate) => candidate.when(request));
  if (!tier) throw new Error('No approval tier matches this request');
  return tier;
}
