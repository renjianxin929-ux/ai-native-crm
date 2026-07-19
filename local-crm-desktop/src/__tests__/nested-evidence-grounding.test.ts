import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { buildModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { runProductionReasoningPath } from '../lib/productionAi/productionReasoningPath';
import { validateGroundedClaims } from '../lib/productionAi/evidenceGrounding';
import { validateModelOutputSchema } from '../lib/productionAi/modelOutputSchemas';

const now = '2026-07-16T00:00:00.000Z';
const context = buildContextSnapshot({
  snapshotId: 'grounding', capturedAt: now, timeWindow: { from: '2026-07-01T00:00:00.000Z', to: now },
  customers: [
    { customerId: 'c1', name: 'One', grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: ['ev1'] },
    { customerId: 'c2', name: 'Two', grade: 'B', intentLevel: 'MEDIUM', observedAt: now, evidenceIds: ['ev2'] },
  ], accounts: [], interactions: [],
});
const tool = (customer: string, evidence: string) => ({ tool_id: 'get_customer_context' as const, records: [{ customer_id: customer }], evidence_refs: [evidence], read_only: true as const, writes_crm: false as const });

async function runRisk(riskEvidence: readonly string[], inferenceType: 'crm_fact' | 'model_inference' = 'crm_fact') {
  const fake = createFakeTrustedHostTransport(async () => ({ kind: 'success', output: {
    risk_items: [{ id: 'risk-1', summary: 'Nested risk', severity: 'high', inference_type: inferenceType, evidence_refs: riskEvidence }],
    severity: 'high', reasoning_summary: 'Reasoned', evidence_refs: ['ev1'], mitigation: ['Confirm'], uncertainty: [], requires_human_review: true,
  } }));
  return runProductionReasoningPath({ request_id: 'risk', intent: 'CUSTOMER_RISK_ANALYSIS', message: '风险', customer_id: 'c1', context, tool_trace: [tool('c1', 'ev1')], callModel: fake.caller });
}

describe('nested-evidence-grounding full path', () => {
  it('blocks a valid top-level citation plus an invented nested risk citation', async () => {
    const result = await runRisk(['invented']);
    expect(result.blocked_message).toBeTruthy();
    expect(result.log.failure_category).toBe('invalid_evidence');
    expect(result.validated_output).toBeNull();
    expect(result.grounded_result).toBeNull();
  });

  it('accepts multiple legal nested claims and exposes only validated claims to projection', async () => {
    const result = await runRisk(['ev1']);
    expect(result.blocked_message).toBeNull();
    expect(result.grounded_result?.claims.length).toBeGreaterThan(1);
    expect(result.grounded_result?.claims.every(claim => claim.grounding_status !== 'INVALID')).toBe(true);
    expect(result.structured.risks_and_opportunities).toContain('有依据的模型判断');
  });

  it('marks an evidence-free inference as speculation and makes the result proposal-ineligible', async () => {
    const result = await runRisk([], 'model_inference');
    const nested = result.grounded_result?.claims.find(claim => claim.claim_id.includes('risk:risk-1'));
    expect(nested).toMatchObject({ grounding_status: 'UNSUPPORTED_INFERENCE', proposal_eligible: false });
    expect(result.grounded_result?.proposal_eligible).toBe(false);
    expect(result.structured.risks_and_opportunities).toContain('模型推测 / 待确认');
  });

  it('rejects an evidence-free CRM fact at schema or claim validation before UI', async () => {
    const result = await runRisk([], 'crm_fact');
    expect(result.blocked_message).toBeTruthy();
    expect(['invalid_schema', 'invalid_evidence']).toContain(result.log.failure_category);
  });

  it('rejects compare ranking that cites another customer evidence', () => {
    const parsed = validateModelOutputSchema('complex_customer_compare_v1', {
      comparison_summary: 'compare', ranked_customers: [
        { customer_id: 'c1', rank: 1, rationale: 'one', evidence_refs: ['ev1'] },
        { customer_id: 'c2', rank: 2, rationale: 'two', evidence_refs: ['ev1'] },
      ], evidence_refs: ['ev1', 'ev2'], uncertainty: [], requires_human_review: true,
    });
    expect(parsed.output).toBeTruthy();
    const envelope = buildModelContextEnvelope({ request_id: 'compare', intent: 'COMPLEX_CUSTOMER_COMPARE', output_schema: 'complex_customer_compare_v1', user_instruction: 'compare', customer_id: null, customer_allowlist: ['c1', 'c2'], context, tool_trace: [tool('c1', 'ev1'), tool('c2', 'ev2')] });
    const grounded = validateGroundedClaims({ output: parsed.output!, envelope, scoped_customer_id: null, allowed_customer_ids: ['c1', 'c2'] });
    expect(grounded.blocked).toBe(true);
    expect(grounded.errors.join(' ')).toMatch(/cross-customer/);
    expect(grounded.proposal_eligible).toBe(false);
  });

  it('rejects duplicate ownership collisions, unknown/orphan references and draft invented background evidence', () => {
    const parsed = validateModelOutputSchema('follow_up_draft_v1', { draft_text: 'hello', tone: 'plain', objective: 'follow', evidence_refs: ['invented'], unsupported_assumptions: [], requires_human_review: true });
    const envelope = buildModelContextEnvelope({ request_id: 'draft', intent: 'FOLLOW_UP_DRAFT', output_schema: 'follow_up_draft_v1', user_instruction: 'draft', customer_id: 'c1', context, tool_trace: [tool('c1', 'ev1')] });
    const collision = { ...envelope, evidence_map: [...envelope.evidence_map, { ...envelope.evidence_map[0]!, customer_id: 'c2', integrity: 'different' }] };
    const grounded = validateGroundedClaims({ output: parsed.output!, envelope: collision, scoped_customer_id: 'c1', allowed_customer_ids: ['c1'] });
    expect(grounded.blocked).toBe(true);
    expect(grounded.errors.join(' ')).toMatch(/collision|invented/);
  });
});
