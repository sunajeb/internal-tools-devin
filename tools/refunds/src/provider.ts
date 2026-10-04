import Stripe from 'stripe';

export interface ProviderRefundInput {
  chargeId: string;
  amountMinor: string;
  currency: string;
  refundId: string;
  providerRefundId?: string;
}

export interface ProviderRefund {
  id: string;
  idempotencyKey: string;
  chargeId: string;
  amountMinor: string;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface PaymentProvider {
  usesExternalChargeIds?: boolean;
  createRefund(
    input: ProviderRefundInput,
  ): Promise<Pick<ProviderRefund, 'id' | 'status'>>;
  listRefunds(): Promise<ProviderRefund[]>;
}

function stripeRefundStatus(status: string | null): ProviderRefund['status'] {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'pending';
}

class SimulatorProvider implements PaymentProvider {
  private readonly baseUrl =
    process.env.SIMULATOR_URL ?? 'http://localhost:4000';

  async createRefund(
    input: ProviderRefundInput,
  ): Promise<Pick<ProviderRefund, 'id' | 'status'>> {
    const response = await fetch(`${this.baseUrl}/v1/refunds`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.refundId,
      },
      body: JSON.stringify({
        chargeId: input.chargeId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        metadata: { refundId: input.refundId },
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok)
      throw new Error(`Provider returned HTTP ${response.status}`);
    return (await response.json()) as Pick<ProviderRefund, 'id' | 'status'>;
  }

  async listRefunds() {
    const response = await fetch(`${this.baseUrl}/v1/refunds`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok)
      throw new Error(`Provider returned HTTP ${response.status}`);
    const body = (await response.json()) as { data: ProviderRefund[] };
    return body.data;
  }
}

class StripeTestProvider implements PaymentProvider {
  readonly usesExternalChargeIds = true;
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    if (!secretKey.startsWith('sk_test_'))
      throw new Error('Only a Stripe test-mode key is allowed.');
    this.stripe = new Stripe(secretKey);
  }

  async createRefund(input: ProviderRefundInput) {
    const amount = Number(input.amountMinor);
    if (!Number.isSafeInteger(amount))
      throw new Error('Refund amount exceeds the provider safe-integer range.');
    const refund = input.providerRefundId
      ? await this.stripe.refunds.retrieve(input.providerRefundId)
      : await this.stripe.refunds.create(
          {
            charge: input.chargeId,
            amount,
            currency: input.currency.toLowerCase(),
            metadata: { refundId: input.refundId },
          },
          { idempotencyKey: input.refundId },
        );
    return { id: refund.id, status: stripeRefundStatus(refund.status) };
  }

  async listRefunds() {
    const results: ProviderRefund[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const page = await this.stripe.refunds.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const refund of page.data) {
        const idempotencyKey = refund.metadata?.refundId;
        if (!idempotencyKey) continue;
        results.push({
          id: refund.id,
          idempotencyKey,
          chargeId:
            typeof refund.charge === 'string'
              ? refund.charge
              : (refund.charge?.id ?? ''),
          amountMinor: String(refund.amount),
          currency: refund.currency.toUpperCase(),
          status: stripeRefundStatus(refund.status),
        });
      }
      const lastRefund = page.data.at(-1);
      if (!page.has_more || !lastRefund) break;
      startingAfter = lastRefund.id;
    }
    return results;
  }
}

export function createPaymentProvider(): PaymentProvider {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  return secretKey
    ? new StripeTestProvider(secretKey)
    : new SimulatorProvider();
}
