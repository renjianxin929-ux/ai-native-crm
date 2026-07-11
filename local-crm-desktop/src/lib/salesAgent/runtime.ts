import { resolveVerticalAIProfile } from '../verticalAIProfiles/registry';
import type { ReasoningProvider } from './provider';
import type { ContextSnapshot } from '../context/types';
import type { SalesAgentReasoningRequest, SalesAgentRuntimeResult } from './types';
import { validateSalesAgentReasoningResult } from './validation';
import { validateLiveReasoningActivation, type LiveReasoningActivation } from '../liveReasoning/types';
import type { CustomerMemoryContext } from '../customerMemory';

export async function runSalesAgentRuntime(input: {
  request_id: string;
  objective: string;
  context: ContextSnapshot;
  profile_id: string;
  provider: ReasoningProvider;
  memory?: CustomerMemoryContext;
  live_activation?: LiveReasoningActivation;
  clock?: () => string;
}): Promise<SalesAgentRuntimeResult> {
  if (!input.request_id.trim() || !input.objective.trim()) throw new Error('Runtime request id and objective are required.');
  if (input.context.readOnly !== true) throw new Error('Sales Agent Runtime requires a read-only ContextSnapshot.');
  if (input.memory && (input.memory.read_only !== true || input.memory.persisted !== false || input.memory.customer_id !== input.context.customers[0]?.customerId)) {
    throw new Error('Sales Agent Runtime requires a read-only, customer-bound memory context.');
  }
  const isLive = input.provider.capability.executionMode === 'LIVE';
  if (!isLive && input.provider.capability.executionMode !== 'MOCK') throw new Error('Stage3 Sales Agent Runtime permits MOCK provider execution only; non-MOCK providers require the Live Reasoning Activation Gate.');
  if (isLive) {
    const activationError = validateLiveReasoningActivation(input.live_activation);
    if (activationError) throw new Error(`Live Reasoning Activation Gate blocked: ${activationError}.`);
    if (input.live_activation!.provider_kind !== input.provider.capability.providerKind || input.live_activation!.model_id !== input.provider.capability.modelIdentifier || input.live_activation!.profile_id !== input.profile_id || input.live_activation!.context_snapshot_id !== input.context.snapshotId) throw new Error('Live Reasoning Activation Gate blocked: request metadata mismatch.');
    const customerId = input.context.customers[0]?.customerId;
    if (!customerId || input.live_activation!.customer_id !== customerId) throw new Error('Live Reasoning Activation Gate blocked: customer context mismatch.');
  }
  const profile = resolveVerticalAIProfile(input.profile_id);
  const generatedAt = input.clock?.() ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Runtime clock must return a valid timestamp.');
  const request: SalesAgentReasoningRequest = {
    request_id: input.request_id,
    objective: input.objective,
    context: input.context,
    memory: input.memory,
    vertical_profile: profile,
    generated_at: generatedAt,
    safety: {
      allow_network: isLive,
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
