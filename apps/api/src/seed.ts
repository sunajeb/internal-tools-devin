import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { databaseConfig } from '@internal-tools/foundation';

const pool = new pg.Pool(
  databaseConfig({ urlVariables: ['MIGRATION_DATABASE_URL', 'DATABASE_URL'] }),
);

await pool.query(`
  INSERT INTO refunds.charges (id, customer_id, customer_email, card_brand, card_last4, amount_minor, currency, created_at)
  SELECT
    'ch_' || lpad(n::text, 6, '0'),
    'cus_' || lpad(((n - 1) % 25000 + 1)::text, 5, '0'),
    'customer' || ((n - 1) % 25000 + 1)::text || '@example.test',
    (ARRAY['visa','mastercard','amex'])[((n - 1) % 3) + 1],
    lpad(((n * 37) % 10000)::text, 4, '0'),
    CASE WHEN n <= 25 THEN 1000000 + n * 1000 ELSE 5000 + ((n * 137) % 250000) END::bigint,
    'USD',
    now() - ((n % 365)::text || ' days')::interval
  FROM generate_series(1,100000) n
  ON CONFLICT (id) DO NOTHING
`);
await pool.query(`
  UPDATE refunds.charges
  SET amount_minor = GREATEST(amount_minor, 50000)
  WHERE id IN (
    SELECT 'ch_' || lpad((n * 101)::text, 6, '0')
    FROM generate_series(1, 24) n
  )
`);
await pool.query(`
  INSERT INTO refunds.refunds (id, charge_id, amount_minor, currency, reason_code, note, requester_id, status, tier, policy_version, created_at)
  SELECT md5('seed-refund-' || n::text)::uuid, 'ch_' || lpad((n * 101)::text, 6, '0'),
         CASE WHEN (n - 1) % 4 = 0 THEN 32000 ELSE 1500 + n * 100 END, 'USD',
         'service_issue', 'Synthetic seed refund for local demonstration.', 'seed-agent',
         (ARRAY['pending_approval','approved','succeeded','failed'])[((n - 1) % 4) + 1],
         CASE WHEN (n - 1) % 4 = 0 THEN 'supervisor' ELSE 'auto' END, 1, now() - (n::text || ' hours')::interval
  FROM generate_series(1,24) n
  ON CONFLICT (id) DO NOTHING
`);
await pool.query(`
  WITH pending AS (
    INSERT INTO foundation.approval_requests(
      tool_id,action,object_type,object_id,requester_id,tier,policy_version,content_hash,steps,status,expires_at,summary
    )
    SELECT 'refunds','refund.execute','refund',r.id::text,r.requester_id,r.tier,r.policy_version,
           md5(r.id::text),jsonb_build_array(jsonb_build_object(
             'roles',jsonb_build_array('supervisor'),'approvals','[]'::jsonb
           )),'pending',now()+interval '72 hours',
           jsonb_build_object(
             'refund_id',r.id::text,'charge_id',r.charge_id,'amount_minor',r.amount_minor::text,
             'currency',r.currency,'reason_code',r.reason_code,'note',r.note,'status',r.status
           )
    FROM refunds.refunds r
    WHERE r.requester_id='seed-agent' AND r.status='pending_approval' AND r.approval_request_id IS NULL
    RETURNING id,object_id
  )
  UPDATE refunds.refunds r SET approval_request_id=pending.id
  FROM pending WHERE r.id::text=pending.object_id
`);
await pool.query(`
  UPDATE foundation.approval_requests a SET summary=jsonb_build_object(
    'refund_id',r.id::text,'charge_id',r.charge_id,'amount_minor',r.amount_minor::text,
    'currency',r.currency,'reason_code',r.reason_code,'note',r.note,'status',r.status
  )
  FROM refunds.refunds r
  WHERE a.tool_id='refunds' AND a.object_type='refund' AND a.object_id=r.id::text
    AND a.summary='{}'::jsonb
`);
await pool.query(`
  INSERT INTO foundation.outbox(tool_id,kind,payload,idempotency_key,status)
  SELECT 'refunds','refund.execute',jsonb_build_object('refundId',r.id::text),r.id::text,'pending'
  FROM refunds.refunds r
  WHERE r.requester_id='seed-agent' AND r.status='approved'
  ON CONFLICT (idempotency_key) DO NOTHING
`);
await pool.query(`
  UPDATE refunds.charges c SET refunded_minor=COALESCE((
    SELECT sum(r.amount_minor) FROM refunds.refunds r
    WHERE r.charge_id=c.id AND r.status NOT IN ('failed','rejected','cancelled','expired')
  ),0)
  WHERE c.id IN (SELECT charge_id FROM refunds.refunds WHERE requester_id='seed-agent')
`);
await pool.query(`
  INSERT INTO refunds.reconciliation_exceptions(reconciler,reconciliation_key,exception_type,details)
  VALUES ('refunds','provider-ghost-demo','missing_internal','{"providerRefundId":"pr_ghost_demo","amountMinor":12000}')
  ON CONFLICT DO NOTHING
`);
const toolsDirectory = fileURLToPath(
  new URL('../../../tools', import.meta.url),
);
for (const entry of (await readdir(toolsDirectory, { withFileTypes: true }))
  .filter((item) => item.isDirectory())
  .sort((first, second) => first.name.localeCompare(second.name))) {
  const seedFile = join(toolsDirectory, entry.name, 'seed.sql');
  const sql = await readFile(seedFile, 'utf8').catch(() => undefined);
  if (sql) await pool.query(sql);
}
await pool.end();
console.log(
  'Seeded 100,000 synthetic charges, tool seed files and demo records.',
);
