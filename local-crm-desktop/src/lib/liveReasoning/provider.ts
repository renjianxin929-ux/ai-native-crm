import {
  executeTrustedHostCapability,
  type TrustedHostAuthorizationResult,
  type TrustedHostCapabilityBinding,
  type TrustedHostCompletionResult,
} from '../modelCapabilities/trustedHost';
import type { ReasoningProvider } from '../salesAgent/provider';
import type { SalesAgentReasoningRequest } from '../salesAgent/types';

export interface TrustedHostLiveReasoningAuthorization {
  readonly authorization: TrustedHostAuthorizationResult;
  readonly binding: TrustedHostCapabilityBinding;
}

export type TrustedHostModelExecutor = (input: {
  readonly authorizationId: string;
  readonly binding: TrustedHostCapabilityBinding;
  readonly input: unknown;
}) => Promise<TrustedHostCompletionResult>;

/**
 * A generic provider adapter: Runtime supplies a capability and structured
 * request, while only the native host resolves credentials and uses network.
 */
export function createTrustedHostCapabilityProvider(
  input: TrustedHostLiveReasoningAuthorization & { readonly execute?: TrustedHostModelExecutor },
): ReasoningProvider {
  const { authorization, binding } = input;
  if (authorization.state !== 'authorized' || binding.capability !== 'TEXT_REASONING' || authorization.providerKind !== 'DEEPSEEK_COMPATIBLE') {
    throw new Error('Trusted-host live reasoning requires a TEXT_REASONING authorization.');
  }
  if (authorization.providerKind !== binding.providerKind || authorization.capability !== binding.capability) {
    throw new Error('Trusted-host authorization capability mismatch.');
  }
  const execute = input.execute ?? executeTrustedHostCapability;
  return {
    id: `trusted-host:${authorization.providerKind}:${authorization.modelId}`,
    capability: {
      providerKind: 'DEEPSEEK_COMPATIBLE',
      modelIdentifier: authorization.modelId,
      executionMode: 'LIVE',
      networkAccess: true,
      environmentAccess: false,
      liveEnabled: true,
    },
    async reason(request: SalesAgentReasoningRequest): Promise<unknown> {
      const result = await execute({
        authorizationId: authorization.authorizationId,
        binding,
        input: serializeReasoningRequest(request),
      });
      if (result.state !== 'completed' || result.providerKind !== authorization.providerKind || result.modelId !== authorization.modelId) {
        throw new Error('Trusted host returned an invalid completion envelope.');
      }
      return result.output;
    },
  };
}

/** @deprecated Use createTrustedHostCapabilityProvider for explicit capability binding. */
export const createTrustedHostLiveReasoningProvider = createTrustedHostCapabilityProvider;

function serializeReasoningRequest(request: SalesAgentReasoningRequest): object {
  return {
    objective: request.objective,
    context: request.context,
    memory: request.memory,
    vertical_profile: request.vertical_profile,
    required_schema: 'AIReasoningResult v1 with evidence and decision_basis',
    safety: {
      human_review_required: true,
      executable: false,
      writes_crm: false,
      sends_message: false,
      creates_task: false,
    },
  };
}
