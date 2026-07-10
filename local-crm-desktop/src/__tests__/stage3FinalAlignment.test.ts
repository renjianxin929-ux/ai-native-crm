import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { SALES_AGENT_CANONICAL_AI_PATH } from '../lib/salesAgent/canonicalPath';
import { STAGE3_SALES_AGENT_ARCHITECTURE_STATE } from '../lib/salesAgent/architectureState';
import { adaptSalesAgentResultToHumanReviewContract } from '../lib/salesAgent/humanReviewCompatibility';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';
import { runSalesAgentRuntime } from '../lib/salesAgent/runtime';
import { adaptStage2ReasoningResultToSalesAgent } from '../lib/salesAgent/stage2CompatibilityAdapter';

describe('Stage3 final canonical alignment', () => {
  it('declares SalesAgentRuntime as the canonical future reasoning entry point', () => {
    expect(SALES_AGENT_CANONICAL_AI_PATH).toMatchObject({
      entry_point: 'runSalesAgentRuntime',
      status: 'canonical_future_ai_reasoning_entry_point',
      automatic_execution: false,
      writes_crm: false,
    });
    const workspace = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');
    const panel = readFileSync('src/components/aiNative/SalesAgentResultPanel.tsx', 'utf8');
    expect(workspace).toContain('runSalesAgentRuntime(');
    expect(workspace).not.toContain('.reason(');
    expect(panel).not.toContain('.reason(');
    expect(workspace).toContain('Legacy / 只读建议路径');
    expect(STAGE3_SALES_AGENT_ARCHITECTURE_STATE).toMatchObject({
      current_provider_execution: { provider_kind: 'MOCK', execution_mode: 'MOCK', live_enabled: false },
      product_control: { read_only: true, suggest_only: true, human_controlled: true, automatic_invocation: false, writes_crm: false },
    });
  });

  it('adapts Stage2 suggestions into the canonical evidence-backed result contract', () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const evidenceId = fixture.context.customers[0].evidenceIds[0];
    const result = adaptStage2ReasoningResultToSalesAgent({
      stage2_result: {
        requestId: 'stage2-request',
        output: {
          kind: 'AI_REASONING_OUTPUT',
          version: 'v1',
          suggestions: [{
            suggestionId: 'stage2-suggestion',
            title: 'Legacy suggestion',
            summary: 'Retain as evidence-backed compatibility data.',
            evidence: [{ evidenceId, claim: 'Customer fact supports this suggestion.' }],
            requiresHumanReview: true,
            executable: false,
          }],
        },
        requiresHumanReview: true,
        executable: false,
      },
      context: fixture.context,
      profile: fixture.profile,
      generated_at: '2026-07-11T00:00:00.000Z',
    });
    expect(result).toMatchObject({
      kind: 'AI_SALES_AGENT_REASONING_RESULT',
      requires_human_review: true,
      executable: false,
      writes_crm: false,
      reasoning_metadata: { provider_kind: 'STAGE2_COMPATIBILITY', execution_mode: 'MOCK', profile_id: fixture.profile.identity.id },
    });
    expect(result.opportunities[0].evidence_ids).toEqual([evidenceId]);
  });

  it('adapts a Sales Agent result to the existing HumanReviewContract without a queue', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const runtime = await runSalesAgentRuntime({ request_id: 'review-runtime', objective: 'Assess', context: fixture.context, profile_id: fixture.profile.identity.id, provider: createMockReasoningProvider(), clock: () => '2026-07-11T00:00:00.000Z' });
    expect(adaptSalesAgentResultToHumanReviewContract(runtime, { review_id: 'review-1', created_at: '2026-07-11T00:00:00.000Z' })).toMatchObject({
      resultId: 'review-runtime',
      state: 'pending_human_review',
      writesCRM: false,
      executesAction: false,
    });
  });
});
