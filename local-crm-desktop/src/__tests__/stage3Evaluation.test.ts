import { describe, expect, it } from 'vitest';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { runSalesAgentEvaluation } from '../lib/salesAgent/evaluation';
import { SALES_AGENT_EVALUATION_FIXTURES } from '../lib/salesAgent/evaluationFixtures';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';

describe('Stage3 lightweight evaluation', () => {
  it('scores evidence coverage and human-review safety without an evaluation platform', async () => {
    expect(STAGE2_EVALUATION_FIXTURES.length).toBeGreaterThanOrEqual(2);
    const results = await runSalesAgentEvaluation({ fixtures: SALES_AGENT_EVALUATION_FIXTURES, createProvider: createMockReasoningProvider });
    expect(results).toHaveLength(SALES_AGENT_EVALUATION_FIXTURES.length);
    expect(results.every(result => result.passed)).toBe(true);
    expect(results.every(result => result.score.evidence_coverage === 1)).toBe(true);
    expect(results.every(result => result.score.required_fields_present && result.score.profile_used && result.score.human_review_safe)).toBe(true);
  });
});

