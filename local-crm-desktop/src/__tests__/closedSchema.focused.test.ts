import { describe, expect, it } from 'vitest';
import { validateModelOutputSchema } from '../lib/productionAi/modelOutputSchemas';

const summary = () => ({
  customer_understanding: '客户保持高意向', recent_changes: '近期完成沟通', risks: ['时间风险'], opportunities: ['报价机会'],
  recommended_next_steps: ['人工确认需求'], evidence_refs: ['customer:c1'], uncertainty: [], speculative_claims: [], requires_human_review: true,
});

describe('closed-schema suite', () => {
  it('accepts only the exact target schema', () => expect(validateModelOutputSchema('customer_summary_v1', summary()).valid).toBe(true));

  it('rejects extra, missing, empty, oversized and wrong-element output', () => {
    expect(validateModelOutputSchema('customer_summary_v1', { ...summary(), extra: true }).valid).toBe(false);
    const { customer_understanding: _, ...missing } = summary(); void _;
    expect(validateModelOutputSchema('customer_summary_v1', missing).valid).toBe(false);
    expect(validateModelOutputSchema('customer_summary_v1', { ...summary(), customer_understanding: '' }).valid).toBe(false);
    expect(validateModelOutputSchema('customer_summary_v1', { ...summary(), recent_changes: 'x'.repeat(4001) }).valid).toBe(false);
    expect(validateModelOutputSchema('customer_summary_v1', { ...summary(), risks: Array(21).fill('risk') }).valid).toBe(false);
    expect(validateModelOutputSchema('customer_summary_v1', { ...summary(), risks: ['risk', 1] }).valid).toBe(false);
    expect(validateModelOutputSchema('customer_summary_v1', { ...summary(), evidence_refs: [] }).valid).toBe(false);
  });

  it('rejects legacy and wrong-target schemas without conversion', () => {
    expect(validateModelOutputSchema('customer_summary_v1', { kind: 'AI_SALES_AGENT_REASONING_RESULT', customer_summary: { value: 'legacy' } }).valid).toBe(false);
    expect(validateModelOutputSchema('follow_up_draft_v1', summary()).valid).toBe(false);
  });
});
