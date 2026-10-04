import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { genesisHash } from '@internal-tools/foundation';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function appendAudit(
  client: pg.PoolClient,
  input: {
    toolId?: string;
    actorId: string;
    actorRoles?: string[];
    action: string;
    objectType: string;
    objectId: string;
    before?: unknown;
    after?: unknown;
    result?: string;
    requestId: string;
    sourceIp?: string;
    userAgent?: string;
  },
) {
  await client.query('SELECT pg_advisory_xact_lock(381729)');
  const previous = await client.query(
    'SELECT hash FROM foundation.audit_events ORDER BY seq DESC LIMIT 1',
  );
  const previousHash = previous.rows[0]?.hash as Buffer | undefined;
  const occurredAt = new Date().toISOString();
  const id = randomUUID();
  const event = {
    id,
    occurredAt,
    toolId: input.toolId ?? 'refunds',
    actorId: input.actorId,
    actorRoles: input.actorRoles ?? [],
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    before: input.before ?? null,
    after: input.after ?? null,
    result: input.result ?? 'success',
    requestId: input.requestId,
  };
  const prevHash = previousHash ?? genesisHash();
  const hash = createHash('sha256')
    .update(prevHash)
    .update(canonical(event))
    .digest();
  await client.query(
    `INSERT INTO foundation.audit_events
     (id, occurred_at, tool_id, actor_id, actor_roles, action, object_type, object_id, event_data,
      result, request_id, source_ip, user_agent, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      occurredAt,
      event.toolId,
      event.actorId,
      event.actorRoles,
      event.action,
      event.objectType,
      event.objectId,
      JSON.stringify(event),
      event.result,
      event.requestId,
      input.sourceIp ?? null,
      input.userAgent ?? null,
      prevHash,
      hash,
    ],
  );
  return event;
}
