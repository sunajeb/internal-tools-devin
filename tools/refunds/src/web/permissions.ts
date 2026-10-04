import { refundsPermissions, type RefundsPermission } from '../permissions.js';
import type { User } from './types.js';

export function can(user: User, permission: RefundsPermission) {
  return refundsPermissions[permission].some((role) =>
    user.roles.includes(role),
  );
}
