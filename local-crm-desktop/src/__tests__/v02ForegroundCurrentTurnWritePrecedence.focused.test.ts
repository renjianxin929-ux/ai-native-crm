/**
 * V0.2 FINAL P1 — current-turn explicit write vs previous-turn reasoning handoff.
 *
 * TEST FIRST. REAL ENTRY: SalesAgentInteractionController.submit
 *
 * Existing product semantic for “写一条跟进 下周一联系” is locked by
 * salesAgentRealWriteIntent: UPDATE_CUSTOMER_REQUEST / update_next_follow_up_time
 * (future schedule), not follow_up.create (occurred record).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import { classifyClosedWriteIntent } from '../lib/salesAgentTools/writeIntent';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const CUSTOMER_B = 'gz-xyz';
const CUSTOMER_B_NAME = '广州XYZ贸易有限公司';
const NEXT_FOLLOW_AT = '2026-07-20T10:00:00+08:00';
const WRITE_UTTERANCE = '写一条跟进 下周一联系';
const ACTION_1 = '下一个工作日再次联系客户，跟进未接电话';
const ACTION_2 = '准备一份实施周期说明或案例材料';
const ACTION_3 = '内部确认可能的实施周期与关键里程碑';
const STALE_HANDOFF = /上一轮建议已经不可用|重新分析当前客户/;

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

function productionLikeSemanticRouter(): (
  instruction: string,
  envelopeId: string,
) => Promise<SemanticIntentResolution> {
  return async (instruction) => {
    const text = instruction.trim();
    const base = {
      filters: {} as Record<string, string>,
      entities: [] as { type: string; value: string }[],
      scope: CUSTOMER_A,
      missing_fields: [] as string[],
      confidence: 0.92,
      clarification_question: null as string | null,
    };
    if (/删/.test(text) && /客户/.test(text)) {
      return { ...base, intent: 'UNSUPPORTED', confidence: 0.4, missing_fields: ['supported_intent'] };
    }
    if (/第一个|第二个|刚才|安排上|建个待办/.test(text)) {
      return { ...base, intent: 'ACTION_FROM_PREVIOUS_RESULT' };
    }
    if (/下一步|咋搞|咋弄/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
    }
    if (/分析一下/.test(text)) {
      return { ...base, intent: 'CUSTOMER_SUMMARY' };
    }
    return {
      ...base,
      intent: 'CLARIFICATION_REQUIRED',
      confidence: 0.3,
      missing_fields: ['intent'],
      clarification_question: '请明确意图。',
    };
  };
}

function hostilePlanner(onInstruction?: (instruction: string) => void) {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    onInstruction?.(instruction);
    if (/写(?:一)?条跟进|跟进/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'follow_up.create',
        clarification_question: '请提供跟进记录的标题以及跟进内容。',
        missing_fields: ['title', 'feedback_notes'],
      });
    }
    if (/待办|任务/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'task.create',
        clarification_question: '请提供下一步待办的具体内容，例如任务标题或跟进事项。',
        missing_fields: ['title'],
      });
    }
    if (/商机金额/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.opportunity_amount.update',
        arguments: { opportunity_amount: 220000 },
      });
    }
    if (/删/.test(instruction) && /客户/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.delete',
        arguments: {},
      });
    }
    if (/分析|咋搞|下一步/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: null,
        clarification_question: '请明确你想调用哪个能力：查看时间线、更新下次跟进、还是创建跟进？',
        missing_fields: ['capability_id'],
      });
    }
    return JSON.stringify({ kind: 'unknown', reason: '模型选择无法识别。' });
  });
}

function nextActionOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    recommended_next_steps: [ACTION_1, ACTION_2, ACTION_3],
    reasoning_summary: '该客户已有互动与跟进安排，下一步应围绕现有事实推进，而不是改 CRM。',
    evidence_refs: ids,
    uncertainty: [],
    requires_human_review: true,
  };
}

function summaryOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    customer_understanding: `${CUSTOMER_A_NAME} 是已选客户，当前有跟进与拜访记录。`,
    recent_changes: '近期有电话跟进。',
    risks: ['实施周期仍待确认'],
    opportunities: ['已有高意向记录'],
    recommended_next_steps: [ACTION_1, ACTION_2],
    evidence_refs: ids,
    uncertainty: [],
    speculative_claims: [],
    requires_human_review: true,
  };
}

function emptyWorkspaceFor(customerId: string, name: string) {
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
    interactions: [],
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
  return { snapshot, context, memory };
}

function sessionFor(
  customerId: string,
  name: string,
  modelCaller?: ReturnType<typeof createFakeTrustedHostTransport>['caller'],
): SalesAgentSession {
  const { snapshot, context, memory } = emptyWorkspaceFor(customerId, name);
  return new SalesAgentSession(customerId, null, () => NOW, {
    snapshot,
    context,
    memory,
    profile_id: 'foreign_trade_geo',
    planning_mode: 'deterministic',
    model_caller: modelCaller,
    loadCustomerSnapshot: async () => ({ next_follow_up_at: NEXT_FOLLOW_AT }),
  });
}

function seedCustomer(
  sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'],
  id: string,
  name: string,
) {
  insertSeededCustomer(sqlite, {
    id,
    name,
    region: '广州',
    industry: '软件',
    customer_grade: 'A',
    stage: 'CONTACTED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-15T10:00:00+08:00',
    next_follow_up_at: NEXT_FOLLOW_AT,
  });
  sqlite.prepare('UPDATE customers SET opportunity_amount = ? WHERE id = ?').run(200000, id);
  sqlite.prepare(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `fu-phone-${id}`, id, '今天电话没接', 'phone', 'no_answer', '今天电话没接',
    'MEDIUM', null, null, null, 1, '2026-07-15T10:00:00+08:00', '2026-07-15T10:00:00+08:00',
  );
}

function counts(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'], customerId = CUSTOMER_A) {
  return {
    customers: (sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(customerId) as { c: number }).c,
    tasks: (sqlite.prepare('SELECT COUNT(*) AS c FROM tasks WHERE customer_id=?').get(customerId) as { c: number }).c,
    followUps: (sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get(customerId) as { c: number }).c,
    nextFollow: (sqlite.prepare('SELECT next_follow_up_at AS t FROM customers WHERE id=?').get(customerId) as { t: string | null }).t,
    amount: (sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(customerId) as { n: number | null }).n,
  };
}

async function controllerFor(opts?: { readonly withCustomerB?: boolean }) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  if (opts?.withCustomerB) seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  __setDbInstanceForTests(fixture.db);

  const fake = createFakeTrustedHostTransport(async call => {
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    if (call.envelope.intent === 'CUSTOMER_SUMMARY') {
      return { kind: 'success', output: summaryOutput(ids) };
    }
    return { kind: 'success', output: nextActionOutput(ids) };
  });

  const plannerCalls: string[] = [];
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: (customerId) => {
      if (customerId === CUSTOMER_B) return sessionFor(CUSTOMER_B, CUSTOMER_B_NAME, fake.caller);
      return sessionFor(CUSTOMER_A, CUSTOMER_A_NAME, fake.caller);
    },
    clock: () => NOW,
    model_planner: hostilePlanner(instruction => plannerCalls.push(instruction)),
    semantic_intent_router: productionLikeSemanticRouter(),
  });
  controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
  return { fixture, controller, plannerCalls, fake };
}

function combinedMessage(turn: {
  state: { agent_message: string | null; resolution_reason: string | null };
}) {
  return `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
}

function expectExistingNextFollowUpWrite(
  turn: Awaited<ReturnType<SalesAgentInteractionController['submit']>>,
  before: ReturnType<typeof counts>,
  sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'],
) {
  const message = combinedMessage(turn);
  expect(message).not.toMatch(STALE_HANDOFF);
  expect(turn.outcome?.kind).not.toBe('reasoning_result');
  expect(turn.outcome?.kind).not.toBe('blocked');
  expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
  expect(turn.state.current_intent).not.toBe('follow_up.create');
  expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(ACTION_1);
  expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(WRITE_UTTERANCE);
  expect(message).not.toMatch(/请提供跟进记录的标题|这次实际发生了什么/);
  if (turn.state.phase === 'proposal') {
    expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
    expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
  } else {
    expect(turn.state.phase).toBe('clarification');
    expect(message).toMatch(/几点|具体.*时间/);
    expect(turn.state.current_intent).toMatch(/UPDATE_CUSTOMER_REQUEST|next_follow_up_time/);
    expect(turn.state.latest_clarification?.pending_write_intent ?? turn.state.current_intent)
      .toMatch(/UPDATE_CUSTOMER_REQUEST|next_follow_up_time/);
  }
  expect(counts(sqlite)).toEqual(before);
}

describe('existing product semantic (source-backed, not guessed)', () => {
  it('写一条跟进 下周一联系 is future schedule UPDATE_CUSTOMER_REQUEST, not follow_up.create', () => {
    const classified = classifyClosedWriteIntent(WRITE_UTTERANCE);
    expect(classified?.intent).toBe('UPDATE_CUSTOMER_REQUEST');
    expect(classified?.tool_id).toBe('update_next_follow_up_time');
    expect(classifyClosedWriteIntent('帮我写一条跟进，下周一联系')?.intent).toBe('UPDATE_CUSTOMER_REQUEST');
  });
});

describe('T1 — current-turn explicit write beats stale/previous reasoning handoff', () => {
  it('写一条跟进 下周一联系 after next-action reasoning enters the existing write path', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      const first = await controller.submit('接下来我该咋搞？');
      expect(first.outcome?.kind).toBe('reasoning_result');
      expect(first.state.last_reasoning_action_context?.suggested_actions).toHaveLength(3);
      const reasoningCallsAfterFirst = reasoningSpy.mock.calls.length;
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);

      const turn = await controller.submit(WRITE_UTTERANCE);
      const message = combinedMessage(turn);
      expect(message).not.toMatch(STALE_HANDOFF);
      expectExistingNextFollowUpWrite(turn, before, fixture.sqlite);
      expect(reasoningSpy.mock.calls.length).toBe(reasoningCallsAfterFirst);
      expect(plannerCalls.length).toBe(plannerBefore);
      expect(turn.state.last_reasoning_action_context?.suggested_actions[0]?.text).toBe(ACTION_1);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T2 — same write semantics when there is no reasoning context', () => {
  it('写一条跟进 下周一联系 without previous reasoning still uses the existing write path', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      expect(controller.getState().last_reasoning_action_context).toBeNull();
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(WRITE_UTTERANCE);
      expectExistingNextFollowUpWrite(turn, before, fixture.sqlite);
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(plannerCalls).toEqual([]);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T3 — genuine recommendation continuation still works', () => {
  it('第二个帮我安排上 still uses last_reasoning_action_context.actions[1]', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      await controller.submit('接下来我该咋搞？');
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('第二个帮我安排上');
      expect(combinedMessage(turn)).not.toMatch(STALE_HANDOFF);
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      expect(String(turn.state.latest_proposal?.proposed_values.title)).toBe(ACTION_2);
      expect(String(turn.state.latest_proposal?.proposed_values.title)).not.toBe('第二个帮我安排上');
      expect(plannerCalls.length).toBe(plannerBefore);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — first ordinal still becomes a task from structured action', () => {
  it('第一个建个待办 uses actions[0], not the user utterance as title', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('接下来我该咋搞？');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('第一个建个待办');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      expect(String(turn.state.latest_proposal?.proposed_values.title)).toBe(ACTION_1);
      expect(String(turn.state.latest_proposal?.proposed_values.title)).not.toBe('第一个建个待办');
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — cross-customer handoff stays fail-closed', () => {
  it('第二个帮我安排上 after switching to Customer B does not reuse Customer A actions', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      await controller.submit('接下来我该咋搞？');
      controller.syncExternalScope(CUSTOMER_B, CUSTOMER_B_NAME);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      const turn = await controller.submit('第二个帮我安排上');
      const message = combinedMessage(turn);
      expect(turn.state.latest_proposal?.customer_id).not.toBe(CUSTOMER_B);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(ACTION_2);
      expect(message).toMatch(/已经不可用|重新分析|不属于/);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('T6 — delete remains highest safety', () => {
  it('这客户没用了，删了吧 is customer.delete with STRONG confirmation and no pre-confirm write', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('接下来我该咋搞？');
      const turn = await controller.submit('这客户没用了，删了吧');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(combinedMessage(turn)).not.toMatch(STALE_HANDOFF);
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(turn.state.latest_proposal?.operation).toBe('delete');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(CUSTOMER_A)).toEqual({ c: 1 });
    } finally {
      fixture.close();
    }
  });
});

describe('T7 — explicit amount update does not regress', () => {
  it('把商机金额改到22万 stays explicit write with zero reasoning model calls', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('把商机金额改到22万');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
      expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(220000);
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T8 — open analysis stays read-only reasoning', () => {
  it('分析一下 is selected-customer reasoning with zero writes', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('分析一下');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.state.latest_proposal).toBeNull();
      expect(plannerCalls.some(item => item === '分析一下')).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T9 — next-action recommendation stays reasoning', () => {
  it('接下来我该咋搞？ stays NEXT_ACTION_PREPARATION, not a write', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('接下来我该咋搞？');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('NEXT_ACTION_PREPARATION');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.state.latest_proposal).toBeNull();
      expect(plannerCalls.some(item => /接下来我该咋搞/.test(item))).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});
