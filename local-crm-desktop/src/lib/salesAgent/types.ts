import type { ContextSnapshot } from '../context/types';
import type { VerticalProfile } from '../verticalAIProfiles/types';

export type SalesAgentProviderKind = 'MOCK' | 'OPENAI_COMPATIBLE' | 'DEEPSEEK_COMPATIBLE' | 'LOCAL_MODEL' | 'STAGE2_COMPATIBILITY';
export type SalesAgentProviderExecutionMode = 'MOCK' | 'SANDBOX' | 'LIVE';

export interface EvidenceBackedJudgment<T> {
  value: T;
  evidence_ids: readonly string[];
}

export interface EvidenceBackedItem {
  id: string;
  summary: string;
  evidence_ids: readonly string[];
}

export interface SalesAgentEvidenceReference {
  evidence_id: string;
  fact_type: 'customer' | 'account' | 'interaction';
  fact_id: string;
  supports: readonly string[];
}

export interface SalesAgentDecisionBasis {
  claim_path: string;
  evidence_ids: readonly string[];
}

export interface SalesAgentReasoningMetadata {
  profile_id: string;
  provider_id: string;
  provider_kind: SalesAgentProviderKind;
  model_id: string;
  execution_mode: SalesAgentProviderExecutionMode;
  generated_at: string;
  context_snapshot_id: string;
}

export interface AIReasoningResult {
  kind: 'AI_SALES_AGENT_REASONING_RESULT';
  version: 'v1';
  customer_summary: EvidenceBackedJudgment<string>;
  customer_stage: EvidenceBackedJudgment<string>;
  opportunities: readonly EvidenceBackedItem[];
  risks: readonly EvidenceBackedItem[];
  next_actions: readonly EvidenceBackedItem[];
  confidence: EvidenceBackedJudgment<number>;
  evidence: readonly SalesAgentEvidenceReference[];
  decision_basis: readonly SalesAgentDecisionBasis[];
  reasoning_metadata: SalesAgentReasoningMetadata;
  requires_human_review: true;
  executable: false;
  writes_crm: false;
}

export interface SalesAgentReasoningRequest {
  request_id: string;
  objective: string;
  context: ContextSnapshot;
  vertical_profile: VerticalProfile;
  generated_at: string;
  safety: {
    allow_network: boolean;
    allow_environment_read: false;
    allow_database_write: false;
    allow_crm_action: false;
  };
}

export type SalesAgentRuntimeStep = 'observe' | 'understand' | 'reason' | 'suggest' | 'human_review';

export interface SalesAgentRuntimeTraceEntry {
  step: SalesAgentRuntimeStep;
  status: 'completed' | 'required';
}

export interface SalesAgentRuntimeResult {
  kind: 'AI_SALES_AGENT_RUNTIME_RESULT';
  version: 'v1';
  request_id: string;
  profile_id: string;
  result: AIReasoningResult;
  trace: readonly SalesAgentRuntimeTraceEntry[];
  review_status: 'pending_human_review';
  provider_id: string;
  model_id: string;
  persisted: false;
}
