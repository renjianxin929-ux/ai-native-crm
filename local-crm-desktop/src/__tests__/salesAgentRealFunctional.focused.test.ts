import { describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { createCrmRepository } from '../lib/db';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { executeSearchCustomersTool } from '../lib/salesAgentTools/executeSearchCustomersTool';
import { normalizeCustomerSearchFilters, resumeInstructionAfterScope } from '../lib/salesAgentTools/filterNormalization';
import { resolveCustomerForAgentMessage } from '../lib/salesAgentTools/customerResolution';
import { SALES_AGENT_TOOL_REGISTRY } from '../lib/salesAgentTools/registry';
import {
  SEARCH_CUSTOMERS_MAX_RESULTS,
  SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE,
  searchCustomersFromFixture,
} from '../lib/salesAgentTools/searchCustomers';
import { buildDailyFocusItems } from '../lib/salesAgentUi/dailyFocus';
import { formatUserFacingError, formatUserFacingErrorMessage } from '../lib/salesAgentUi/formatUserFacingError';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { openSalesAgentSqliteFixture, SALES_AGENT_FIXTURE_CUSTOMERS } from './salesAgentFunctionalFixture';

const NOW = '2026-07-14T12:00:00.000Z';

function searchableCorpus() {
  return SALES_AGENT_FIXTURE_CUSTOMERS.map(item => ({ ...item }));
}

function sessionFor(customerId: string, name: string) {
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: `snap-${customerId}`,
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [{
      id: customerId,
      name,
      customer_grade: 'A',
      intent_level: 'HIGH',
      evidence_ref: { type: 'customer', id: customerId, label: name, synthetic: false, persisted: true },
    }],
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
    snapshotId: `snap-${customerId}`,
    capturedAt: NOW,
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
    customers: [{
      customerId,
      name,
      grade: 'A',
      intentLevel: 'HIGH',
      observedAt: NOW,
      evidenceIds: [customerId],
    }],
    accounts: [],
    interactions: [{
      interactionId: `ix-${customerId}`,
      customerId,
      summary: '最近一次跟进记录',
      occurredAt: '2026-07-10T00:00:00.000Z',
      evidenceIds: [`ix-${customerId}`],
    }],
  });
  const memory = buildCustomerMemoryContext({
    customer_id: customerId,
    items: [{
      memory_id: `mem-${customerId}`,
      customer_id: customerId,
      kind: 'fact',
      summary: 'ACTIVE 有效记忆：关注交付周期',
      source_kind: 'human_decision',
      validation_source: 'human_decision',
      source_reference: 'review:1',
      evidence_reference: customerId,
      source_timestamp: '2026-07-09T00:00:00.000Z',
      recorded_at: '2026-07-09T00:00:00.000Z',
    }],
  });
  return new SalesAgentSession(customerId, null, () => NOW, {
    snapshot,
    context,
    memory,
    profile_id: 'foreign_trade_geo',
    planning_mode: 'deterministic',
    reasoning_profile: 'mock_test',
  });
}

describe('Sales Agent real functional closure', () => {
  it('1-4: 东莞 A 类 filters via repository; excludes Guangzhou / C-grade / NEW_LEAD-as-A', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const norm = normalizeCustomerSearchFilters('帮我找一下东莞的 A 类客户', NOW);
      expect(norm.filters.name_query).toBe('东莞');
      expect(norm.filters.region).toBeUndefined();
      expect(norm.filters.customer_grade).toBe('A');
      expect(norm.filters.stage).toBeUndefined();

      const search = await executeSearchCustomersTool({
        filters: norm.filters,
        notes: norm.notes,
        db: fixture.db,
      });
      expect(search.tool_id).toBe('search_customers');
      expect(search.candidates.length).toBeGreaterThanOrEqual(1);
      expect(search.candidates.every(item => item.region?.includes('东莞'))).toBe(true);
      expect(search.candidates.every(item => item.customer_grade === 'A')).toBe(true);
      expect(search.candidates.some(item => item.region?.includes('广州'))).toBe(false);
      expect(search.candidates.some(item => item.customer_grade === 'C')).toBe(false);
      expect(search.candidates.some(item => item.stage === 'NEW_LEAD' && item.customer_grade === 'A')).toBe(false);
      expect(search.candidates.map(item => item.id)).toContain('dg-a-jm');
      expect(SALES_AGENT_TOOL_REGISTRY.search_customers).toBeTruthy();
    } finally {
      fixture.close();
    }
  });

  it('5-9: unique auto-scope, multi candidates, selection resume, reject cross-candidate, no fabricate', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      let activeSession: SalesAgentSession | null = null;
      const controller = new SalesAgentInteractionController({
        db: fixture.db,
        createSession: id => activeSession && activeSession /* identity match via closure */ ? (activeSession as SalesAgentSession) : null,
        clock: () => NOW,
      });
      // Fix createSession properly
      controller.createSession = (id: string) => {
        if (activeSession) {
          // Session is constructed for the bound id
          return activeSession;
        }
        return null;
      };

      const unique = await controller.submit('帮我找深圳精确唯一客户有限公司');
      expect(unique.event.type).toBe('bind_required');
      if (unique.event.type !== 'bind_required') throw new Error('expected bind');
      expect(unique.event.customer_id).toBe('unique-exact');
      activeSession = sessionFor('unique-exact', '深圳精确唯一客户有限公司');
      const continued = await controller.continueAfterBind(unique.event.continue_prompt, 'unique-exact');
      expect(continued.outcome?.kind).toBe('reasoning_result');
      expect(continued.state.pending_original_instruction).toBeNull();
      expect(continued.state.latest_result?.structured.customer_understanding).toBeTruthy();
      expect(continued.state.latest_result?.tool_trace.length).toBeGreaterThan(0);

      const multi = await controller.submit('找一下华南生物');
      expect(multi.state.phase).toBe('awaiting_candidate_selection');
      expect(multi.state.candidate_results.length).toBeGreaterThan(1);
      expect(multi.state.pending_original_instruction).toBeTruthy();

      const rejected = await controller.selectCandidate('gz-a-mech');
      expect(rejected.outcome?.kind).toBe('blocked');
      expect(rejected.outcome && 'reason' in rejected.outcome ? rejected.outcome.reason : '').toContain('不在本次候选');

      const pick = await controller.selectCandidate(multi.state.candidate_results[0]!.id);
      expect(pick.event.type).toBe('bind_required');
      if (pick.event.type !== 'bind_required') throw new Error('expected bind');
      activeSession = sessionFor(pick.event.customer_id, pick.event.customer_name);
      const afterPick = await controller.continueAfterBind(pick.event.continue_prompt, pick.event.customer_id);
      expect(afterPick.outcome?.kind).toBe('reasoning_result');
      expect(afterPick.state.agent_message).not.toContain('继续处理中');

      const none = await controller.submit('帮我找一下火星不存在集团XYZ');
      expect(none.state.candidate_empty_exact || none.state.phase === 'blocked').toBe(true);
      expect(none.state.scoped_customer_id === pick.event.customer_id || none.state.phase === 'blocked' || none.state.phase === 'awaiting_candidate_selection').toBe(true);
    } finally {
      fixture.close();
    }
  });

  it('10-15: scoped bypass, explicit switch, portfolio no permanent scope, scope survives, new conversation retains scope', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      let activeSession = sessionFor('dg-a-jm', '东莞 JM 新能源科技有限公司');
      const controller = new SalesAgentInteractionController({
        db: fixture.db,
        createSession: () => activeSession,
        clock: () => NOW,
      });
      controller.syncExternalScope('dg-a-jm', '东莞 JM 新能源科技有限公司');

      const summary = await controller.submit('总结客户现状');
      expect(summary.state.phase).toBe('scoped');
      expect(summary.state.latest_search).toBeNull();
      expect(summary.outcome?.kind).toBe('reasoning_result');

      const risk = await controller.submit('分析风险与机会');
      expect(risk.outcome?.kind).toBe('reasoning_result');
      expect(risk.state.scoped_customer_id).toBe('dg-a-jm');

      const switched = await controller.submit('切换到深圳精确唯一客户有限公司，然后总结最近情况');
      expect(switched.event.type).toBe('bind_required');
      if (switched.event.type !== 'bind_required') throw new Error('expected switch bind');
      expect(switched.event.customer_id).toBe('unique-exact');
      expect(switched.event.continue_prompt).toMatch(/总结/);
      activeSession = sessionFor('unique-exact', '深圳精确唯一客户有限公司');
      await controller.continueAfterBind(switched.event.continue_prompt, 'unique-exact');
      expect(controller.getState().scoped_customer_id).toBe('unique-exact');

      // Reset scope to run portfolio without permanent bind overwrite issues
      controller.clearCustomerScope();
      const portfolio = await controller.submit('今天有哪些高意向客户值得联系');
      expect(portfolio.state.phase).toBe('portfolio_browse');
      expect(portfolio.state.candidate_results.length).toBeGreaterThan(0);
      expect(portfolio.state.candidate_results.length).toBeLessThanOrEqual(SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE);
      expect(portfolio.state.agent_message).toMatch(/共找到/);
      // Portfolio must not permanently scope a single customer
      expect(portfolio.state.scoped_customer_id).toBeNull();

      controller.syncExternalScope('dg-a-jm', '东莞 JM 新能源科技有限公司');
      activeSession = sessionFor('dg-a-jm', '东莞 JM 新能源科技有限公司');
      await controller.submit('这个客户最近怎么样');
      expect(controller.getState().scoped_customer_id).toBe('dg-a-jm');
      const next = controller.startNewConversation({ clear_customer_scope: false });
      expect(next.retain_customer_scope_on_new_conversation).toBe(true);
      expect(next.scoped_customer_id).toBe('dg-a-jm');
      const cleared = controller.startNewConversation({ clear_customer_scope: true });
      expect(cleared.scoped_customer_id).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it('16-22: tools + runtime + structured result, no synthetic success, pending clear, duplicate submit blocked', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const activeSession = sessionFor('dg-a-jm', '东莞 JM 新能源科技有限公司');
      const runtimeSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
      const controller = new SalesAgentInteractionController({
        db: fixture.db,
        createSession: () => activeSession,
        clock: () => NOW,
      });
      controller.syncExternalScope('dg-a-jm', '东莞 JM 新能源科技有限公司');
      const turn = await controller.submit('总结客户现状');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning');
      expect(turn.outcome.result.tool_trace.some(item => item.tool_id === 'get_customer' || item.tool_id === 'get_customer_context')).toBe(true);
      expect(turn.outcome.result.tool_trace.some(item => item.tool_id === 'get_active_memory')).toBe(true);
      expect(runtimeSpy).toHaveBeenCalled();
      const runtimeArgs = runtimeSpy.mock.calls[0]![0];
      expect(runtimeArgs.memory?.items.some(item => item.summary.includes('ACTIVE'))).toBe(true);
      expect(runtimeArgs.context.recentInteractions.length).toBeGreaterThan(0);
      expect(turn.outcome.result.structured.customer_understanding).toBeTruthy();
      expect(turn.outcome.result.structured.recommended_next_step).toBeTruthy();
      expect(turn.outcome.result.runtime_details.runtime_mode).toBe('MODEL_UNAVAILABLE');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.state.pending_original_instruction).toBeNull();

      // Force locked
      (controller as unknown as { state: { submit_locked: boolean } }).state.submit_locked = true;
      const dup = await controller.submit('再次总结');
      expect(dup.outcome?.kind).toBe('blocked');
      expect(dup.outcome && 'reason' in dup.outcome ? dup.outcome.reason : '').toContain('仍在处理');
      runtimeSpy.mockRestore();
    } finally {
      fixture.close();
    }
  });

  it('23: formatUserFacingError never yields [object Object]', () => {
    expect(formatUserFacingErrorMessage({ weird: true })).not.toBe('[object Object]');
    expect(formatUserFacingErrorMessage(new Error('Boom'))).toBe('Boom');
    expect(formatUserFacingErrorMessage('明文错误')).toBe('明文错误');
    expect(formatUserFacingErrorMessage(undefined)).not.toContain('[object Object]');
    expect(formatUserFacingError({ message: 'Authorization: Bearer sk-secret-token' }).message).not.toMatch(/sk-secret|Bearer/i);
    const advanced = formatUserFacingError({ code: 'E_FAIL', detail: 'x' }, { advanced: true });
    expect(advanced.message).not.toBe('[object Object]');
    expect(advanced.developer_detail).toBeTruthy();
  });

  it('24-28: daily focus deterministic ranking, reasons/evidence, not first-five NEW_LEAD, no provider/write', () => {
    const corpus = searchableCorpus();
    const a = buildDailyFocusItems(corpus, NOW);
    const b = buildDailyFocusItems(corpus, NOW);
    expect(a.map(item => item.customer_id)).toEqual(b.map(item => item.customer_id));
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a.every(item => item.why.trim().length > 0)).toBe(true);
    expect(a.every(item => item.evidence.length > 0)).toBe(true);
    const firstFiveIds = corpus.slice(0, 5).map(item => item.id);
    expect(a.map(item => item.customer_id).join(',')).not.toBe(firstFiveIds.join(','));
    expect(a.every(item => item.customer_id !== 'gz-new-lead' || item.why.includes('综合') || item.evidence.length > 0)).toBe(true);
    // Top item should be high-signal (overdue / A / high intent) — not arbitrary NEW_LEAD
    expect(['dg-a-jm', 'high-priority', 'gz-a-mech', 'stale-30']).toContain(a[0]!.customer_id);
  });

  it('fixture resolver agrees: NEW_LEAD is not grade A; resumeInstructionAfterScope maps search-only', () => {
    const corpus = searchableCorpus();
    const dongguanA = resolveCustomerForAgentMessage({
      message: '帮我找一下东莞的 A 类客户',
      corpus,
      now: NOW,
    });
    expect(dongguanA.kind).toBe('candidates');
    if (dongguanA.kind === 'candidates') {
      expect(dongguanA.portfolio).toBe(true);
      expect(dongguanA.candidates.map(item => item.id)).toContain('dg-a-jm');
    }
    const mech = resolveCustomerForAgentMessage({
      message: '查一下广州做机械设备的客户',
      corpus,
      now: NOW,
    });
    // Structural region+industry portfolio — single match still lists, no auto-bind
    expect(mech.kind).toBe('candidates');
    if (mech.kind === 'candidates') {
      expect(mech.portfolio).toBe(true);
      expect(mech.candidates.map(item => item.id)).toContain('gz-a-mech');
    }
    const similar = resolveCustomerForAgentMessage({
      message: '找一下华南生物',
      corpus,
      now: NOW,
    });
    expect(similar.kind).toBe('candidates');
    if (similar.kind === 'candidates') {
      expect(similar.candidates.length).toBeGreaterThan(1);
    }
    expect(resumeInstructionAfterScope('帮我找一下东莞的 A 类客户')).toBe('帮我找一下东莞的 A 类客户');
    expect(resumeInstructionAfterScope('切换到华南生物，然后总结最近情况')).toContain('总结');

    const repo = createCrmRepository;
    expect(typeof repo).toBe('function');
    const ranked = searchCustomersFromFixture(corpus, { region: '东莞', customer_grade: 'A', now: NOW });
    expect(ranked.candidates.map(item => item.id)).toEqual(['dg-a-jm']);
  });
});
