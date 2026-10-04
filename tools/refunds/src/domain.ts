import { tierFor, type Policy } from '@internal-tools/foundation';
import { refundsTool } from './registry.js';

export const refundPolicy = refundsTool.approvalRules?.[
  'refund.execute'
] as Policy<{
  amountMinor: bigint;
}>;

export const refundPolicyVersion = refundPolicy.version;
export const dailyAutoRefundLimitMinor = 200_000n;

export function refundTier(amountMinor: bigint) {
  return tierFor(refundPolicy, { amountMinor });
}

export function refundableMinor(
  amountMinor: string | bigint,
  refundedMinor: string | bigint,
) {
  return (BigInt(amountMinor) - BigInt(refundedMinor)).toString();
}
