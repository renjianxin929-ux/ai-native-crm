import {
  authorizeTrustedHostCapability,
  cancelTrustedHostRequest,
  executeTrustedHostCapability,
  listTrustedHostProviderStatus,
  probeTrustedHostProviderHealth,
  type TrustedHostCapabilityBinding,
  type TrustedHostCompletionResult,
} from '../modelCapabilities/trustedHost';
import type { ModelContextEnvelope } from '../productionAi/modelContextEnvelope';
import type { ProductionModelCallResult, ProductionModelCaller } from '../productionAi/productionReasoningPath';
import type { SalesAgentHost } from './agentSession';
import { createSemanticIntentRouter } from '../productionAi/semanticIntentRouter';

export type TrustedHostExecutor = (input: {
  readonly authorizationId: string;
  readonly binding: TrustedHostCapabilityBinding;
  readonly input: unknown;
}) => Promise<TrustedHostCompletionResult>;

export type TrustedHostAuthorizer = (request: TrustedHostCapabilityBinding) => Promise<{
  readonly authorizationId: string;
  readonly providerKind: string;
  readonly modelId: string;
}>;

/**
 * Production-only bridge to Tauri.
 * React never creates providers, never holds API keys, never calls model endpoints from the browser.
 */
export function createTrustedHostSalesAgentAdapter(input: {
  readonly context_snapshot_id: string;
  readonly profile_id: string;
  readonly authorize?: TrustedHostAuthorizer;
  readonly execute?: TrustedHostExecutor;
  readonly cancel?: (requestId: string) => Promise<boolean>;
}): SalesAgentHost & {
  readonly createProductionModelCaller: () => ProductionModelCaller;
  readonly routeSemanticIntent: (instruction: string, envelopeId: string, signal?: AbortSignal) => Promise<import('./agentIntentEnvelope').SemanticIntentResolution>;
} {
  const authorize = input.authorize ?? authorizeTrustedHostCapability;
  const execute = input.execute ?? executeTrustedHostCapability;
  const cancelRequest = input.cancel ?? cancelTrustedHostRequest;

  async function executeCapability(
    customer_id: string,
    capability: 'TEXT_REASONING' | 'VISION_ANALYSIS' | 'SEMANTIC_INTENT_ROUTING',
    provider_kind: 'DEEPSEEK_COMPATIBLE' | 'QWEN_VISION_COMPATIBLE',
    model_id: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<TrustedHostCompletionResult> {
    const binding: TrustedHostCapabilityBinding = {
      capability,
      providerKind: provider_kind,
      modelId: model_id,
      customerId: customer_id,
      contextSnapshotId: input.context_snapshot_id,
      workflowKind: capability === 'SEMANTIC_INTENT_ROUTING' ? 'interaction_intelligence' : 'customer_intelligence',
      profileId: input.profile_id,
      requestedByUser: true,
    };
    const authorization = await authorize(binding);
    if (signal?.aborted) {
      await cancelRequest(authorization.authorizationId);
      throw new Error('cancelled');
    }
    const cancel = () => { void cancelRequest(authorization.authorizationId); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await execute({ authorizationId: authorization.authorizationId, binding, input: payload });
      if (signal?.aborted) {
        await cancelRequest(authorization.authorizationId);
        throw new Error('cancelled');
      }
      return result;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  const routeSemanticIntent = createSemanticIntentRouter(async (call, signal) => (
    await executeCapability(
      'semantic-routing',
      'SEMANTIC_INTENT_ROUTING',
      'DEEPSEEK_COMPATIBLE',
      'deepseek-chat',
      call,
      signal,
    )
  ).output);

  function createProductionModelCaller(): ProductionModelCaller {
    return async ({ envelope, capability, attempt, validation_errors, signal }) => {
      const provider_kind = capability === 'VISION_ANALYSIS' ? 'QWEN_VISION_COMPATIBLE' as const : 'DEEPSEEK_COMPATIBLE' as const;
      const model_id = capability === 'VISION_ANALYSIS' ? 'qwen-vl-plus' : 'deepseek-chat';
      const customer_id = envelope.customer_id ?? 'portfolio';
      const result = await executeCapability(customer_id, capability, provider_kind, model_id, {
        model_context_envelope: envelope,
        required_schema: envelope.requested_output_schema,
        attempt,
        validation_errors,
      }, signal);
      return mapCompletion(result, envelope);
    };
  }

  return {
    reason: async ({ customer_id, message }) => (
      await executeCapability(customer_id, 'TEXT_REASONING', 'DEEPSEEK_COMPATIBLE', 'deepseek-chat', { message })
    ).output,
    capture: async ({ customer_id, source_type, source, signal }) => {
      if (source_type !== 'image') {
        return (await executeCapability(customer_id, 'TEXT_REASONING', 'DEEPSEEK_COMPATIBLE', 'deepseek-chat', { source_type, source }, signal)).output;
      }
      const image = parseVisionDataUrl(source);
      return (await executeCapability(customer_id, 'VISION_ANALYSIS', 'QWEN_VISION_COMPATIBLE', 'qwen-vl-plus', {
        vision_request: image,
        required_schema: 'image_capture_analysis_v1',
      }, signal)).output;
    },
    createProductionModelCaller,
    routeSemanticIntent,
  };
}

function parseVisionDataUrl(source: string): { mime_type: string; image_base64: string; source_reference: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(source);
  if (!match) throw new Error('图片格式无效，仅支持 JPEG、PNG、WebP。');
  const encoded = match[2];
  const approximateBytes = Math.floor(encoded.length * 0.75);
  if (approximateBytes <= 0 || approximateBytes > 8 * 1024 * 1024) throw new Error('图片大小超过 8 MB 限制。');
  return { mime_type: match[1], image_base64: encoded, source_reference: 'user-selected-image' };
}

function mapCompletion(result: TrustedHostCompletionResult, envelope: ModelContextEnvelope): ProductionModelCallResult {
  return {
    output: result.output,
    provider_kind: result.providerKind,
    model_id: result.modelId,
    request_id: result.requestId ?? envelope.request_id,
    latency_ms: result.latencyMs ?? null,
    token_usage: result.tokenUsage
      ? {
          prompt_tokens: result.tokenUsage.promptTokens ?? null,
          completion_tokens: result.tokenUsage.completionTokens ?? null,
          total_tokens: result.tokenUsage.totalTokens ?? null,
        }
      : null,
  };
}

/** Configuration status listing — safe for settings UI; does not complete a model call. */
export async function loadTrustedHostProviderStatus() {
  return listTrustedHostProviderStatus();
}

/** Explicit user click only. */
export async function testTrustedHostConnection(capability: 'TEXT_REASONING' | 'VISION_ANALYSIS') {
  const providerKind = capability === 'VISION_ANALYSIS' ? 'QWEN_VISION_COMPATIBLE' as const : 'DEEPSEEK_COMPATIBLE' as const;
  return probeTrustedHostProviderHealth({ capability, providerKind });
}
