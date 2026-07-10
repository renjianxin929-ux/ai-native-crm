import { resolveVerticalAIProfile } from '../verticalAIProfiles/registry';
import type { ReasoningProvider } from './provider';
import type { ContextSnapshot } from '../context/types';
import type { SalesAgentReasoningRequest, SalesAgentRuntimeResult } from './types';
import { validateSalesAgentReasoningResult } from './validation';

export async function runSalesAgentRuntime(input: {
  request_id: string;
  objective: string;
  context: ContextSnapshot;
  profile_id: string;
  provider: ReasoningProvider;
  sandbox?: { allow_network: true };
  clock?: () => string;
}): Promise<SalesAgentRuntimeResult> {
  if (!input.request_id.trim() || !input.objective.trim()) throw new Error('Runtime request id and objective are required.');
  if (input.context.readOnly !== true) throw new Error('Sales Agent Runtime requires a read-only ContextSnapshot.');
  if (input.provider.capability.executionMode !== 'MOCK') {
    throw new Error('Stage3 Sales Agent Runtime permits MOCK provider execution only.');
  }
  const profile = resolveVerticalAIProfile(input.profile_id);
  const generatedAt = input.clock?.() ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Runtime clock must return a valid timestamp.');
  const request: SalesAgentReasoningRequest = {
    request_id: input.request_id,
    objective: input.objective,
    context: input.context,
    vertical_profile: profile,
    generated_at: generatedAt,
    safety: {
      allow_network: input.sandbox?.allow_network === true,
      allow_environment_read: false,
      allow_database_write: false,
      allow_crm_action: false,
    },
  };
  const candidate = await input.provider.reason(request);
  const validation = validateSalesAgentReasoningResult(candidate, input.context, {
    profile_id: profile.identity.id,
    provider_id: input.provider.id,
    provider_kind: input.provider.capability.providerKind,
    model_id: input.provider.capability.modelIdentifier,
    execution_mode: input.provider.capability.executionMode,
    generated_at: generatedAt,
  });
  if (!validation.valid) throw new Error(`Sales Agent reasoning rejected: ${validation.errors.join('; ')}`);
  return {
    kind: 'AI_SALES_AGENT_RUNTIME_RESULT',
    version: 'v1',
    request_id: input.request_id,
    profile_id: profile.identity.id,
    result: candidate as SalesAgentRuntimeResult['result'],
    trace: [
      { step: 'observe', status: 'completed' },
      { step: 'understand', status: 'completed' },
      { step: 'reason', status: 'completed' },
      { step: 'suggest', status: 'completed' },
      { step: 'human_review', status: 'required' },
    ],
    review_status: 'pending_human_review',
    provider_id: input.provider.id,
    model_id: input.provider.capability.modelIdentifier,
    persisted: false,
  };
}
