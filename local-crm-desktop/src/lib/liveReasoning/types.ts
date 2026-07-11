import type { SalesAgentProviderKind } from '../salesAgent/types';

export const LIVE_REASONING_AUTHORIZATION_PHRASE = 'RUN_ONE_LIVE_SALES_AGENT_REASONING' as const;

export type LiveReasoningWorkflowKind = 'customer_intelligence' | 'interaction_intelligence';

export interface LiveReasoningActivation {
  live_call_requested: true;
  user_explicitly_authorized: true;
  authorization_phrase: typeof LIVE_REASONING_AUTHORIZATION_PHRASE;
  provider_kind: Extract<SalesAgentProviderKind, 'OPENAI_COMPATIBLE' | 'DEEPSEEK_COMPATIBLE'>;
  model_id: string;
  profile_id: string;
  workflow_kind: LiveReasoningWorkflowKind;
  customer_id: string;
  context_snapshot_id: string;
}

export interface LiveReasoningRequestMetadata {
  provider_kind: LiveReasoningActivation['provider_kind'];
  model_id: string;
  workflow_kind: LiveReasoningWorkflowKind;
  profile_id: string;
  started_at: string;
  completed_at: string;
  latency_ms: number;
  status: 'success' | 'blocked' | 'timeout' | 'provider_error' | 'invalid_model_output';
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export function validateLiveReasoningActivation(value: unknown): string | null {
  if (!isRecord(value)) return 'live activation is required';
  if (value.live_call_requested !== true || value.user_explicitly_authorized !== true) return 'explicit live authorization is required';
  if (value.authorization_phrase !== LIVE_REASONING_AUTHORIZATION_PHRASE) return 'live authorization phrase is invalid';
  if (value.provider_kind !== 'OPENAI_COMPATIBLE' && value.provider_kind !== 'DEEPSEEK_COMPATIBLE') return 'live provider kind is invalid';
  if (!hasText(value.model_id) || !hasText(value.profile_id) || !hasText(value.customer_id) || !hasText(value.context_snapshot_id)) return 'live activation identity is incomplete';
  if (value.workflow_kind !== 'customer_intelligence' && value.workflow_kind !== 'interaction_intelligence') return 'live workflow is not supported';
  return null;
}

function hasText(value: unknown): boolean { return typeof value === 'string' && value.trim().length > 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
