import { describe, expect, it } from 'vitest';
import { refundsTool } from './index.js';
import { permissionMatrix } from '@internal-tools/testing';

describe('Refunds Console policy registry', () => {
  it('declares the required server permissions and least-privilege roles', () => {
    expect(refundsTool.permissions['refund.request']).toEqual([
      'agent',
      'supervisor',
    ]);
    expect(refundsTool.permissions['exception.resolve']).toEqual(['finance']);
    expect(refundsTool.permissions['refund.export']).toEqual([
      'finance',
      'auditor',
    ]);
    const matrix = permissionMatrix(refundsTool);
    expect(matrix).toContainEqual({
      role: 'agent',
      permission: 'refund.request',
      expected: true,
    });
    expect(matrix).toContainEqual({
      role: 'auditor',
      permission: 'refund.request',
      expected: false,
    });
    expect(matrix).toContainEqual({
      role: 'finance',
      permission: 'exception.resolve',
      expected: true,
    });
  });

  it('maps minor-unit values to the auto, supervisor and dual approval tiers', () => {
    const policy = refundsTool.approvalRules!['refund.execute'] as {
      tiers: Array<{
        name: string;
        when: (request: { amountMinor: bigint }) => boolean;
      }>;
    };
    const find = (amountMinor: bigint) =>
      policy.tiers.find((tier) => tier.when({ amountMinor }))?.name;
    expect(find(25_000n)).toBe('auto');
    expect(find(25_001n)).toBe('supervisor');
    expect(find(500_000n)).toBe('supervisor');
    expect(find(500_001n)).toBe('dual');
  });
});
