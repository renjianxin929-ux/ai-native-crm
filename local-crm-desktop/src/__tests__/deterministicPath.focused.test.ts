import { describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { resolveCapabilityRoute } from '../lib/productionAi/capabilityRoutingMatrix';

function fixture() {
  const now = '2026-07-16T00:00:00.000Z';
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'det-1',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: now,
    context: { active_profile_id: 'foreign_trade_geo', now },
    customers: [{ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } }],
    tasks: [],
    work_items: [],
    collected_leads: [],
    replay_evidence: [],
    import_rows: [],
    capture_events: [],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
  const context = buildContextSnapshot({
    snapshotId: 'det-1',
    capturedAt: now,
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: now },
    customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: ['customer-1'] }],
    accounts: [],
    interactions: [],
  });
  return { snapshot, context, now };
}

describe('deterministic-path suite', () => {
  it('timeline review stays local and never calls the model', async () => {
    const { snapshot, context, now } = fixture();
    const callModel = vi.fn();
    const session = new SalesAgentSession('customer-1', null, () => now, {
      snapshot,
      context,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'deterministic',
      reasoning_profile: 'production',
      model_caller: callModel,
    });
    expect(resolveCapabilityRoute('CUSTOMER_TIMELINE_REVIEW').requires_real_model).toBe(false);
    const result = await session.ask(createAgentIntentEnvelope('查看客户时间线', '2026-07-16T00:00:00.000Z'));
    expect(callModel).not.toHaveBeenCalled();
    expect(result.runtime_details.runtime_mode).toBe('LOCAL_DETERMINISTIC');
    expect(result.runtime_details.model_called).toBe(false);
    expect(result.runtime_details.ui_label).toBe('本地规则结果');
    expect(result.writes_crm).toBe(false);
  });

  it('write proposals remain deterministic repository-bound', async () => {
    const { snapshot, context, now } = fixture();
    const callModel = vi.fn();
    const session = new SalesAgentSession('customer-1', null, () => now, {
      snapshot,
      context,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'deterministic',
      reasoning_profile: 'production',
      model_caller: callModel,
      loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-07-20T00:00:00.000Z' }),
    });
    const outcome = await session.submit(createAgentIntentEnvelope('写一条跟进：客户确认下周报价', '2026-07-16T00:00:00.000Z'));
    expect(callModel).not.toHaveBeenCalled();
    expect(outcome.kind === 'write_proposal' || outcome.kind === 'clarification_required').toBe(true);
  });

  it('keeps a follow-up record plus explicit next contact as one grouped write proposal', async () => {
    const { snapshot, context, now } = fixture();
    const callModel = vi.fn();
    const session = new SalesAgentSession('customer-1', null, () => now, {
      snapshot,
      context,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'deterministic',
      reasoning_profile: 'production',
      model_caller: callModel,
      loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-07-20T00:00:00.000Z' }),
    });
    const envelope = createAgentIntentEnvelope('写一条跟进记录：客户确认方案，并约下周一上午10点再联系', now);
    expect(envelope.intent).toBe('CREATE_FOLLOW_UP_REQUEST');
    expect(envelope.clarification_required).toBe(false);
    const outcome = await session.submit(envelope);
    expect(outcome.kind).toBe('write_proposal');
    if (outcome.kind !== 'write_proposal') throw new Error('expected grouped write proposal');
    expect(outcome.proposal.grouped_operations).toHaveLength(2);
    expect(callModel).not.toHaveBeenCalled();
  });
});
