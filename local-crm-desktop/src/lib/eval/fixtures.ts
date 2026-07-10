import { buildContextSnapshot } from '../context/contextBuilder';
import { resolveVerticalAIProfile } from '../verticalAIProfiles/registry';
import type { EvaluationFixture } from './types';

export const STAGE2_EVALUATION_FIXTURES: readonly EvaluationFixture[] = [
  {
    caseId: 'foreign-trade-evidenced-lead',
    profile: resolveVerticalAIProfile('foreign_trade_geo'),
    context: buildContextSnapshot({
      snapshotId: 'fixture-foreign-trade-1',
      capturedAt: '2026-07-10T08:00:00.000Z',
      timeWindow: { from: '2026-06-10T08:00:00.000Z', to: '2026-07-10T08:00:00.000Z' },
      customers: [{
        customerId: 'customer-1',
        name: 'Fixture Export Co',
        grade: 'B',
        intentLevel: 'MEDIUM',
        observedAt: '2026-07-10T08:00:00.000Z',
        evidenceIds: ['customer:1'],
      }],
      accounts: [],
      interactions: [{
        interactionId: 'interaction-1',
        customerId: 'customer-1',
        kind: 'capture_event',
        summary: 'Asked about overseas AI-search visibility.',
        occurredAt: '2026-07-09T08:00:00.000Z',
        evidenceIds: ['capture:1'],
      }],
    }),
  },
  {
    caseId: 'feishu-evidenced-adoption',
    profile: resolveVerticalAIProfile('feishu_saas'),
    context: buildContextSnapshot({
      snapshotId: 'fixture-feishu-1',
      capturedAt: '2026-07-10T08:00:00.000Z',
      timeWindow: { from: '2026-06-10T08:00:00.000Z', to: '2026-07-10T08:00:00.000Z' },
      customers: [{
        customerId: 'customer-2',
        name: 'Fixture Enterprise',
        grade: 'A',
        intentLevel: 'HIGH',
        observedAt: '2026-07-10T08:00:00.000Z',
        evidenceIds: ['customer:2'],
      }],
      accounts: [],
      interactions: [],
    }),
  },
];
