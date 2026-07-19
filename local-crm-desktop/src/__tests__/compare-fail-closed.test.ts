import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

const now = '2026-07-16T00:00:00.000Z';
const customers = Array.from({ length: 100 }, (_, index) => ({ customerId: `c${index + 1}`, name: `Customer ${index + 1}`, grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: [`e${index + 1}`] }));
const context = buildContextSnapshot({ snapshotId: 'compare', capturedAt: now, timeWindow: { from: now, to: now }, customers, accounts: [], interactions: [] });
const build = (allowlist: readonly string[]) => buildModelContextEnvelope({ request_id: 'compare', intent: 'COMPLEX_CUSTOMER_COMPARE', output_schema: 'complex_customer_compare_v1', user_instruction: 'compare', customer_id: null, customer_allowlist: allowlist, context, tool_trace: [] });

describe('compare-fail-closed', () => {
  it('routes explicit named customer pairs to compare before structural portfolio filters', () => {
    expect(createAgentIntentEnvelope('对比广州华南客户01和广州华南客户02', now).intent).toBe('COMPLEX_CUSTOMER_COMPARE');
    expect(createAgentIntentEnvelope('机会与风险对比', now).intent).toBe('CUSTOMER_RISK_ANALYSIS');
  });
  it('allows two through five unique customers', () => expect(build(['c1', 'c2', 'c3', 'c4', 'c5']).customer_allowlist).toHaveLength(5));
  it('rejects zero, one, six and one hundred without truncation', () => {
    for (const count of [0, 1, 6, 100]) expect(() => build(customers.slice(0, count).map(item => item.customerId))).toThrow(/bounded customer_allowlist/);
  });
  it('applies the bound after deterministic de-duplication', () => expect(build(['c1', 'c1', 'c2']).customer_allowlist).toEqual(['c1', 'c2']));
});
