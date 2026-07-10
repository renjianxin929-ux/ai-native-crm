import { describe, expect, it, vi } from 'vitest';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createMockReasoningProvider, createOpenAICompatibleProviderBoundary } from '../lib/salesAgent/provider';
import { createAgentTriggerBoundary } from '../lib/salesAgent/triggerSeam';
import { runSalesCopilotWorkflow } from '../lib/salesCopilot/workflow';

const clock = () => '2026-07-11T00:00:00.000Z';

describe('Stage4 AI Sales Copilot workflow', () => {
  it.each(STAGE2_EVALUATION_FIXTURES)('runs customer intelligence through SalesAgentRuntime for $profile.identity.id', async fixture => {
    const result = await runSalesCopilotWorkflow({
      kind: 'customer_intelligence', request_id: `ci:${fixture.profile.identity.id}`, context: fixture.context,
      profile_id: fixture.profile.identity.id, provider: createMockReasoningProvider(), clock,
    });
    expect(result).toMatchObject({ kind: 'customer_intelligence', read_only: true, requires_human_review: true, executable: false, writes_crm: false });
    if (result.kind !== 'customer_intelligence') throw new Error('Unexpected result.');
    expect(result.runtime.trace.map(step => step.step)).toEqual(['observe', 'understand', 'reason', 'suggest', 'human_review']);
    expect(result.runtime.profile_id).toBe(fixture.profile.identity.id);
    expect(result.runtime.result.evidence.length).toBeGreaterThan(0);
  });

  it('ranks customer contexts with evidence-backed, human-reviewed priority items', async () => {
    const contexts = STAGE2_EVALUATION_FIXTURES.map(item => item.context);
    const result = await runSalesCopilotWorkflow({ kind: 'sales_priority', request_id: 'priority', contexts, profile_id: 'foreign_trade_geo', provider: createMockReasoningProvider(), clock });
    expect(result.kind).toBe('sales_priority');
    if (result.kind !== 'sales_priority') throw new Error('Unexpected result.');
    expect(result.items).toHaveLength(contexts.length);
    expect(result.items.map(item => item.rank)).toEqual(contexts.map((_, index) => index + 1));
    result.items.forEach(item => {
      expect(item.priority_reason).toMatch(/opportunity signal/);
      expect(item.priority_reason_evidence_ids.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.recommended_next_action.evidence_ids.length).toBeGreaterThan(0);
      expect(item).toMatchObject({ requires_human_review: true, executable: false, writes_crm: false, creates_task: false });
    });
  });

  it('keeps the interaction trigger inert until an explicit reassessment request', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES.find(item => item.context.recentInteractions.length > 0)!;
    const interaction = fixture.context.recentInteractions[0];
    const trigger = createAgentTriggerBoundary({ kind: 'InteractionAddedEvent', event_id: 'event-1', occurred_at: interaction.occurredAt, customer_id: fixture.context.customers[0].customerId, interaction_id: interaction.interactionId });
    expect(trigger).toMatchObject({ status: 'request_created_not_invoked', runtime_request: { runtime_invoked: false }, intent: { automatic_execution: false, background_worker: false } });
    const result = await runSalesCopilotWorkflow({ kind: 'interaction_intelligence', request_id: 'interaction-1', context: fixture.context, trigger, explicitly_activated: true, profile_id: fixture.profile.identity.id, provider: createMockReasoningProvider(), clock });
    expect(result).toMatchObject({ kind: 'interaction_intelligence', activation_mode: 'explicit_manual', requires_human_review: true, executable: false, writes_crm: false, sends_message: false });
  });

  it('preserves Mock-only runtime enforcement and never calls sandbox transport', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const transport = vi.fn();
    const provider = createOpenAICompatibleProviderBoundary({ id: 'blocked', endpoint: 'https://invalid.example', model: 'blocked', transport });
    await expect(runSalesCopilotWorkflow({ kind: 'customer_intelligence', request_id: 'blocked', context: fixture.context, profile_id: fixture.profile.identity.id, provider, clock })).rejects.toThrow('permits MOCK provider execution only');
    expect(transport).not.toHaveBeenCalled();
  });
});
