import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildContextSnapshot } from '../lib/context/contextBuilder';
import {
  DEFAULT_VERTICAL_AI_PROFILE_ID,
  listVerticalAIProfiles,
  resolveVerticalAIProfile,
  verticalAIProfilesRegistry,
} from '../lib/verticalAIProfiles/registry';
import { STAGE2_PHASE_0_5_CHANGED_FILES } from './stage2ChangedFileCohort';

describe('Stage2 Phase0 context and vertical profiles', () => {
  it('filters and bounds recent facts without reasoning', () => {
    const snapshot = buildContextSnapshot({
      snapshotId: 'snapshot-1',
      capturedAt: '2026-07-10T00:00:00.000Z',
      timeWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-10T00:00:00.000Z' },
      customers: [{ customerId: 'c1', name: 'One', grade: 'B', intentLevel: 'MEDIUM', observedAt: '2026-07-10T00:00:00.000Z', evidenceIds: ['customer:1'] }],
      accounts: [{ accountId: 'a1', customerId: 'c1', name: 'One Account', status: 'active', observedAt: '2026-07-10T00:00:00.000Z', evidenceIds: ['account:1'] }],
      interactions: [
        { interactionId: 'old', customerId: 'c1', kind: 'task', summary: 'Old', occurredAt: '2026-06-01T00:00:00.000Z', evidenceIds: ['task:old'] },
        { interactionId: 'new', customerId: 'c1', kind: 'capture_event', summary: 'New', occurredAt: '2026-07-09T00:00:00.000Z', evidenceIds: ['capture:new'] },
      ],
      maxInteractions: 1,
    });
    expect(snapshot.recentInteractions.map(item => item.interactionId)).toEqual(['new']);
    expect(snapshot.evidenceIdentifiers).toEqual(['account:1', 'capture:new', 'customer:1']);
    expect(snapshot).toMatchObject({ bounded: true, readOnly: true, maxInteractions: 1 });
  });

  it('discovers both required profiles with only domain-level responsibilities', () => {
    expect(listVerticalAIProfiles().map(profile => profile.identity.id)).toEqual(['feishu_saas', 'foreign_trade_geo']);
    expect(resolveVerticalAIProfile('foreign_trade_geo').importantSignals).toContain('AI search visibility gap');
    expect(resolveVerticalAIProfile('feishu_saas').importantSignals).toContain('enterprise AI adoption signal');
  });

  it('uses an explicit deterministic registry and one controlled default resolver', () => {
    const registrySource = readFileSync('src/lib/verticalAIProfiles/registry.ts', 'utf8');
    expect(Object.keys(verticalAIProfilesRegistry)).toEqual(['foreign_trade_geo', 'feishu_saas']);
    expect(DEFAULT_VERTICAL_AI_PROFILE_ID).toBe('foreign_trade_geo');
    expect(resolveVerticalAIProfile().identity.id).toBe('foreign_trade_geo');
    expect(registrySource).not.toContain('import.meta.glob');
    expect(registrySource).not.toContain('runtime scanning');
  });

  it('keeps the Stage2 compatibility cohort exact and wildcard-free', () => {
    expect(STAGE2_PHASE_0_5_CHANGED_FILES).toHaveLength(46);
    expect(new Set(STAGE2_PHASE_0_5_CHANGED_FILES).size).toBe(46);
    expect(STAGE2_PHASE_0_5_CHANGED_FILES.some(file => file.includes('*'))).toBe(false);
  });
});
