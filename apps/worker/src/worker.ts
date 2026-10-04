import pg from 'pg';
import { createServer } from 'node:http';
import {
  databaseConfig,
  retryDelayMs,
  type ToolRegistration,
} from '@internal-tools/foundation';
import { buildWorkerRegistry } from './tool-registry.js';

const pool = new pg.Pool({ ...databaseConfig(), max: 8 });
const registrations = buildWorkerRegistry(pool);
const registrationsById = new Map(
  registrations.map((registration) => [registration.tool.id, registration]),
);
const pausedKinds = [
  ...new Set(
    registrations.flatMap((registration) => registration.pausedKinds ?? []),
  ),
];
const workerContext = { pool };
const lastReconcilerRuns = new Map<string, number>();

interface OutboxJob {
  id: string;
  tool_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function claimOutboxJob(): Promise<OutboxJob | undefined> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ready = await client.query<OutboxJob>(
      `SELECT o.id,o.tool_id,o.kind,o.payload,o.attempts
       FROM foundation.outbox o
       LEFT JOIN foundation.tool_settings s ON s.tool_id=o.tool_id
       WHERE ((o.status='pending' AND o.next_attempt_at<=now())
          OR (o.status='in_flight' AND o.lease_expires_at<=now()))
         AND (COALESCE(s.execution_paused,false)=false
           OR o.kind <> ALL($1::text[]))
       ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1`,
      [pausedKinds],
    );
    const job = ready.rows[0];
    if (job) {
      await client.query(
        `UPDATE foundation.outbox
         SET status='in_flight',lease_expires_at=now()+interval '1 minute'
         WHERE id=$1`,
        [job.id],
      );
    }
    await client.query('COMMIT');
    return job;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markOutboxDone(job: OutboxJob) {
  await pool.query(
    `UPDATE foundation.outbox SET status='done',last_error=NULL,lease_expires_at=NULL
     WHERE id=$1`,
    [job.id],
  );
}

async function markOutboxFailed(job: OutboxJob, error: string) {
  await pool.query(
    `UPDATE foundation.outbox SET status='failed',last_error=$2,lease_expires_at=NULL
     WHERE id=$1`,
    [job.id, error.slice(0, 500)],
  );
}

async function processOutboxJob(job: OutboxJob) {
  const registration = registrationsById.get(job.tool_id);
  const handler = registration?.outboxHandlers?.[job.kind];
  if (!registration || !handler) {
    await markOutboxFailed(job, `Unsupported outbox job: ${job.kind}`);
    return;
  }
  try {
    const result = await handler(workerContext, job.payload);
    if (result?.failed) {
      await markOutboxFailed(job, result.failed);
    } else if (result?.retryAfterMs && result.retryAfterMs > 0) {
      await pool.query(
        `UPDATE foundation.outbox
         SET status='pending',next_attempt_at=now()+($2::text||' milliseconds')::interval,
             last_error=NULL,lease_expires_at=NULL
         WHERE id=$1`,
        [job.id, result.retryAfterMs],
      );
    } else {
      await markOutboxDone(job);
    }
  } catch (error) {
    const attempts = job.attempts + 1;
    const message = asErrorMessage(error).slice(0, 500);
    if (attempts >= 8) {
      await pool.query(
        `UPDATE foundation.outbox SET status='failed',attempts=$2,last_error=$3,
           lease_expires_at=NULL WHERE id=$1`,
        [job.id, attempts, message],
      );
      return;
    }
    await pool.query(
      `UPDATE foundation.outbox
       SET status='pending',attempts=$2,
           next_attempt_at=now()+($3::text||' milliseconds')::interval,
           lease_expires_at=NULL,last_error=$4 WHERE id=$1`,
      [job.id, attempts, retryDelayMs(attempts), message],
    );
  }
}

async function runReconcilers() {
  const now = Date.now();
  for (const registration of registrations) {
    for (const [name, reconciler] of Object.entries(
      registration.reconcilers ?? {},
    )) {
      const key = `${registration.tool.id}:${name}`;
      const interval = Math.max(
        1_000,
        registration.reconcilerIntervals?.[name] ?? 30_000,
      );
      const lastRun = lastReconcilerRuns.get(key) ?? 0;
      if (now - lastRun < interval) continue;
      lastReconcilerRuns.set(key, now);
      try {
        await reconciler(workerContext);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            message: 'Tool reconciler failed',
            toolId: registration.tool.id,
            reconciler: name,
            error: asErrorMessage(error),
          }),
        );
      }
    }
  }
}

let stopping = false;
async function loop() {
  while (!stopping) {
    try {
      const job = await claimOutboxJob();
      if (job) await processOutboxJob(job);
      await runReconcilers();
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'Worker loop failed',
          error: asErrorMessage(error),
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

void loop();

const healthServer = process.env.PORT
  ? createServer((request, response) => {
      const live = request.url === '/health/live';
      response.writeHead(live ? 200 : 404, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ status: live ? 'ok' : 'not_found' }));
    }).listen(Number(process.env.PORT))
  : undefined;

const stop = async () => {
  stopping = true;
  healthServer?.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
