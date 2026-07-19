import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { validateEvidenceGrounding, markUngroundedAsSpeculation } from '../lib/productionAi/evidenceGrounding';
import { projectValidatedModelResponse } from '../lib/productionAi/localDeterministicProjection';

describe('evidence-grounding suite', () => {
  const context = buildContextSnapshot({
    snapshotId: 'snap-1',
    capturedAt: '2026-07-16T00:00:00.000Z',
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-16T00:00:00.000Z' },
    customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: '2026-07-16T00:00:00.000Z', evidenceIds: ['customer-1'] }],
    accounts: [],
    interactions: [{
      interactionId: 'i-1',
      customerId: 'customer-1',
      kind: 'task',
      summary: 'call',
      occurredAt: '2026-07-16T00:00:00.000Z',
      evidenceIds: ['ev-1'],
    }],
  });

  it('accepts only provided evidence ids and rejects invented ones', () => {
    const envelope = buildModelContextEnvelope({
      request_id: 'req-1',
      intent: 'CUSTOMER_SUMMARY',
      output_schema: 'customer_summary_v1',
      user_instruction: '总结',
      customer_id: 'customer-1',
      context,
    });
    expect(validateEvidenceGrounding({ envelope, cited_refs: ['customer-1', 'ev-1'], allowed_customer_ids: ['customer-1'] }).valid).toBe(true);
    const bad = validateEvidenceGrounding({ envelope, cited_refs: ['invented-id'], allowed_customer_ids: ['customer-1'] });
    expect(bad.valid).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/invented/);
  });

  it('marks ungrounded claims as speculation', () => {
    expect(markUngroundedAsSpeculation('可能流失', false)).toContain('模型推测 / 待确认');
    expect(markUngroundedAsSpeculation('有证据', true)).toBe('有证据');
  });

  it('grounded-claim-ui projects only validated claims and blocks INVALID model claims', () => {
    const unsupported = projectValidatedModelResponse({
      schema: 'customer_summary_v1', valid: true, blocked: false, errors: [], evidence_refs: [], proposal_eligible: false,
      claims: [{ claim_id: 'c1', claim_type: 'model_inference', text: '可能流失', customer_id: 'customer-1', evidence_refs: [], grounding_status: 'UNSUPPORTED_INFERENCE', unsupported_assumptions: ['缺少证据'], proposal_eligible: false }],
    });
    expect(unsupported.risks_and_opportunities).toContain('【模型推测 / 待确认】');
    expect(() => projectValidatedModelResponse({
      schema: 'customer_summary_v1', valid: false, blocked: true, errors: ['invented evidence'], evidence_refs: [], proposal_eligible: false,
      claims: [{ claim_id: 'bad', claim_type: 'crm_fact', text: '伪造事实', customer_id: 'customer-1', evidence_refs: ['invented'], grounding_status: 'INVALID', unsupported_assumptions: [], proposal_eligible: false }],
    })).toThrow(/Invalid grounded result/);
  });
});
