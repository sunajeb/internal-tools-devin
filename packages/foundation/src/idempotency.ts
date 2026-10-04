import { createHash } from 'node:crypto';

export function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function checkIdempotency(
  previousHash: string | undefined,
  incomingHash: string,
  completed: boolean,
) {
  if (!previousHash) return { action: 'execute' as const };
  if (previousHash !== incomingHash) return { action: 'conflict' as const };
  return { action: completed ? ('replay' as const) : ('in_progress' as const) };
}
