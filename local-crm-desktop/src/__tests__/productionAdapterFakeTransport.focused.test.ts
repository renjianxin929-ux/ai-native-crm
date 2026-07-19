import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { runProductionReasoningPath } from '../lib/productionAi/productionReasoningPath';
import { createTrustedHostSalesAgentAdapter } from '../lib/salesAgentTools/trustedHostAdapter';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';

function fixture() {
  const now = '2026-07-16T00:00:00.000Z';
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'prod-1',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: now,
    context: { active_profile_id: 'foreign_trade_geo', now },
    customers: [{ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } }],
    tasks: [], work_items: [], collected_leads: [], replay_evidence: [], import_rows: [], capture_events: [], prompt_plans: [], model_invocations: [], eval_summaries: [],
  };
  const context = buildContextSnapshot({
    snapshotId: 'prod-1',
    capturedAt: now,
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: now },
    customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: ['customer-1'] }],
    accounts: [],
    interactions: [],
  });
  return { snapshot, context, now };
}

describe('production-adapter-fake-transport suite', () => {
  it('routes customer summary through Trusted Host adapter + schema/evidence validation', async () => {
    const { snapshot, context, now } = fixture();
    const fake = createFakeTrustedHostTransport(async call => {
      expect(call.headers_created_in_host).toBe(true);
      expect(call.authorization_present_in_request).toBe(false);
      expect(call.envelope.intent).toBe('CUSTOMER_SUMMARY');
      expect(call.envelope.customer_id).toBe('customer-1');
      return {
        kind: 'success',
        output: {
          customer_understanding: 'Ada 保持高意向',
          recent_changes: '近期无重大变化',
          risks: ['跟进节奏需保持'],
          opportunities: ['可推进报价'],
          recommended_next_steps: ['本周确认需求'],
          evidence_refs: ['customer-1'],
          uncertainty: [],
          speculative_claims: [],
          requires_human_review: true,
        },
        latency_ms: 42,
      };
    });

    const host = createTrustedHostSalesAgentAdapter({
      context_snapshot_id: 'prod-1',
      profile_id: 'foreign_trade_geo',
      authorize: async () => ({ authorizationId: 'auth-1', providerKind: 'DEEPSEEK_COMPATIBLE', modelId: 'deepseek-chat' }),
      execute: async () => ({
        state: 'completed' as const,
        providerKind: 'DEEPSEEK_COMPATIBLE' as const,
        modelId: 'deepseek-chat',
        output: {
          customer_understanding: 'Ada 保持高意向',
          recent_changes: '近期无重大变化',
          risks: ['跟进节奏需保持'],
          opportunities: ['可推进报价'],
          recommended_next_steps: ['本周确认需求'],
          evidence_refs: ['customer-1'],
          uncertainty: [],
          speculative_claims: [],
          requires_human_review: true,
        },
        requestId: 'host-req-1',
        latencyMs: 42,
        tokenUsage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
      }),
    });

    const session = new SalesAgentSession('customer-1', host, () => now, {
      snapshot,
      context,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'deterministic',
      model_caller: fake.caller,
    });
    const result = await session.ask(createAgentIntentEnvelope('总结这个客户', '2026-07-16T00:00:00.000Z'));
    expect(fake.calls).toHaveLength(1);
    expect(result.runtime_details.runtime_mode).toBe('REAL_MODEL');
    expect(result.runtime_details.model_called).toBe(true);
    expect(result.runtime_details.ui_label).toBe('已使用真实模型');
    expect(result.runtime_details.validation_status).toBe('passed');
    expect(result.blocked_message).toBeNull();
    expect(result.writes_crm).toBe(false);
  });

  it('maps timeout/401/429/invalid schema/invalid evidence/cancel without writing CRM', async () => {
    const { context } = fixture();
    const cases = [
      { response: { kind: 'timeout' as const }, category: 'timeout' },
      { response: { kind: 'error' as const, status: 401, message: 'unauthorized' }, category: 'unauthorized' },
      { response: { kind: 'error' as const, status: 429, message: 'rate_limited' }, category: 'rate_limited' },
      { response: { kind: 'abort' as const }, category: 'cancelled' },
      { response: { kind: 'success' as const, output: { incomplete: true } }, category: 'invalid_schema' },
      {
        response: {
          kind: 'success' as const,
          output: {
            customer_understanding: 'x',
            recent_changes: 'y',
            risks: ['r'],
            opportunities: ['o'],
            recommended_next_steps: ['n'],
            evidence_refs: ['invented'],
            uncertainty: [],
            speculative_claims: [],
            requires_human_review: true,
          },
        },
        category: 'invalid_evidence',
      },
    ];

    for (const item of cases) {
      const fake = createFakeTrustedHostTransport(async () => item.response);
      const path = await runProductionReasoningPath({
        request_id: `req-${item.category}`,
        intent: 'CUSTOMER_SUMMARY',
        message: '总结客户',
        customer_id: 'customer-1',
        context,
        tool_trace: [{
          tool_id: 'get_customer',
          evidence_refs: ['customer-1'],
          records: [{ name: 'Ada', customer_grade: 'A' }],
          read_only: true,
          writes_crm: false,
        }],
        callModel: fake.caller,
      });
      expect(path.runtime.degraded || path.blocked_message).toBeTruthy();
      expect(path.log.failure_category).toBe(item.category);
      expect(JSON.stringify(path)).not.toMatch(/Bearer|sk-/i);
    }
  });
});
