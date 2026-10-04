import { describe, expect, it } from 'vitest';
import {
  approveStep,
  assertRoutesHavePermissions,
  definePolicy,
  defineTool,
  genesisHash,
  hashAuditEvent,
  maskValue,
  retryDelayMs,
  tierFor,
  verifyAuditChain,
} from './index.js';

describe('Foundation controls', () => {
  it('requires a permission on every route', () => {
    expect(() =>
      assertRoutesHavePermissions([
        { path: '/refunds', permission: 'refund.request' },
      ]),
    ).not.toThrow();
    expect(() => assertRoutesHavePermissions([{ path: '/unsafe' }])).toThrow(
      'Routes require permissions',
    );
  });

  it('denies missing users and roles by default', async () => {
    const tool = defineTool({
      id: 'sample',
      name: 'Sample',
      owner: 'owner@example.test',
      dataClass: 'internal' as const,
      roles: { agent: { idpGroup: 'agent' } },
      permissions: { 'sample.read': ['agent'] },
    });
    const { authorize } = await import('./registry.js');
    expect(authorize(null, 'sample.read', tool)).toBe(false);
    expect(
      authorize({ id: 'u1', roles: ['auditor'] }, 'sample.read', tool),
    ).toBe(false);
    expect(authorize({ id: 'u1', roles: ['agent'] }, 'sample.read', tool)).toBe(
      true,
    );
  });

  it('chooses approval tiers using integer minor units', () => {
    const policy = definePolicy({
      version: 1,
      tiers: [
        { name: 'auto', when: (value: number) => value <= 25_000, steps: [] },
        {
          name: 'dual',
          when: () => true,
          steps: [['supervisor'], ['finance']],
        },
      ],
      expiresAfterHours: 72,
    });
    expect(tierFor(policy, 25_000).name).toBe('auto');
    expect(tierFor(policy, 25_001).name).toBe('dual');
  });

  it('blocks self-approval and duplicate approvers', () => {
    const steps = [
      {
        roles: ['supervisor'],
        approvals: [] as Array<{ userId: string; role: string }>,
      },
    ];
    expect(() =>
      approveStep(steps, 0, 'agent-1', 'agent-1', ['supervisor']),
    ).toThrow('cannot approve');
    const completed = approveStep(steps, 0, 'agent-1', 'supervisor-1', [
      'supervisor',
    ]);
    expect(() =>
      approveStep(completed, 0, 'agent-1', 'supervisor-1', ['supervisor']),
    ).toThrow('only approve once');
  });

  it('masks protected fields and records deterministic audit hashes', () => {
    expect(maskValue('ada@example.test', 'confidential', false)).toBe(
      '••••••••',
    );
    expect(maskValue('ada@example.test', 'confidential', true)).toBe(
      'ada@example.test',
    );
    const event = {
      id: 'e1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      toolId: 'refunds',
      actorId: 'user-1',
      actorRoles: ['agent'],
      action: 'refund.requested',
      objectType: 'refund',
      objectId: 'r1',
      before: null,
      after: { amountMinor: '100' },
      result: 'success',
      requestId: 'req1',
    };
    const hash = hashAuditEvent(genesisHash(), event);
    expect(
      verifyAuditChain([{ event, prevHash: genesisHash(), hash }]),
    ).toEqual({ valid: true, firstBrokenEventId: null });
    expect(
      verifyAuditChain([
        { event, prevHash: genesisHash(), hash: Buffer.alloc(32) },
      ]),
    ).toEqual({ valid: false, firstBrokenEventId: 'e1' });
  });

  it('uses exponential retry timing with a capped jitter', () => {
    expect(retryDelayMs(0, () => 0)).toBe(5_000);
    expect(retryDelayMs(1, () => 0.5)).toBe(11_000);
    expect(retryDelayMs(10, () => 1)).toBe(930_000);
  });
});
