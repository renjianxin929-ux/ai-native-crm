import { authorizeTrustedHostCapability, executeTrustedHostCapability } from '../modelCapabilities/trustedHost';
import type { SalesAgentHost } from './agentSession';

/** Production-only bridge to Tauri. It holds neither credentials nor a browser transport. */
export function createTrustedHostSalesAgentAdapter(input: { context_snapshot_id: string; profile_id: string }): SalesAgentHost {
  async function execute(customer_id: string, capability: 'TEXT_REASONING' | 'VISION_ANALYSIS', provider_kind: 'DEEPSEEK_COMPATIBLE' | 'QWEN_VISION_COMPATIBLE', model_id: string, payload: unknown) {
    const binding = { capability, providerKind: provider_kind, modelId: model_id, customerId: customer_id, contextSnapshotId: input.context_snapshot_id, workflowKind: 'customer_intelligence' as const, profileId: input.profile_id, requestedByUser: true as const };
    const authorization = await authorizeTrustedHostCapability(binding);
    return (await executeTrustedHostCapability({ authorizationId: authorization.authorizationId, binding, input: payload })).output;
  }
  return { reason: ({ customer_id, message }) => execute(customer_id, 'TEXT_REASONING', 'DEEPSEEK_COMPATIBLE', 'deepseek-chat', { message }), capture: ({ customer_id, source_type, source }) => execute(customer_id, 'VISION_ANALYSIS', 'QWEN_VISION_COMPATIBLE', 'qwen-vl-plus', { source_type, source }) };
}
