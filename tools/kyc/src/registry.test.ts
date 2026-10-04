import { describe, expect, it } from 'vitest';
import { authorize, tierFor, type Policy } from '@internal-tools/foundation';
import { permissionMatrix } from '@internal-tools/testing';
import { kycHighRiskThreshold, kycTool } from './registry.js';
import { kycRoutes } from './api.js';

describe('KYC registry', () => {
  it('declares every route permission in the tool matrix', () => {
    for (const route of kycRoutes) {
      expect(Object.keys(kycTool.permissions)).toContain(route.permission);
    }
  });

  it('gives the auditor read access only', () => {
    const auditor = permissionMatrix(kycTool).filter(
      (entry) => entry.role === 'auditor' && entry.expected,
    );
    expect(auditor.map((entry) => entry.permission)).toEqual(['kyc.read']);
    expect(
      authorize({ id: 'a', roles: ['auditor'] }, 'kyc.reveal', kycTool),
    ).toBe(false);
  });

  it('lets only a KYC lead decide escalated cases and approve high risk', () => {
    expect(kycTool.permissions['kyc.decide_escalated']).toEqual(['kyc_lead']);
    expect(kycTool.permissions['kyc.approve']).toEqual(['kyc_lead']);
  });

  it('needs a lead approval from a risk score of 70', () => {
    const policy = kycTool.approvalRules['kyc.case_approval'] as Policy<{
      riskScore: number;
    }>;
    expect(tierFor(policy, { riskScore: kycHighRiskThreshold - 1 }).name).toBe(
      'standard',
    );
    expect(tierFor(policy, { riskScore: kycHighRiskThreshold }).steps).toEqual([
      ['kyc_lead'],
    ]);
    expect(tierFor(policy, { riskScore: 100 }).name).toBe('lead');
  });
});
