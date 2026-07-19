import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { adaptSalesAgentResultToHumanReviewContract } from '../lib/salesAgent/humanReviewCompatibility';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';
import { runSalesAgentRuntime } from '../lib/salesAgent/runtime';
import { adaptStage2ReasoningResultToSalesAgent } from '../lib/salesAgent/stage2CompatibilityAdapter';

describe('Stage3 final canonical alignment', () => {
  it('keeps the production workspace on the single Trusted Host session path', () => {
    const workspace = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');
    expect(workspace).toContain('SalesAgentInteractionWorkspace');
    expect(workspace).toContain('createTrustedHostSalesAgentAdapter');
    expect(workspace).not.toContain('runSalesCopilotWorkflow(');
    expect(workspace).not.toContain('SalesAgentResultPanel');
    expect(workspace).not.toContain('.reason(');
    expect(workspace).not.toContain('Legacy /');
    expect(workspace).not.toContain('createMockReasoningProvider');
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
