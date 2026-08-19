/**
 * V0.2 FINAL P1 — open-ended reasoning vs capability-selection routing.
 *
 * REAL ENTRY: SalesAgentInteractionController.submit
 * Production-like model planner is injected because Trusted Host is present
 * in the real app; that is what currently intercepts analysis as tool-picking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_ID = 'gz-abc';
const CUSTOMER_NAME = '广州ABC科技有限公司';

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

function productionLikePlanner(onInstruction?: (instruction: string) => void) {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    onInstruction?.(instruction);
    if (/分析一下下一步|下一步怎么做/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: null,
        clarification_question: '请明确你想调用哪个能力：查看时间线、更新下次跟进、还是创建跟进？',
        missing_fields: ['capability_id'],
      });
    }
    if (/生成复盘草稿|复盘/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'battle_card.draft.create',
        clarification_question: '请提供复盘对象、阶段、时间范围和复盘要点。',
        missing_fields: ['stage_code', 'time_range', 'review_points'],
      });
    }
    if (/商机金额/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.opportunity_amount.update',
        arguments: { opportunity_amount: 200000 },
      });
    }
    if (/删除这个客户/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.delete',
        arguments: {},
      });
    }
    return JSON.stringify({ kind: 'unknown', reason: '模型选择无法识别。' });
  });
}

function nextActionOutput(evidenceIds: readonly string[]) {
  return {
    recommended_next_steps: ['本周先确认关键决策人', '按已安排时间完成下次跟进', '用现有拜访记录核对顾虑'],
    reasoning_summary: '该客户已有等级、商机与跟进安排，下一步应围绕现有事实推进，而不是改 CRM。',
    evidence_refs: evidenceIds.slice(0, 2),
    uncertainty: [],
    requires_human_review: true,
  };
}

function reviewOutput(evidenceIds: readonly string[]) {
  return {
    interaction_summary: '本次进展：已有跟进与下次安排。需要注意：决策链仍待确认。下一步：按现有时间跟进。',
    key_points: ['已有跟进记录', '下次跟进已安排', '商机金额已录入'],
    evidence_refs: evidenceIds.slice(0, 2),
    uncertainty: [],
    requires_human_review: true,
  };
}

function sessionFor(
  customerId: string,
  name: string,
  modelCaller?: ReturnType<typeof createFakeTrustedHostTransport>['caller'],
): SalesAgentSession {
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
      summary: '电话跟进：客户仍在内部评估',
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
      summary: 'ACTIVE：关注实施周期',
      source_kind: 'human_decision',
      validation_source: 'human_decision',
      source_reference: 'review:1',
      evidence_reference: `mem-${customerId}`,
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
    model_caller: modelCaller,
    loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-07-20T10:00:00+08:00' }),
  });
}

async function controllerFor(opts?: { readonly model?: boolean; readonly failModel?: boolean }) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  insertSeededCustomer(fixture.sqlite, {
    id: CUSTOMER_ID,
    name: CUSTOMER_NAME,
    region: '广州',
    industry: '软件',
    customer_grade: 'A',
    stage: 'CONTACTED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-10T00:00:00.000Z',
    next_follow_up_at: '2026-07-20T10:00:00+08:00',
  });
  fixture.sqlite.prepare(
    'UPDATE customers SET opportunity_amount = ? WHERE id = ?',
  ).run(200000, CUSTOMER_ID);
  fixture.sqlite.prepare(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'fu-1', CUSTOMER_ID, '电话跟进', 'phone', 'positive', '客户仍在内部评估',
    'HIGH', null, null, '2026-07-20T10:00:00+08:00', 1, '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z',
  );
  __setDbInstanceForTests(fixture.db);

  const fake = createFakeTrustedHostTransport(async call => {
    if (opts?.failModel) {
      return { kind: 'error', status: 401, message: 'unauthorized' };
    }
    const evidenceIds = call.envelope.evidence_map.map(item => item.evidence_id);
    const ids = evidenceIds.length > 0 ? evidenceIds : [CUSTOMER_ID, `ix-${CUSTOMER_ID}`];
    if (call.envelope.intent === 'INTERACTION_SUMMARY') {
      return { kind: 'success', output: reviewOutput(ids) };
    }
    return { kind: 'success', output: nextActionOutput(ids) };
  });

  const session = sessionFor(CUSTOMER_ID, CUSTOMER_NAME, opts?.model === false ? undefined : fake.caller);
  const plannerCalls: string[] = [];
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: () => session,
    clock: () => NOW,
    model_planner: productionLikePlanner(instruction => plannerCalls.push(instruction)),
  });
  controller.syncExternalScope(CUSTOMER_ID, CUSTOMER_NAME);
  return { fixture, controller, session, fake, plannerCalls };
}

describe('T1 — open-ended next-step reasoning', () => {
  it('分析一下下一步怎么做 uses selected-customer reasoning, not capability picking', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller, plannerCalls } = await controllerFor({ model: true });
    try {
      const turn = await controller.submit('分析一下下一步怎么做');
      const message = `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
      expect(message).not.toMatch(/请明确你想调用哪个能力|查看时间线|更新下次跟进|创建跟进/);
      expect(message).not.toMatch(/请先通过附件入口|Analyze image|上传/);
      expect(turn.state.phase).not.toBe('clarification');
      expect(turn.state.latest_proposal).toBeNull();
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.outcome.result.executable).toBe(false);
      expect(reasoningSpy).toHaveBeenCalled();
      const args = reasoningSpy.mock.calls[0]![0];
      expect(args.customer_id).toBe(CUSTOMER_ID);
      expect(args.context.customers.some(item => item.customerId === CUSTOMER_ID)).toBe(true);
      expect(args.callModel).toBeTypeOf('function');
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 1 });
      expect(fixture.sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ n: 200000 });
      expect(plannerCalls.some(item => /分析一下下一步/.test(item))).toBe(false);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T2 — customer review draft uses selected-customer context', () => {
  it('生成复盘草稿 does not ask the user to restate customer/stage/range', async () => {
    const { fixture, controller } = await controllerFor({ model: true });
    try {
      const turn = await controller.submit('生成复盘草稿');
      const message = `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
      expect(message).not.toMatch(/复盘对象|时间范围|复盘要点|请提供.*阶段/);
      expect(turn.state.phase).not.toBe('clarification');
      expect(turn.state.latest_proposal).toBeNull();
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.outcome.result.intent_envelope.intent).toBe('INTERACTION_SUMMARY');
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get()).toEqual({ c: 1 });
    } finally {
      fixture.close();
    }
  });
});

describe('T3 — explicit write must not fall into reasoning', () => {
  it('这个客户商机金额改成20万 still routes to opportunity update confirmation', async () => {
    const { fixture, controller } = await controllerFor({ model: true });
    try {
      const turn = await controller.submit('这个客户商机金额改成20万');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
      expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(200000);
      expect(previewAuthorityForSelection('customer.opportunity_amount.update')).toBe('REQUIRE_CONFIRMATION');
      expect(fixture.sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ n: 200000 });
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — destructive routing must not become reasoning', () => {
  it('删除这个客户 still requires STRONG confirmation and writes nothing', async () => {
    const { fixture, controller } = await controllerFor({ model: true });
    try {
      const turn = await controller.submit('删除这个客户');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(turn.state.latest_proposal?.operation).toBe('delete');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ c: 1 });
    } finally {
      fixture.close();
    }
  });

  it('删掉 stays fail-closed / clarification, never a reasoning answer', async () => {
    const { fixture, controller } = await controllerFor({ model: true });
    try {
      const turn = await controller.submit('删掉');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.latest_proposal).toBeNull();
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ c: 1 });
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — model unavailable stays honest', () => {
  it('open-ended reasoning with unauthorized model does not invent advice or mutate', async () => {
    const { fixture, controller } = await controllerFor({ model: true, failModel: true });
    try {
      const turn = await controller.submit('分析一下下一步怎么做');
      const message = `${turn.state.agent_message ?? ''}\n${turn.outcome && 'result' in turn.outcome ? turn.outcome.result.blocked_message ?? '' : ''}`;
      expect(message).toMatch(/AI 分析暂时不可用|大模型.*不可用|未生成 AI 分析|凭据无效或未授权/);
      expect(message).not.toMatch(/请明确你想调用哪个能力|查看时间线|上传材料|Analyze image/);
      expect(turn.state.latest_proposal).toBeNull();
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind === 'reasoning_result') {
        expect(turn.outcome.result.writes_crm).toBe(false);
        expect(turn.outcome.result.runtime_details.runtime_mode).toBe('MODEL_UNAVAILABLE');
      }
      expect(fixture.sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ n: 200000 });
    } finally {
      fixture.close();
    }
  });
});
