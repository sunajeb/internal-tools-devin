import Fastify from 'fastify';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface SimRefund {
  id: string;
  idempotencyKey: string;
  bodyHash: string;
  chargeId: string;
  amountMinor: string;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: string;
}

const app = Fastify({ logger: true });
const refundsByKey = new Map<string, SimRefund>();
const faults = new Set<string>();
const webhookSecret =
  process.env.WEBHOOK_SECRET ?? 'local-webhook-secret-change-before-deploy';
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
const stateFile = process.env.SIMULATOR_STATE_FILE;
let persistence = Promise.resolve();

if (stateFile) {
  try {
    const stored = JSON.parse(await readFile(stateFile, 'utf8')) as SimRefund[];
    for (const refund of stored)
      refundsByKey.set(refund.idempotencyKey, refund);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function persistRefunds() {
  if (!stateFile) return Promise.resolve();
  persistence = persistence
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(stateFile), { recursive: true });
      const temporaryFile = `${stateFile}.${randomUUID()}.tmp`;
      await writeFile(
        temporaryFile,
        JSON.stringify([...refundsByKey.values()]),
        { mode: 0o600 },
      );
      await rename(temporaryFile, stateFile);
    });
  return persistence;
}

function secureEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function sendWebhook(refund: SimRefund, eventType: string) {
  const payload = JSON.stringify({
    id: randomUUID(),
    type: eventType,
    created: Math.floor(Date.now() / 1000),
    data: {
      refundId: refund.idempotencyKey,
      providerRefundId: refund.id,
      status: refund.status,
    },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  const send = () =>
    fetch(`${apiUrl}/api/webhooks/simulator`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sim-signature': `t=${timestamp},v1=${signature}`,
      },
      body: payload,
    });
  try {
    await send();
    if (faults.has('duplicate-webhook')) await send();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'warn',
        message: 'Webhook delivery failed; reconciliation will catch up',
        eventType,
        providerRefundId: refund.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

app.get('/health', async () => ({ status: 'ok' }));
app.get('/v1/refunds', async () => ({
  data: [...refundsByKey.values()].map(
    ({ bodyHash: _bodyHash, ...refund }) => refund,
  ),
}));

app.post('/v1/refunds', async (request, reply) => {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length < 1)
    return reply.code(400).send({ error: 'Idempotency-Key is required.' });
  const body = request.body as {
    chargeId: string;
    amountMinor: string;
    currency: string;
    metadata?: Record<string, string>;
  };
  const bodyHash = JSON.stringify(body);
  const prior = refundsByKey.get(key);
  if (prior) {
    if (prior.bodyHash !== bodyHash)
      return reply.code(409).send({
        error: 'Idempotency key reused with a different request body.',
      });
    await persistRefunds();
    return { id: prior.id, status: prior.status };
  }
  if (faults.has('timeout-then-succeed')) {
    faults.delete('timeout-then-succeed');
    return reply
      .code(503)
      .send({ error: 'Injected transient provider timeout.' });
  }
  if (faults.has('500'))
    return reply.code(500).send({ error: 'Injected provider error.' });
  const declined = faults.delete('declined');
  const refund: SimRefund = {
    id: `pr_${randomUUID()}`,
    idempotencyKey: key,
    bodyHash,
    chargeId: body.chargeId,
    amountMinor: String(body.amountMinor),
    currency: body.currency,
    status: declined ? 'failed' : 'succeeded',
    createdAt: new Date().toISOString(),
  };
  refundsByKey.set(key, refund);
  await persistRefunds();
  if (declined) {
    await sendWebhook(refund, 'refund.failed');
  } else if (faults.has('out-of-order-webhook')) {
    await sendWebhook(refund, 'refund.succeeded');
    await sendWebhook({ ...refund, status: 'pending' }, 'refund.pending');
    faults.delete('out-of-order-webhook');
  } else {
    await sendWebhook(refund, 'refund.succeeded');
  }
  return { id: refund.id, status: refund.status };
});

app.post('/admin/faults', async (request, reply) => {
  const provided = request.headers['x-admin-token'];
  if (
    !secureEqual(
      String(provided ?? ''),
      process.env.SIM_ADMIN_TOKEN ?? 'local-simulator-admin',
    )
  ) {
    return reply.code(403).send({ error: 'Admin token is invalid.' });
  }
  const body = request.body as { fault?: string; clear?: boolean };
  const allowed = [
    'timeout-then-succeed',
    '500',
    'declined',
    'duplicate-webhook',
    'out-of-order-webhook',
  ];
  if (body.clear) faults.clear();
  else if (body.fault && allowed.includes(body.fault)) faults.add(body.fault);
  else return reply.code(400).send({ error: 'Choose a supported fault.' });
  return { faults: [...faults] };
});

app.post('/admin/ghost-refund', async (request, reply) => {
  const provided = request.headers['x-admin-token'];
  if (
    !secureEqual(
      String(provided ?? ''),
      process.env.SIM_ADMIN_TOKEN ?? 'local-simulator-admin',
    )
  ) {
    return reply.code(403).send({ error: 'Admin token is invalid.' });
  }
  const body = request.body as {
    chargeId: string;
    amountMinor: string;
    currency?: string;
  };
  const refund: SimRefund = {
    id: `pr_ghost_${randomUUID()}`,
    idempotencyKey: `ghost_${randomUUID()}`,
    bodyHash: JSON.stringify(body),
    chargeId: body.chargeId,
    amountMinor: String(body.amountMinor),
    currency: body.currency ?? 'USD',
    status: 'succeeded',
    createdAt: new Date().toISOString(),
  };
  refundsByKey.set(refund.idempotencyKey, refund);
  await persistRefunds();
  return { id: refund.id };
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: '0.0.0.0', port });
