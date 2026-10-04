import { createHash } from 'node:crypto';

export interface AuditEvent {
  id: string;
  occurredAt: string;
  toolId: string;
  actorId: string;
  actorRoles: string[];
  action: string;
  objectType: string;
  objectId: string;
  before: unknown;
  after: unknown;
  result: string;
  requestId: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function genesisHash(): Buffer {
  return createHash('sha256').update('genesis').digest();
}

export function hashAuditEvent(
  previousHash: Buffer,
  event: AuditEvent,
): Buffer {
  return createHash('sha256')
    .update(previousHash)
    .update(canonical(event))
    .digest();
}

export function verifyAuditChain(
  events: Array<{ event: AuditEvent; prevHash: Buffer; hash: Buffer }>,
) {
  let previous = genesisHash();
  for (const row of events) {
    const expected = hashAuditEvent(previous, row.event);
    if (!row.prevHash.equals(previous) || !row.hash.equals(expected)) {
      return { valid: false, firstBrokenEventId: row.event.id };
    }
    previous = row.hash;
  }
  return { valid: true, firstBrokenEventId: null };
}
