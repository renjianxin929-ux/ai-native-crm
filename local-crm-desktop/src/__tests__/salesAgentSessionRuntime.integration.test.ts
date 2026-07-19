import { describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { editFact, setFactReview } from '../lib/customerCapture/review';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

const snapshot: LoadedReadOnlyAgentSnapshot = { kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT', version: 'v1', snapshot_id: 'runtime-fixture', synthetic: false, persisted: true, load_source: 'sqlite_read_only', loaded_at: '2026-07-12T00:00:00.000Z', context: { active_profile_id: 'foreign_trade_geo', now: '2026-07-12T00:00:00.000Z' }, customers: [{ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } }], tasks: [], work_items: [], collected_leads: [], replay_evidence: [], import_rows: [], capture_events: [], prompt_plans: [], model_invocations: [], eval_summaries: [] };
const context = buildContextSnapshot({ snapshotId: 'runtime-fixture', capturedAt: '2026-07-12T00:00:00.000Z', timeWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-12T00:00:00.000Z' }, customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: '2026-07-12T00:00:00.000Z', evidenceIds: ['customer-1'] }], accounts: [], interactions: [] });
const memory = buildCustomerMemoryContext({ customer_id: 'customer-1', items: [{ memory_id: 'active-memory-1', customer_id: 'customer-1', kind: 'fact', summary: 'ACTIVE pricing preference', source_kind: 'human_decision', validation_source: 'human_decision', source_reference: 'review:1', evidence_reference: 'customer-1', source_timestamp: '2026-07-11T00:00:00.000Z', recorded_at: '2026-07-11T00:00:00.000Z' }] });

describe('SalesAgentSession production read/runtime and reviewed-capture integration', () => {
  it('executes registered reads, passes ACTIVE memory to runtime, and returns execution-derived trace/evidence', async () => {
    const reason = vi.fn(async () => ({ intent: 'CUSTOMER_SUMMARY', customer_id: 'customer-1', confidence: .9, provider_kind: 'DEEPSEEK_COMPATIBLE', steps: [{ tool_id: 'get_customer', customer_id: 'customer-1', access: 'read', requires_confirmation: false, reason: 'Need the persisted customer.' }, { tool_id: 'get_active_memory', customer_id: 'customer-1', access: 'read', requires_confirmation: false, reason: 'Need validated active memory.' }] }));
    const session = new SalesAgentSession('customer-1', { reason, capture: async () => ({ visual_facts: [] }) }, () => '2026-07-12T00:00:00.000Z', {
      snapshot,
      context,
      memory,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'host',
    });
    const outcome = await session.submit(createAgentIntentEnvelope('Summarize the customer using evidence.', '2026-07-12T00:00:00.000Z'));
    expect(outcome.kind).toBe('reasoning_result');
    if (outcome.kind !== 'reasoning_result') throw new Error('expected reasoning result');
    expect(reason).toHaveBeenCalledTimes(1);
    expect(outcome.result.tool_trace.map(item => item.tool_id)).toEqual(['get_customer', 'get_active_memory']);
    expect(outcome.result.tool_trace[1].records).toEqual([expect.objectContaining({ memory_id: 'active-memory-1', summary: 'ACTIVE pricing preference' })]);
    expect(outcome.result.evidence_refs).toContain('customer-1');
    expect(outcome.result.runtime_details.runtime_mode).toBe('MODEL_UNAVAILABLE');
    expect(outcome.result.runtime_details.ui_label).toBe('模型不可用，未进行 AI 推理');
    expect(outcome.result.tool_trace.every(item => item.records.length > 0)).toBe(true);
  });

  it('keeps capture pending/rejected facts out, sends accepted edited content through explicit reasoning only, and preserves source reference', async () => {
    const reason = vi.fn(async () => ({ intent: 'CUSTOMER_SUMMARY', customer_id: 'customer-1', confidence: .9, provider_kind: 'DEEPSEEK_COMPATIBLE', steps: [{ tool_id: 'get_active_memory', customer_id: 'customer-1', access: 'read', requires_confirmation: false, reason: 'Read bounded memory.' }] }));
    const session = new SalesAgentSession('customer-1', { reason, capture: async () => ({ extracted_facts: [{ fact_id: 'accept', fact_type: 'visible_requirement', content: 'Original accepted content', source_reference: 'image:1', confidence: .8 }, { fact_id: 'reject', fact_type: 'visible_requirement', content: 'Rejected content', source_reference: 'image:2', confidence: .8 }], source_reference: 'selected-image', confidence: .8, evidence_regions: ['image:1', 'image:2'], unsupported_assumptions: [], requires_fact_review: true }) }, () => '2026-07-12T00:00:00.000Z', {
      snapshot,
      context,
      memory,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'host',
    });
    const pending = await session.capture('image', 'data:image/png;base64,AA==');
    expect(reason).not.toHaveBeenCalled();
    const reviewed = editFact(setFactReview(setFactReview(pending, 'accept', 'accepted'), 'reject', 'rejected'), 'accept', 'Edited reviewed content');
    const result = await session.analyzeReviewedFacts(reviewed);
    expect(reason).toHaveBeenCalledTimes(1);
    expect(reason.mock.calls[0][0].message).toContain('Edited reviewed content');
    expect(reason.mock.calls[0][0].message).not.toContain('Rejected content');
    expect(reviewed.facts.find(fact => fact.fact_id === 'accept')).toMatchObject({ reviewed_content: 'Edited reviewed content', source_reference: 'image:1' });
    expect(result.tool_trace[0].tool_id).toBe('get_active_memory');
  });
});
