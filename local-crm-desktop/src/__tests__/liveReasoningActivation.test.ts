import { describe, expect, it, vi } from 'vitest';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';
import { runSalesAgentRuntime } from '../lib/salesAgent/runtime';
import { createLiveReasoningProvider } from '../lib/liveReasoning/provider';
import { runSalesCopilotWorkflow } from '../lib/salesCopilot/workflow';
import { LIVE_REASONING_AUTHORIZATION_PHRASE } from '../lib/liveReasoning/types';

const clock = () => '2026-07-11T00:00:00.000Z';

function activation(fixture = STAGE2_EVALUATION_FIXTURES[0], workflow_kind: 'customer_intelligence' | 'interaction_intelligence' = 'customer_intelligence') {
  return { live_call_requested: true as const, user_explicitly_authorized: true as const, authorization_phrase: LIVE_REASONING_AUTHORIZATION_PHRASE, provider_kind: 'OPENAI_COMPATIBLE' as const, model_id: 'test-model', profile_id: fixture.profile.identity.id, workflow_kind, customer_id: fixture.context.customers[0].customerId, context_snapshot_id: fixture.context.snapshotId };
}

async function canonicalResult(fixture = STAGE2_EVALUATION_FIXTURES[0]) {
  const mock = await runSalesAgentRuntime({ request_id: 'seed', objective: 'seed', context: fixture.context, profile_id: fixture.profile.identity.id, provider: createMockReasoningProvider(), clock });
  return { ...mock.result, reasoning_metadata: { ...mock.result.reasoning_metadata, provider_id: 'live-test', provider_kind: 'OPENAI_COMPATIBLE' as const, model_id: 'test-model', execution_mode: 'LIVE' as const } };
}

describe('Live Reasoning Activation Gate', () => {
  it('blocks missing or invalid authorization before transport invocation', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0]; const complete = vi.fn();
    const provider = createLiveReasoningProvider({ id: 'live-test', config: { endpoint: 'https://provider.example/v1/chat/completions', api_key: 'test-only-secret', model_id: 'test-model', provider_kind: 'OPENAI_COMPATIBLE', timeout_ms: 100, max_response_bytes: 4096 }, transport: { complete } });
    await expect(runSalesAgentRuntime({ request_id: 'no-auth', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, clock })).rejects.toThrow('live activation is required');
    await expect(runSalesAgentRuntime({ request_id: 'bad-phrase', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, live_activation: { ...activation(fixture), authorization_phrase: 'WRONG' } as never, clock })).rejects.toThrow('authorization phrase');
    expect(complete).not.toHaveBeenCalled();
  });

  it('sends exactly one injected transport call and validates the canonical result', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0]; const result = await canonicalResult(fixture);
    const complete = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(result) } }] });
    const provider = createLiveReasoningProvider({ id: 'live-test', config: { endpoint: 'https://provider.example/v1/chat/completions', api_key: 'test-only-secret', model_id: 'test-model', provider_kind: 'OPENAI_COMPATIBLE', timeout_ms: 100, max_response_bytes: 4096 }, transport: { complete } });
    const runtime = await runSalesAgentRuntime({ request_id: 'one', objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, live_activation: activation(fixture), clock });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(runtime.result).toMatchObject({ requires_human_review: true, executable: false, writes_crm: false, reasoning_metadata: { execution_mode: 'LIVE' } });
  });

  it('rejects invalid JSON, unknown evidence, unsafe safety flags, and metadata mismatch', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0]; const valid = await canonicalResult(fixture);
    for (const content of ['not-json', JSON.stringify({ ...valid, evidence: [{ ...valid.evidence[0], evidence_id: 'invented' }] }), JSON.stringify({ ...valid, executable: true }), JSON.stringify({ ...valid, reasoning_metadata: { ...valid.reasoning_metadata, model_id: 'other' } })]) {
      const provider = createLiveReasoningProvider({ id: 'live-test', config: { endpoint: 'https://provider.example', api_key: 'test-only-secret', model_id: 'test-model', provider_kind: 'OPENAI_COMPATIBLE', timeout_ms: 100, max_response_bytes: 4096 }, transport: { complete: vi.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } });
      await expect(runSalesAgentRuntime({ request_id: `bad:${content.length}`, objective: 'assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, live_activation: activation(fixture), clock })).rejects.toThrow();
    }
  });

  it.each(STAGE2_EVALUATION_FIXTURES)('supports $profile.identity.id for customer intelligence and keeps Sales Priority MOCK-only', async fixture => {
    const result = await canonicalResult(fixture);
    const provider = createLiveReasoningProvider({ id: 'live-test', config: { endpoint: 'https://provider.example', api_key: 'test-only-secret', model_id: 'test-model', provider_kind: 'OPENAI_COMPATIBLE', timeout_ms: 100, max_response_bytes: 4096 }, transport: { complete: vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(result) } }] }) } });
    const customer = await runSalesCopilotWorkflow({ kind: 'customer_intelligence', request_id: 'customer', context: fixture.context, profile_id: fixture.profile.identity.id, provider, live_activation: activation(fixture), clock });
    expect(customer.runtime.result.reasoning_metadata.execution_mode).toBe('LIVE');
    await expect(runSalesCopilotWorkflow({ kind: 'sales_priority', request_id: 'priority', contexts: [fixture.context], profile_id: fixture.profile.identity.id, provider, clock })).rejects.toThrow('MOCK-only');
  });
});
