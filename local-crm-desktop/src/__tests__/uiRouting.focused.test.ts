import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { resolveCapabilityRoute } from '../lib/productionAi/capabilityRoutingMatrix';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

const intent = (message: string) => createAgentIntentEnvelope(message, '2026-07-16T00:00:00.000Z');

function fixture() {
  const now = '2026-07-16T00:00:00.000Z';
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT', version: 'v1', snapshot_id: 'ui-1', synthetic: false, persisted: true,
    load_source: 'sqlite_read_only', loaded_at: now, context: { active_profile_id: 'foreign_trade_geo', now },
    customers: [{ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } }],
    tasks: [], work_items: [], collected_leads: [], replay_evidence: [], import_rows: [], capture_events: [], prompt_plans: [], model_invocations: [], eval_summaries: [],
  };
  const context = buildContextSnapshot({
    snapshotId: 'ui-1', capturedAt: now, timeWindow: { from: '2026-07-01T00:00:00.000Z', to: now },
    customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: ['customer-1'] }],
    accounts: [], interactions: [],
  });
  return { snapshot, context, now };
}

describe('ui-routing suite', () => {
  it('portfolio search capability does not require a model', () => {
    expect(resolveCapabilityRoute('PORTFOLIO_SEARCH').requires_real_model).toBe(false);
  });

  it('customer summary / risk / next action / follow-up draft call model when healthy', async () => {
    const { snapshot, context, now } = fixture();
    const intents = [
      { message: '总结这个客户', intent: 'CUSTOMER_SUMMARY' },
      { message: '分析风险和机会', intent: 'CUSTOMER_RISK_ANALYSIS' },
      { message: '准备下一步行动', intent: 'NEXT_ACTION_PREPARATION' },
      { message: '草拟跟进文案', intent: 'FOLLOW_UP_DRAFT' },
    ];
    for (const item of intents) {
      const fake = createFakeTrustedHostTransport(async call => ({
        kind: 'success',
        output: call.envelope.requested_output_schema === 'risk_analysis_v1' ? {
          risk_items: [{ id: 'r1', summary: 'r', severity: 'medium', inference_type: 'crm_fact', evidence_refs: ['customer-1'] }],
          severity: 'medium', reasoning_summary: 'ok', evidence_refs: ['customer-1'], mitigation: [], uncertainty: [], requires_human_review: true,
        } : call.envelope.requested_output_schema === 'next_action_v1' ? {
          recommended_next_steps: ['n'], reasoning_summary: 'ok', evidence_refs: ['customer-1'], uncertainty: [], requires_human_review: true,
        } : call.envelope.requested_output_schema === 'follow_up_draft_v1' ? {
          draft_text: 'draft', tone: 'professional', objective: 'follow', evidence_refs: ['customer-1'], unsupported_assumptions: [], requires_human_review: true,
        } : {
          customer_understanding: 'ok',
          recent_changes: 'ok',
          risks: ['r'],
          opportunities: ['o'],
          recommended_next_steps: ['n'],
          evidence_refs: ['customer-1'],
          uncertainty: [],
          speculative_claims: [],
          requires_human_review: true,
        },
      }));
      const session = new SalesAgentSession('customer-1', null, () => now, {
        snapshot, context, profile_id: 'foreign_trade_geo', planning_mode: 'deterministic',
        model_caller: fake.caller,
      });
      const result = await session.ask(intent(item.message));
      expect(fake.calls.length).toBe(1);
      expect(result.runtime_details.runtime_mode).toBe('REAL_MODEL');
      expect(result.runtime_details.request_id).toBeTruthy();
      expect(result.runtime_details.provider).toBeTruthy();
    }
  });

  it('unconfigured provider does not show mock as AI', async () => {
    const { snapshot, context, now } = fixture();
    const session = new SalesAgentSession('customer-1', null, () => now, {
      snapshot, context, profile_id: 'foreign_trade_geo', planning_mode: 'deterministic',
    });
    const result = await session.ask(intent('总结这个客户'));
    expect(result.runtime_details.runtime_mode).toBe('MODEL_UNAVAILABLE');
    expect(result.runtime_details.ui_label).toBe('模型不可用，未进行 AI 推理');
    expect(result.blocked_message).toMatch(/未生成 AI 分析/);
    expect(result.response).not.toMatch(/is currently graded/);
    expect(result.model).not.toMatch(/Mock reasoning provider/i);
  });

  it('cannot enable mock mode through a runtime profile', async () => {
    const { snapshot, context, now } = fixture();
    const session = new SalesAgentSession('customer-1', null, () => now, {
      snapshot, context, profile_id: 'foreign_trade_geo', planning_mode: 'deterministic',
    });
    const result = await session.ask(intent('总结这个客户'));
    expect(result.runtime_details.runtime_mode).toBe('MODEL_UNAVAILABLE');
    expect(result.runtime_details.ui_label).toBe('模型不可用，未进行 AI 推理');
  });

  it('image capture blocks multimodal when unavailable without fake vision success', async () => {
    const { snapshot, context, now } = fixture();
    const session = new SalesAgentSession('customer-1', null, () => now, {
      snapshot, context, profile_id: 'foreign_trade_geo', planning_mode: 'deterministic',
    });
    await expect(session.capture('image', 'data:image/png;base64,aaa')).rejects.toThrow(/多模态模型未配置/);
  });

  it('write execution never calls model and UI exposes runtime badge wiring', async () => {
    const { snapshot, context, now } = fixture();
    const callModel = vi.fn();
    const session = new SalesAgentSession('customer-1', null, () => now, {
      snapshot, context, profile_id: 'foreign_trade_geo', planning_mode: 'deterministic',
      model_caller: callModel,
      loadCustomerSnapshot: async () => ({ next_follow_up_at: null }),
    });
    await session.submit(intent('创建任务：明天提醒跟进'));
    expect(callModel).not.toHaveBeenCalled();

    const ui = readFileSync(resolve(process.cwd(), 'src/components/aiNative/SalesAgentInteractionWorkspace.tsx'), 'utf8');
    expect(ui).toContain('agent-runtime-mode-badge');
    expect(ui).toContain('agent-runtime-details');
    expect(ui).not.toContain('reasoning_profile');
    expect(ui).toContain('agent-cancel-inflight');
  });

  it('session model lock prevents duplicate in-flight model requests', async () => {
    const { snapshot, context, now } = fixture();
    let release!: () => void;
    const gate = new Promise<void>(resolveGate => { release = resolveGate; });
    const fake = createFakeTrustedHostTransport(async () => {
      await gate;
      return {
        kind: 'success',
        output: {
          customer_understanding: 'ok', recent_changes: 'ok', risks: ['r'], opportunities: ['o'],
          recommended_next_steps: ['n'], evidence_refs: ['customer-lock'], uncertainty: [], requires_human_review: true,
        },
      };
    });
    const lockContext = buildContextSnapshot({
      snapshotId: 'ui-lock',
      capturedAt: now,
      timeWindow: { from: '2026-07-01T00:00:00.000Z', to: now },
      customers: [{ customerId: 'customer-lock', name: 'Lock', grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: ['customer-lock'] }],
      accounts: [],
      interactions: [],
    });
    const lockSnapshot = {
      ...snapshot,
      snapshot_id: 'ui-lock',
      customers: [{ id: 'customer-lock', name: 'Lock', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer' as const, id: 'customer-lock', label: 'Lock', synthetic: false, persisted: true } }],
    };
    const session = new SalesAgentSession('customer-lock', null, () => now, {
      snapshot: lockSnapshot, context: lockContext, profile_id: 'foreign_trade_geo', planning_mode: 'deterministic',
      model_caller: fake.caller,
    });
    const first = session.ask(intent('总结这个客户'));
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(session.ask(intent('请再总结一次客户现状'))).rejects.toThrow(/进行中的模型请求/);
    release();
    await first;
  });
});
