/**
 * V0.2 FINAL — Semantic Intent Routing Closure.
 *
 * REAL ENTRY: SalesAgentInteractionController.submit
 * Do not inject capability_id / reasoning intent as the main proof.
 * Do not call write adapters as the main proof.
 *
 * Production-like: selected customer + hostile 25-tool capability picker
 * (what the model planner currently does with unrecognized utterances)
 * + the existing semantic_intent_router seam.
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
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const CUSTOMER_B = 'gz-xyz';
const CUSTOMER_B_NAME = '广州XYZ贸易有限公司';
const NEXT_FOLLOW_AT = '2026-07-20T10:00:00+08:00';

const ACTION_1 = '下一个工作日再次联系客户，跟进未接电话';
const ACTION_2 = '准备一份实施周期说明或案例材料';
const ACTION_3 = '内部确认可能的实施周期与关键里程碑';
const SCHEDULE_ACTION = '周三再次联系客户';
const VISIT_TITLE = '今天拜访';

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

/**
 * Hostile capability picker: represents the current 25-tool model planner.
 * It is NOT a per-sentence golden map. It intercepts analysis-like language
 * as tool picking — which is the production failure this round must close.
 */
function hostileCapabilityPlanner(onInstruction?: (instruction: string) => void) {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    onInstruction?.(instruction);
    if (/商机金额/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.opportunity_amount.update',
        arguments: { opportunity_amount: 210000 },
      });
    }
    if (/删除这个客户/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.delete',
        arguments: {},
      });
    }
    if (/拜访/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'visit.create',
        arguments: { title: '拜访' },
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
    if (/作战卡/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'battle_card.draft.create',
        clarification_question: '请提供复盘对象、阶段、时间范围和复盘要点。',
        missing_fields: ['stage_code', 'time_range', 'review_points'],
      });
    }
    if (/分析|怎么看|咋弄|找他|聊|捋|进展|看看/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: null,
        clarification_question: '请明确你想调用哪个能力：查看时间线、拜访记录、作战卡还是客户资料？',
        missing_fields: ['capability_id'],
      });
    }
    return JSON.stringify({ kind: 'unknown', reason: '模型选择无法识别。' });
  });
}

/**
 * Test double for the existing Trusted Host semantic classifier.
 * Production uses createSemanticIntentRouter — not this function.
 * It must not execute tools. Tests still prove routing via submit().
 */
function productionLikeSemanticRouter(calls: string[]) {
  return async (instruction: string, envelopeId: string): Promise<SemanticIntentResolution> => {
    calls.push(`${envelopeId}:${instruction}`);
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
    if (/拜访/.test(text) && /看|啥|什么/.test(text)) {
      return { ...base, intent: 'CUSTOMER_TIMELINE_REVIEW', filters: { fact: 'visits' } };
    }
    if (/作战卡/.test(text)) {
      return { ...base, intent: 'BATTLE_CARD_ANALYSIS', filters: { focus: 'battle_card' } };
    }
    if (/待办|记下来|第二个|刚才那个/.test(text)) {
      return { ...base, intent: 'ACTION_FROM_PREVIOUS_RESULT' };
    }
    if (/下一步|咋弄/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
    }
    if (/找他|联系|跟进/.test(text) && /啥时候|什么时候|比较好|周三/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
    }
    if (/聊|进展|捋/.test(text)) {
      return { ...base, intent: 'INTERACTION_SUMMARY' };
    }
    if (/分析|怎么看/.test(text)) {
      return { ...base, intent: 'CUSTOMER_SUMMARY' };
    }
    return { ...base, intent: 'CLARIFICATION_REQUIRED', confidence: 0.3, missing_fields: ['intent'], clarification_question: '请明确意图。' };
  };
}

function nextActionOutput(
  evidenceIds: readonly string[],
  steps: readonly string[] = [ACTION_1, ACTION_2, ACTION_3],
) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    recommended_next_steps: [...steps],
    reasoning_summary: '该客户已有互动与跟进安排，下一步应围绕现有事实推进，而不是改 CRM。',
    evidence_refs: ids,
    uncertainty: [],
    requires_human_review: true,
  };
}

function reviewOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    interaction_summary: `本次进展：${VISIT_TITLE}，客户仍在内部评估。电话跟进过。`,
    key_points: [VISIT_TITLE, '客户仍在内部评估', '下一步：确认实施周期'],
    evidence_refs: ids,
    uncertainty: [],
    requires_human_review: true,
  };
}

function summaryOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    customer_understanding: `${CUSTOMER_A_NAME} 是已选客户，当前有跟进与拜访记录，适合做客户级分析。`,
    recent_changes: '近期有电话跟进与拜访。',
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
  sqlite.prepare(
    `INSERT INTO visit_records (
      id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit,
      visit_outcome, next_action, expected_contract_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `visit-${id}`, id, VISIT_TITLE, '2026-07-15T09:00:00+08:00', VISIT_TITLE, '客户担心实施周期',
    'HIGH', 'POSITIVE', null, null, '2026-07-15T09:00:00+08:00', '2026-07-15T09:00:00+08:00',
  );
}

function counts(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'], customerId = CUSTOMER_A) {
  return {
    customers: (sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(customerId) as { c: number }).c,
    tasks: (sqlite.prepare('SELECT COUNT(*) AS c FROM tasks WHERE customer_id=?').get(customerId) as { c: number }).c,
    followUps: (sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get(customerId) as { c: number }).c,
    visits: (sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records WHERE customer_id=?').get(customerId) as { c: number }).c,
    nextFollow: (sqlite.prepare('SELECT next_follow_up_at AS t FROM customers WHERE id=?').get(customerId) as { t: string | null }).t,
    amount: (sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(customerId) as { n: number }).n,
  };
}

async function controllerFor(opts?: {
  readonly failModel?: boolean;
  readonly failSemantic?: boolean;
  readonly withCustomerB?: boolean;
  readonly nextSteps?: readonly string[];
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  if (opts?.withCustomerB) seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  __setDbInstanceForTests(fixture.db);

  const fake = createFakeTrustedHostTransport(async call => {
    if (opts?.failModel) {
      return { kind: 'error', status: 401, message: 'unauthorized' };
    }
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    if (call.envelope.intent === 'INTERACTION_SUMMARY') {
      return { kind: 'success', output: reviewOutput(ids) };
    }
    if (call.envelope.intent === 'CUSTOMER_SUMMARY') {
      return { kind: 'success', output: summaryOutput(ids) };
    }
    return { kind: 'success', output: nextActionOutput(ids, opts?.nextSteps) };
  });

  const plannerCalls: string[] = [];
  const semanticCalls: string[] = [];
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: (customerId) => {
      if (customerId === CUSTOMER_B) return sessionFor(CUSTOMER_B, CUSTOMER_B_NAME, fake.caller);
      return sessionFor(CUSTOMER_A, CUSTOMER_A_NAME, fake.caller);
    },
    clock: () => NOW,
    model_planner: hostileCapabilityPlanner(instruction => plannerCalls.push(instruction)),
    semantic_intent_router: opts?.failSemantic
      ? async () => { throw new Error('missing_host_provider'); }
      : productionLikeSemanticRouter(semanticCalls),
  });
  controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
  return { fixture, controller, plannerCalls, semanticCalls, fake };
}

function combinedMessage(turn: { state: { agent_message: string | null; resolution_reason: string | null } }) {
  return `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
}

describe('A1 — 分析一下 defaults to selected-customer analysis', () => {
  it('does not ask the user to pick timeline / visit / battle card / profile, and writes nothing', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('分析一下');
      const message = combinedMessage(turn);
      expect(message).not.toMatch(/请明确你想调用哪个能力|作战卡还是客户资料/);
      expect(turn.state.phase).not.toBe('clarification');
      expect(turn.state.latest_proposal).toBeNull();
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.outcome.result.intent_envelope.intent).toMatch(/CUSTOMER_SUMMARY|CUSTOMER_RISK_ANALYSIS|NEXT_ACTION_PREPARATION/);
      expect(reasoningSpy).toHaveBeenCalled();
      expect(reasoningSpy.mock.calls[0]![0].customer_id).toBe(CUSTOMER_A);
      expect(plannerCalls.some(item => item === '分析一下')).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('A2 — 这个客户你怎么看 uses selected customer analysis', () => {
  it('routes to customer analysis / reasoning with zero writes', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('这个客户你怎么看');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.outcome.result.intent_envelope.intent).toMatch(/CUSTOMER_SUMMARY|CUSTOMER_RISK_ANALYSIS|NEXT_ACTION_PREPARATION/);
      expect(turn.state.latest_proposal).toBeNull();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A3 — 我下一步咋弄 is next-action reasoning', () => {
  it('routes to NEXT_ACTION_PREPARATION, not generic clarification, with zero writes', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('我下一步咋弄');
      const message = combinedMessage(turn);
      expect(message).not.toMatch(/请明确你想调用哪个能力|无法高置信度确定请求意图/);
      expect(turn.state.phase).not.toBe('clarification');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('NEXT_ACTION_PREPARATION');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A4 — 啥时候再找他比较好 is follow-up timing advice', () => {
  it('gives timing reasoning and must not update next_follow_up_time', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('啥时候再找他比较好');
      const message = combinedMessage(turn);
      expect(message).not.toMatch(/请明确你想调用哪个能力|无法高置信度确定请求意图/);
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.state.latest_proposal).toBeNull();
      expect(turn.state.latest_proposal?.tool_id).not.toBe('update_next_follow_up_time');
      expect(counts(fixture.sqlite).nextFollow).toBe(before.nextFollow);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A5 — 这个作战卡你帮我看看 is battle-card analysis', () => {
  it('reads current battle card / CRM context, does not write, and does not demand card fields', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('这个作战卡你帮我看看');
      const message = combinedMessage(turn);
      expect(message).not.toMatch(/请提供复盘对象|stage_code|时间范围|复盘要点/);
      expect(turn.state.latest_proposal?.tool_id).not.toBe('generate_stage_card_draft');
      expect(turn.state.current_intent).not.toBe('battle_card.draft.create');
      expect(turn.state.current_intent).not.toBe('battle_card.confirm');
      const analysis = turn.outcome?.kind === 'reasoning_result';
      const factualCard = turn.state.current_intent === 'battle_card.current.read'
        || turn.state.current_intent === 'battle_card.context.read'
        || (turn.state.latest_direct_answer?.headline ?? '').includes('作战卡');
      expect(analysis || factualCard).toBe(true);
      if (turn.outcome?.kind === 'reasoning_result') {
        expect(turn.outcome.result.writes_crm).toBe(false);
      }
      expect(plannerCalls.some(item => item === '这个作战卡你帮我看看')).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A6 — 最近跟他聊得怎么样 uses timeline', () => {
  it('summarizes the current customer timeline and writes nothing', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('最近跟他聊得怎么样');
      expect(turn.state.phase).not.toBe('clarification');
      expect(turn.state.latest_proposal).toBeNull();
      const reasoning = turn.outcome?.kind === 'reasoning_result';
      const factual = turn.state.current_intent === 'timeline.customer.read'
        || turn.state.current_intent === 'CUSTOMER_TIMELINE_REVIEW';
      expect(reasoning || factual).toBe(true);
      if (turn.outcome?.kind === 'reasoning_result') {
        expect(turn.outcome.result.intent_envelope.intent).toMatch(/INTERACTION_SUMMARY|CUSTOMER_TIMELINE_REVIEW|CUSTOMER_SUMMARY/);
        expect(turn.outcome.result.writes_crm).toBe(false);
      }
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A7 — 帮我捋一下最近进展 is interaction summary', () => {
  it('uses INTERACTION_SUMMARY / review when timeline exists, not generic profile analysis', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('帮我捋一下最近进展');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('INTERACTION_SUMMARY');
      expect(turn.outcome.result.intent_envelope.intent).not.toBe('CUSTOMER_SUMMARY');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A8 — 根据刚才那个弄个待办 hands off structured previous result', () => {
  it('proposes task.create from structured reasoning actions, confirmation required, zero pre-confirm writes', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      const first = await controller.submit('分析一下下一步怎么做');
      expect(first.outcome?.kind).toBe('reasoning_result');
      expect(first.state.last_reasoning_action_context?.suggested_actions.length).toBeGreaterThan(0);
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('根据刚才那个弄个待办');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      const title = String(turn.state.latest_proposal?.proposed_values.title ?? '');
      expect(title).toMatch(/实施周期|再次联系|未接电话/);
      expect(title).not.toBe('根据刚才那个弄个待办');
      expect(plannerCalls.length).toBe(plannerBefore);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A9 — 第二个给我记下来 references the second structured action', () => {
  it('creates a proposal from suggestion #2 only, never a hallucinated action, confirmation required', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('分析一下下一步怎么做');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('第二个给我记下来');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      const title = String(turn.state.latest_proposal?.proposed_values.title ?? '');
      expect(title).toContain(ACTION_2);
      expect(title).not.toContain(ACTION_1);
      expect(title).not.toContain(ACTION_3);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('A10 — 那就周三再找他 is future follow-up handoff', () => {
  it('routes to next_follow_up_time.update, not follow_up.create, and writes nothing pre-confirm', async () => {
    const { fixture, controller } = await controllerFor({
      nextSteps: [SCHEDULE_ACTION, ACTION_2, ACTION_3],
    });
    try {
      await controller.submit('分析一下下一步怎么做');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('那就周三再找他');
      const message = combinedMessage(turn);
      expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
      expect(turn.state.current_intent).not.toBe('follow_up.create');
      if (turn.state.phase === 'proposal') {
        expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
      } else {
        expect(turn.state.phase).toBe('clarification');
        expect(message).toMatch(/几点|具体.*时间|日期和时间/);
        expect(String(turn.state.current_intent)).toMatch(/next_follow_up|UPDATE_CUSTOMER/);
      }
      expect(counts(fixture.sqlite).followUps).toBe(before.followUps);
      expect(counts(fixture.sqlite).nextFollow).toBe(before.nextFollow);
    } finally {
      fixture.close();
    }
  });
});

describe('A11 — 看看之前都拜访了啥 is factual visit read', () => {
  it('reads visits factually, is not open-ended reasoning, and is not visit.create', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('看看之前都拜访了啥');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.latest_proposal?.tool_id).not.toBe('create_visit_record');
      expect(turn.state.current_intent).not.toBe('visit.create');
      expect(turn.state.current_intent).toBe('timeline.visit.read');
      expect(turn.state.latest_direct_answer?.presentation).toBe('direct');
      expect(combinedMessage(turn)).toMatch(/拜访/);
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(counts(fixture.sqlite).visits).toBe(before.visits);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('A12 — 把这客户删了 remains STRONG confirmation', () => {
  it('routes to customer.delete, requires strong confirmation, and does not delete before confirm', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('把这客户删了');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
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

describe('previous-result safety — customer switch fail-closed', () => {
  it('does not apply Customer A reasoning actions after switching to Customer B', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      await controller.submit('分析一下下一步怎么做');
      controller.syncExternalScope(CUSTOMER_B, CUSTOMER_B_NAME);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      const turn = await controller.submit('根据刚才那个弄个待办');
      const message = combinedMessage(turn);
      expect(turn.state.latest_proposal?.customer_id).not.toBe(CUSTOMER_B);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toContain(ACTION_2);
      expect(message).toMatch(/广州ABC|当前客户|重新分析|不属于/);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('model unavailable — honest failure, zero mutations', () => {
  it('open-ended analysis says AI is unavailable and does not invent a summary or CRM action', async () => {
    const { fixture, controller } = await controllerFor({ failModel: true, failSemantic: true });
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('分析一下');
      const message = combinedMessage(turn);
      expect(message).toMatch(/AI 分析暂时不可用|大模型.*不可用|未生成 AI 分析|语义识别服务|凭据无效或未授权/);
      expect(message).not.toMatch(/请明确你想调用哪个能力/);
      expect(turn.state.latest_proposal).toBeNull();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });

  it('explicit delete remains protected when the semantic model is unavailable', async () => {
    const { fixture, controller } = await controllerFor({ failSemantic: true });
    try {
      const turn = await controller.submit('删除这个客户');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(CUSTOMER_A)).toEqual({ c: 1 });
    } finally {
      fixture.close();
    }
  });
});
