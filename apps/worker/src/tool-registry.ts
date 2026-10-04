import type pg from 'pg';
import type { ToolRegistration } from '@internal-tools/foundation';
import { createRefundWorkerRegistration } from '@internal-tools/refunds/worker';

export function buildWorkerRegistry(pool: pg.Pool): ToolRegistration[] {
  return [createRefundWorkerRegistration(pool)];
}
