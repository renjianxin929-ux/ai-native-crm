import { describe, expect, it, vi } from 'vitest';

import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createTrustedHostLiveReasoningProvider } from '../lib/liveReasoning/provider';
import { LIVE_REASONING_AUTHORIZATION_PHRASE } from '../lib/liveReasoning/types';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';
import { runSalesAgentRuntime } from '../lib/salesAgent/runtime';

const clock = () => '2026-07-11T00:00:00.000Z';
const fixture = STAGE2_EVALUATION_FIXTURES[0];

function binding(overrides: Partial<{ customerId: string; contextSnapshotId: string; profileId: string }> = {}) {
  return {
    capability: 'TEXT_REASONING' as const,
    providerKind: 'DEEPSEEK_COMPATIBLE' as const,
    modelId: 'deepseek-chat',
    customerId: fixture.context.customers[0].customerId,
    contextSnapshotId: fixture.context.snapshotId,
    workflowKind: 'customer_intelligence' as const,
    profileId: fixture.profile.identity.id,
    requestedByUser: true as const,
    ...overrides,
  };
}

function activation() {
  return {
    live_call_requested: true as const,
    user_explicitly_authorized: true as const,
    authorization_phrase: LIVE_REASONING_AUTHORIZATION_PHRASE,
    provider_kind: 'DEEPSEEK_COMPATIBLE' as const,
    capability: 'TEXT_REASONING' as const,
    model_id: 'deepseek-chat',
    profile_id: fixture.profile.identity.id,
    workflow_kind: 'customer_intelligence' as const,
    customer_id: fixture.context.customers[0].customerId,
    context_snapshot_id: fixture.context.snapshotId,
  };
}

async function canonicalResult() {
  const mock = await runSalesAgentRuntime({ request_id: 'seed', objective: 'seed', context: fixture.context, profile_id: fixture.profile.identity.id, provider: createMockReasoningProvider(), clock });
  return { ...mock.result, reasoning_metadata: { ...mock.result.reasoning_metadata, provider_id: 'trusted-host:DEEPSEEK_COMPATIBLE:deepseek-chat', provider_kind: 'DEEPSEEK_COMPATIBLE' as const, model_id: 'deepseek-chat', execution_mode: 'LIVE' as const } };
}

function hostAuthorization() {
  return { state: 'authorized' as const, authorizationId: 'one-time-auth', capability: 'TEXT_REASONING' as const, providerKind: 'DEEPSEEK_COMPATIBLE' as const, modelId: 'deepseek-chat' };
}

describe('Stage5 trusted-host live reasoning activation', () => {
  it('blocks absent host authorization before any host execution', async () => {
    const execute = vi.fn();
    expect(() => createTrustedHostLiveReasoningProvider({ authorization: { ...hostAuthorization(), state: 'blocked' } as never, binding: binding(), execute })).toThrow('authorization');
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes every binding to the host exactly once and preserves host-selected model identity', async () => {
    const result = await canonicalResult();
    const execute = vi.fn().mockResolvedValue({ state: 'completed', providerKind: 'DEEPSEEK_COMPATIBLE', modelId: 'deepseek-chat', output: result });
    const provider = createTrustedHostLiveReasoningProvider({ authorization: hostAuthorization(), binding: binding(), execute });
    const runtime = await runSalesAgentRuntime({ request_id: 'one', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, live_activation: activation(), clock });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toMatchObject({ authorizationId: 'one-time-auth', binding: binding() });
    expect(runtime.result.reasoning_metadata.execution_mode).toBe('LIVE');
  });

  it('rejects reused authorization, wrong customer/snapshot binding, invalid output, and untraceable evidence', async () => {
    const result = await canonicalResult();
    let used = false;
    const execute = vi.fn().mockImplementation(async () => {
      if (used) throw new Error('missing_or_reused_authorization');
      used = true;
      return { state: 'completed', providerKind: 'DEEPSEEK_COMPATIBLE', modelId: 'deepseek-chat', output: result };
    });
    const provider = createTrustedHostLiveReasoningProvider({ authorization: hostAuthorization(), binding: binding(), execute });
    await runSalesAgentRuntime({ request_id: 'first', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, live_activation: activation(), clock });
    await expect(runSalesAgentRuntime({ request_id: 'again', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, live_activation: activation(), clock })).rejects.toThrow('missing_or_reused_authorization');
    const wrongCustomer = createTrustedHostLiveReasoningProvider({ authorization: hostAuthorization(), binding: binding({ customerId: 'other-customer' }), execute: vi.fn().mockRejectedValue(new Error('authorization_binding_mismatch')) });
    await expect(runSalesAgentRuntime({ request_id: 'wrong-customer', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider: wrongCustomer, live_activation: { ...activation(), customer_id: 'other-customer' }, clock })).rejects.toThrow('customer context mismatch');
    const invalidOutput = createTrustedHostLiveReasoningProvider({ authorization: hostAuthorization(), binding: binding(), execute: vi.fn().mockResolvedValue({ state: 'completed', providerKind: 'DEEPSEEK_COMPATIBLE', modelId: 'deepseek-chat', output: { invalid: true } }) });
    await expect(runSalesAgentRuntime({ request_id: 'invalid', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider: invalidOutput, live_activation: activation(), clock })).rejects.toThrow('Sales Agent reasoning rejected');
    const inventedEvidence = { ...result, evidence: [{ ...result.evidence[0], evidence_id: 'invented' }] };
    const invalidEvidence = createTrustedHostLiveReasoningProvider({ authorization: hostAuthorization(), binding: binding(), execute: vi.fn().mockResolvedValue({ state: 'completed', providerKind: 'DEEPSEEK_COMPATIBLE', modelId: 'deepseek-chat', output: inventedEvidence }) });
    await expect(runSalesAgentRuntime({ request_id: 'evidence', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider: invalidEvidence, live_activation: activation(), clock })).rejects.toThrow('Sales Agent reasoning rejected');
  });
});
