import type { AIReasoningResult, SalesAgentProviderExecutionMode, SalesAgentProviderKind, SalesAgentReasoningRequest } from './types';

export interface ReasoningProviderCapability {
  providerKind: SalesAgentProviderKind;
  modelIdentifier: string;
  executionMode: SalesAgentProviderExecutionMode;
  networkAccess: false;
  environmentAccess: false;
  liveEnabled: false;
}

export interface ReasoningProvider {
  readonly id: string;
  readonly capability: ReasoningProviderCapability;
  reason(request: SalesAgentReasoningRequest): Promise<unknown>;
}

export type OpenAICompatibleTransport = (input: {
  endpoint: string;
  model: string;
  request: SalesAgentReasoningRequest;
}) => Promise<unknown>;

export function createOpenAICompatibleProviderBoundary(input: {
  id: string;
  endpoint: string;
  model: string;
  transport: OpenAICompatibleTransport;
}): ReasoningProvider {
  if (!input.id.trim() || !input.endpoint.trim() || !input.model.trim()) {
    throw new Error('OpenAI-compatible provider boundary requires id, endpoint, and model.');
  }
  return {
    id: input.id,
    capability: {
      providerKind: 'OPENAI_COMPATIBLE',
      modelIdentifier: input.model,
      executionMode: 'SANDBOX',
      networkAccess: false,
      environmentAccess: false,
      liveEnabled: false,
    },
    async reason(request) {
      if (request.safety.allow_network !== true) {
        throw new Error('Provider transport is blocked outside an explicit network sandbox.');
      }
      return input.transport({ endpoint: input.endpoint, model: input.model, request });
    },
  };
}

export function createMockReasoningProvider(): ReasoningProvider {
  return {
    id: 'mock_sales_reasoning_v1',
    capability: {
      providerKind: 'MOCK',
      modelIdentifier: 'deterministic_fixture_v1',
      executionMode: 'MOCK',
      networkAccess: false,
      environmentAccess: false,
      liveEnabled: false,
    },
    async reason(request): Promise<AIReasoningResult> {
      const customer = request.context.customers[0];
      if (!customer) throw new Error('Mock reasoning requires one customer fact.');
      const customerEvidence = customer.evidenceIds;
      const interaction = request.context.recentInteractions[0];
      const currentEvidence = interaction?.evidenceIds ?? customerEvidence;
      const allEvidence = [...new Set([...customerEvidence, ...currentEvidence])];
      const evidenceIndex = buildEvidenceIndex(request);
      const basis = [
        { claim_path: 'customer_summary', evidence_ids: customerEvidence },
        { claim_path: 'customer_stage', evidence_ids: customerEvidence },
        { claim_path: 'opportunities.opportunity-1', evidence_ids: customerEvidence },
        ...(interaction ? [{ claim_path: 'risks.risk-1', evidence_ids: currentEvidence }] : []),
        { claim_path: 'next_actions.next-action-1', evidence_ids: allEvidence },
        { claim_path: 'confidence', evidence_ids: allEvidence },
      ];
      return {
        kind: 'AI_SALES_AGENT_REASONING_RESULT',
        version: 'v1',
        customer_summary: {
          value: `${customer.name} is currently graded ${customer.grade} with ${customer.intentLevel} intent.`,
          evidence_ids: customerEvidence,
        },
        customer_stage: { value: customer.intentLevel, evidence_ids: customerEvidence },
        opportunities: [{
          id: 'opportunity-1',
          summary: `Review the ${request.vertical_profile.identity.name} signals against the current customer intent.`,
          evidence_ids: customerEvidence,
        }],
        risks: interaction ? [{
          id: 'risk-1',
          summary: `The latest recorded interaction requires human interpretation: ${interaction.summary}`,
          evidence_ids: currentEvidence,
        }] : [],
        next_actions: [{
          id: 'next-action-1',
          summary: 'Human reviewer should verify the cited evidence before deciding any follow-up.',
          evidence_ids: allEvidence,
        }],
        confidence: { value: interaction ? 0.78 : 0.62, evidence_ids: allEvidence },
        evidence: allEvidence.map(evidence_id => ({
          evidence_id,
          ...evidenceIndex.get(evidence_id)!,
          supports: basis.filter(item => item.evidence_ids.includes(evidence_id)).map(item => item.claim_path),
        })),
        decision_basis: basis,
        reasoning_metadata: {
          profile_id: request.vertical_profile.identity.id,
          provider_id: 'mock_sales_reasoning_v1',
          provider_kind: 'MOCK',
          model_id: 'deterministic_fixture_v1',
          execution_mode: 'MOCK',
          generated_at: request.generated_at,
          context_snapshot_id: request.context.snapshotId,
        },
        requires_human_review: true,
        executable: false,
        writes_crm: false,
      };
    },
  };
}

function buildEvidenceIndex(request: SalesAgentReasoningRequest): Map<string, { fact_type: 'customer' | 'account' | 'interaction'; fact_id: string }> {
  const entries: [string, { fact_type: 'customer' | 'account' | 'interaction'; fact_id: string }][] = [];
  request.context.customers.forEach(fact => fact.evidenceIds.forEach(id => entries.push([id, { fact_type: 'customer', fact_id: fact.customerId }])));
  request.context.accounts.forEach(fact => fact.evidenceIds.forEach(id => entries.push([id, { fact_type: 'account', fact_id: fact.accountId }])));
  request.context.recentInteractions.forEach(fact => fact.evidenceIds.forEach(id => entries.push([id, { fact_type: 'interaction', fact_id: fact.interactionId }])));
  return new Map(entries);
}
