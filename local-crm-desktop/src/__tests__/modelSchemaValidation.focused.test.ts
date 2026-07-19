import { describe, expect, it } from 'vitest';
import { validateModelOutputSchema } from '../lib/productionAi/modelOutputSchemas';

describe('model-schema-validation suite', () => {
  it('accepts closed customer summary schema', () => {
    const result = validateModelOutputSchema('customer_summary_v1', {
      customer_understanding: '理解',
      recent_changes: '变化',
      risks: ['风险'],
      opportunities: ['机会'],
      recommended_next_steps: ['下一步'],
      evidence_refs: ['customer-1'],
      uncertainty: [],
      speculative_claims: [],
      requires_human_review: true,
    });
    expect(result.valid).toBe(true);
    expect(result.output?.schema).toBe('customer_summary_v1');
  });

  it('rejects partial or unsafe output', () => {
    expect(validateModelOutputSchema('follow_up_draft_v1', { draft_text: 'hi' }).valid).toBe(false);
    expect(validateModelOutputSchema('risk_analysis_v1', {
      risk_items: [{ id: '1', summary: 'DROP TABLE customers', severity: 'high' }],
      severity: 'high',
      reasoning_summary: 'x',
      evidence_refs: ['customer-1'],
      mitigation: [],
      uncertainty: [],
      requires_human_review: true,
    }).valid).toBe(false);
  });

  it('rejects legacy AIReasoningResult instead of coercing it', () => {
    const legacy = {
      kind: 'AI_SALES_AGENT_REASONING_RESULT',
      customer_summary: { value: 'Ada graded A' },
      risks: [{ summary: 'risk' }],
      opportunities: [{ summary: 'opp' }],
      next_actions: [{ summary: 'next' }],
      evidence: [{ evidence_id: 'customer-1' }],
    };
    expect(validateModelOutputSchema('customer_summary_v1', legacy).valid).toBe(false);
  });
});
