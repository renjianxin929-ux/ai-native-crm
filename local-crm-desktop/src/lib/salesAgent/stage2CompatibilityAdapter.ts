import type { ContextSnapshot } from '../context/types';
import type { ReasoningResult } from '../reasoning/types';
import type { VerticalProfile } from '../verticalAIProfiles/types';
import type { AIReasoningResult, SalesAgentEvidenceReference } from './types';
import { validateSalesAgentReasoningResult } from './validation';

export function adaptStage2ReasoningResultToSalesAgent(input: {
  stage2_result: ReasoningResult;
  context: ContextSnapshot;
  profile: VerticalProfile;
  generated_at: string;
}): AIReasoningResult {
  if (input.stage2_result.requiresHumanReview !== true || input.stage2_result.executable !== false) {
    throw new Error('Stage2 compatibility accepts only human-reviewed, non-executable reasoning.');
  }
  const customer = input.context.customers[0];
  if (!customer) throw new Error('Stage2 compatibility requires a customer fact.');
  const customerEvidence = customer.evidenceIds;
  const opportunities = input.stage2_result.output.suggestions.map(suggestion => ({
    id: suggestion.suggestionId,
    summary: `${suggestion.title}: ${suggestion.summary}`,
    evidence_ids: suggestion.evidence.map(item => item.evidenceId),
  }));
  const decision_basis = [
    { claim_path: 'customer_summary', evidence_ids: customerEvidence },
    { claim_path: 'customer_stage', evidence_ids: customerEvidence },
    ...opportunities.map(item => ({ claim_path: `opportunities.${item.id}`, evidence_ids: item.evidence_ids })),
    { claim_path: 'confidence', evidence_ids: customerEvidence },
  ];
  const usedEvidence = [...new Set(decision_basis.flatMap(item => item.evidence_ids))];
  const factIndex = buildFactIndex(input.context);
  const result: AIReasoningResult = {
    kind: 'AI_SALES_AGENT_REASONING_RESULT',
    version: 'v1',
    customer_summary: { value: `${customer.name} is graded ${customer.grade} with ${customer.intentLevel} intent.`, evidence_ids: customerEvidence },
    customer_stage: { value: customer.intentLevel, evidence_ids: customerEvidence },
    opportunities,
    risks: [],
    next_actions: [],
    confidence: { value: 0.5, evidence_ids: customerEvidence },
    evidence: usedEvidence.map(evidence_id => ({
      evidence_id,
      ...requireFact(factIndex, evidence_id),
      supports: decision_basis.filter(item => item.evidence_ids.includes(evidence_id)).map(item => item.claim_path),
    })),
    decision_basis,
    reasoning_metadata: {
      profile_id: input.profile.identity.id,
      provider_id: 'stage2_reasoning_compatibility_adapter',
      provider_kind: 'STAGE2_COMPATIBILITY',
      model_id: 'stage2_reasoning_contract_v1',
      execution_mode: 'MOCK',
      generated_at: input.generated_at,
      context_snapshot_id: input.context.snapshotId,
    },
    requires_human_review: true,
    executable: false,
    writes_crm: false,
  };
  const validation = validateSalesAgentReasoningResult(result, input.context);
  if (!validation.valid) throw new Error(`Stage2 reasoning compatibility rejected: ${validation.errors.join('; ')}`);
  return result;
}

function buildFactIndex(context: ContextSnapshot): Map<string, Pick<SalesAgentEvidenceReference, 'fact_type' | 'fact_id'>> {
  const entries: [string, Pick<SalesAgentEvidenceReference, 'fact_type' | 'fact_id'>][] = [];
  context.customers.forEach(fact => fact.evidenceIds.forEach(id => entries.push([id, { fact_type: 'customer', fact_id: fact.customerId }])));
  context.accounts.forEach(fact => fact.evidenceIds.forEach(id => entries.push([id, { fact_type: 'account', fact_id: fact.accountId }])));
  context.recentInteractions.forEach(fact => fact.evidenceIds.forEach(id => entries.push([id, { fact_type: 'interaction', fact_id: fact.interactionId }])));
  return new Map(entries);
}

function requireFact(index: Map<string, Pick<SalesAgentEvidenceReference, 'fact_type' | 'fact_id'>>, evidenceId: string) {
  const fact = index.get(evidenceId);
  if (!fact) throw new Error(`Stage2 evidence is not traceable to a ContextSnapshot fact: ${evidenceId}`);
  return fact;
}
