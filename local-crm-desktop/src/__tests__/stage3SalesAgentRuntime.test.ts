import { describe, expect, it } from 'vitest';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createMockReasoningProvider, createOpenAICompatibleProviderBoundary, type ReasoningProviderCapability } from '../lib/salesAgent/provider';
import { runSalesAgentRuntime } from '../lib/salesAgent/runtime';

describe('Stage3 Sales Agent Runtime', () => {
  it('executes observe-understand-reason-suggest-human-review without mutation', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const runtime = await runSalesAgentRuntime({ request_id: 'stage3-1', objective: 'Assess sales situation', context: fixture.context, profile_id: fixture.profile.identity.id, provider: createMockReasoningProvider(), clock: () => '2026-07-11T00:00:00.000Z' });
    expect(runtime.trace.map(item => item.step)).toEqual(['observe', 'understand', 'reason', 'suggest', 'human_review']);
    expect(runtime).toMatchObject({ review_status: 'pending_human_review', persisted: false });
    expect(runtime.result).toMatchObject({ requires_human_review: true, executable: false, writes_crm: false });
    expect(runtime.result.customer_summary.evidence_ids.length).toBeGreaterThan(0);
    expect(runtime.result.reasoning_metadata).toEqual({
      profile_id: fixture.profile.identity.id,
      provider_id: 'mock_sales_reasoning_v1',
      provider_kind: 'MOCK',
      model_id: 'deterministic_fixture_v1',
      execution_mode: 'MOCK',
      generated_at: '2026-07-11T00:00:00.000Z',
      context_snapshot_id: fixture.context.snapshotId,
    });
    expect(runtime.result.decision_basis.map(item => item.claim_path)).toContain('customer_summary');
  });

  it('keeps OpenAI-compatible transport behind an explicit sandbox switch', async () => {
    let called = false;
    const provider = createOpenAICompatibleProviderBoundary({ id: 'compatible', endpoint: 'https://example.invalid/v1', model: 'test', transport: async () => { called = true; return {}; } });
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    expect(provider.capability).toMatchObject({ providerKind: 'OPENAI_COMPATIBLE', executionMode: 'SANDBOX', liveEnabled: false, networkAccess: false });
    await expect(runSalesAgentRuntime({ request_id: 'stage3-2', objective: 'Assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider })).rejects.toThrow('permits MOCK provider execution only');
    expect(called).toBe(false);
  });

  it('supports future provider identities without enabling their execution', () => {
    const capabilities: readonly ReasoningProviderCapability[] = [
      { providerKind: 'OPENAI_COMPATIBLE', modelIdentifier: 'gpt-future', executionMode: 'SANDBOX', networkAccess: false, environmentAccess: false, liveEnabled: false },
      { providerKind: 'DEEPSEEK_COMPATIBLE', modelIdentifier: 'deepseek-future', executionMode: 'SANDBOX', networkAccess: false, environmentAccess: false, liveEnabled: false },
      { providerKind: 'LOCAL_MODEL', modelIdentifier: 'local-future', executionMode: 'SANDBOX', networkAccess: false, environmentAccess: false, liveEnabled: false },
    ];
    expect(capabilities.map(item => item.providerKind)).toEqual(['OPENAI_COMPATIBLE', 'DEEPSEEK_COMPATIBLE', 'LOCAL_MODEL']);
    expect(capabilities.every(item => item.liveEnabled === false && item.networkAccess === false)).toBe(true);
  });

  it('rejects provider metadata that does not match the runtime-selected provider', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const mock = createMockReasoningProvider();
    const provider = { ...mock, id: 'runtime-provider', reason: mock.reason };
    await expect(runSalesAgentRuntime({ request_id: 'stage3-3', objective: 'Assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider, clock: () => '2026-07-11T00:00:00.000Z' })).rejects.toThrow('provider_id mismatch');
  });
});
