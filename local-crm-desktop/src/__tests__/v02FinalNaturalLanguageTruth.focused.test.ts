/**
 * V0.2 FINAL — Natural Language Truth + Action Handoff Closure.
 *
 * REAL ENTRY: SalesAgentInteractionController.submit
 * Fail-first samples are the exact foreground utterances.
 * Do not inject capability_id as the main proof.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStageCardEngine } from '../lib/battleCard/stageCardEngine';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { projectConfirmationCard } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const CUSTOMER_B = 'gz-xyz';
const CUSTOMER_B_NAME = '广州XYZ贸易有限公司';
const NEXT_FOLLOW_AT = '2026-07-20T10:00:00+08:00';
const VISIT_TITLE = '工厂参观与实施周期沟通';
const VISIT_NOTES = '客户担心实施周期，内部还要评估';
const ACTION_1 = '下一个工作日再次联系客户，跟进未接电话';
const ACTION_2 = '准备一份实施周期说明或案例材料';
const ACTION_3 = '内部确认可能的实施周期与关键里程碑';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const INTERNAL_CONFIRM_LEAK = /W4-4|W3-1|confirmed-write|db\.deleteCustomer|follow_up_records|visit_records|capability_id|executor/i;

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

function hostileCapabilityPlanner(onInstruction?: (instruction: string) => void) {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    onInstruction?.(instruction);
    if (/新建一个广州星河科技客户/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.create',
        arguments: { name: '广州星河科技', contact_person: '张总' },
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
    if (/分析|怎么看|咋弄|见过|聊|作战卡靠谱/.test(instruction)) {
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
    if (/见过几次|都聊了什么|拜访/.test(text)) {
      return { ...base, intent: 'CUSTOMER_TIMELINE_REVIEW', filters: { fact: 'visits' } };
    }
    if (/作战卡/.test(text)) {
      return { ...base, intent: 'BATTLE_CARD_ANALYSIS', filters: { focus: 'battle_card' } };
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
    return { ...base, intent: 'CLARIFICATION_REQUIRED', confidence: 0.3, missing_fields: ['intent'], clarification_question: '请明确意图。' };
  };
}

function nextActionOutput(evidenceIds: readonly string[], steps: readonly string[] = [ACTION_1, ACTION_2, ACTION_3]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    recommended_next_steps: [...steps],
    reasoning_summary: '该客户已有互动与跟进安排，下一步应围绕现有事实推进，而不是改 CRM。',
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
  stage = 'NEW_LEAD',
) {
  insertSeededCustomer(sqlite, {
    id,
    name,
    region: '广州',
    industry: '软件',
    customer_grade: 'A',
    stage,
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
    `visit-${id}`, id, VISIT_TITLE, '2026-07-15T09:00:00+08:00', VISIT_NOTES, '客户担心实施周期',
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
  };
}

async function controllerFor(opts?: {
  readonly failSemantic?: boolean;
  readonly failModel?: boolean;
  readonly withCustomerB?: boolean;
  readonly seedBattleCard?: boolean;
  readonly scoped?: boolean;
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  if (opts?.withCustomerB) seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  if (opts?.seedBattleCard) {
    const engine = createStageCardEngine({ db: fixture.db, clock: () => NOW });
    const draft = await engine.generateStageCardDraft(CUSTOMER_A, 'NEW_LEAD');
    await engine.confirmStageCard(draft.id, 'HUMAN');
  }
  __setDbInstanceForTests(fixture.db);

  const fake = createFakeTrustedHostTransport(async call => {
    if (opts?.failModel) {
      return { kind: 'error', status: 401, message: 'unauthorized' };
    }
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    if (call.envelope.intent === 'CUSTOMER_SUMMARY') {
      return { kind: 'success', output: summaryOutput(ids) };
    }
    return { kind: 'success', output: nextActionOutput(ids) };
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
  if (opts?.scoped !== false) controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
  return { fixture, controller, plannerCalls, semanticCalls, fake };
}

function combinedMessage(turn: { state: { agent_message: string | null; resolution_reason: string | null; latest_direct_answer: { message: string } | null } }) {
  return `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}\n${turn.state.latest_direct_answer?.message ?? ''}`;
}

function visibleConfirmation(proposal: AgentWriteProposal | null) {
  const projection = projectConfirmationCard(proposal!);
  return {
    projection,
    text: [
      projection.title,
      projection.headline,
      ...projection.summary_lines,
      projection.footnote,
      projection.destructive_note,
      projection.confirm_label,
      projection.cancel_label,
    ].filter(Boolean).join('\n'),
  };
}

describe('T1 — OPEN ANALYSIS / 分析一下', () => {
  it('does not claim semantic service is missing when Trusted Host reasoning is available', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller, plannerCalls } = await controllerFor({ failSemantic: true });
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('分析一下');
      const message = combinedMessage(turn);
      expect(message).not.toMatch(/未配置可用的语义识别服务/);
      expect(message).not.toMatch(/请明确你想调用哪个能力|查看时间线|作战卡还是客户资料/);
      expect(turn.state.phase).not.toBe('clarification');
      expect(turn.state.latest_proposal).toBeNull();
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(reasoningSpy).toHaveBeenCalled();
      expect(plannerCalls.some(item => item === '分析一下')).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T2 — FACTUAL VISIT READ', () => {
  it('我之前跟这客户见过几次？都聊了什么？ reads visits before open-ended reasoning', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller, semanticCalls, plannerCalls } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('我之前跟这客户见过几次？都聊了什么？');
      const message = combinedMessage(turn);
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(turn.state.current_intent).toBe('timeline.visit.read');
      expect(turn.state.latest_direct_answer?.presentation).toBe('direct');
      expect(message).toMatch(/1|一条|1 条/);
      expect(message).toMatch(/工厂参观|实施周期/);
      expect(message).not.toMatch(/客户洞察|推进建议|销售建议/);
      expect(turn.state.latest_proposal).toBeNull();
      expect(semanticCalls.some(item => item.includes('我之前跟这客户见过几次'))).toBe(true);
      expect(plannerCalls.some(item => item.includes('见过几次'))).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T3 — BATTLE CARD REVIEW', () => {
  it('这张作战卡靠谱不？帮我看看有没有什么问题。 reviews coherence without writing', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor({ seedBattleCard: true });
    try {
      const before = counts(fixture.sqlite);
      const cardsBefore = (fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customer_stage_cards WHERE customer_id=?').get(CUSTOMER_A) as { c: number }).c;
      const turn = await controller.submit('这张作战卡靠谱不？帮我看看有没有什么问题。');
      const message = combinedMessage(turn);
      expect(turn.state.latest_proposal?.tool_id).not.toBe('generate_stage_card_draft');
      expect(turn.state.current_intent).not.toBe('battle_card.draft.create');
      expect(turn.state.current_intent).toBe('battle_card.current.read');
      expect(message).toMatch(/过时|不一致|重新生成/);
      expect(message).toMatch(/面访|首次触达|阶段/);
      expect(message).not.toMatch(/请提供复盘对象|stage_code|时间范围/);
      expect(turn.state.latest_proposal).toBeNull();
      expect(plannerCalls.some(item => item.includes('作战卡靠谱'))).toBe(false);
      expect(counts(fixture.sqlite)).toEqual(before);
      expect((fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customer_stage_cards WHERE customer_id=?').get(CUSTOMER_A) as { c: number }).c).toBe(cardsBefore);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — SECOND ACTION HANDOFF', () => {
  it('行，第二个帮我安排上。 references action[1] and stays pre-confirm', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      const first = await controller.submit('接下来我该咋搞？');
      expect(first.outcome?.kind).toBe('reasoning_result');
      expect(first.state.last_reasoning_action_context?.suggested_actions).toHaveLength(3);
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('行，第二个帮我安排上。');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      expect(turn.state.latest_proposal?.customer_id).toBe(CUSTOMER_A);
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      const title = String(turn.state.latest_proposal?.proposed_values.title ?? '');
      expect(title).toBe(ACTION_2);
      expect(title).not.toBe('行，第二个帮我安排上。');
      expect(title).not.toBe('第二个帮我安排上。');
      expect(plannerCalls.length).toBe(plannerBefore);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — FIRST ACTION TO TASK', () => {
  it('第一个建个待办。 uses last_reasoning_action_context.actions[0], not the utterance', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('接下来我该咋搞？');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('第一个建个待办。');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      const title = String(turn.state.latest_proposal?.proposed_values.title ?? '');
      expect(title).toBe(ACTION_1);
      expect(title).not.toBe('第一个建个待办。');
      expect(title).not.toBe('第一个建个待办');
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T6 — CUSTOMER CREATE ENTITY EXTRACTION', () => {
  it('新建一个广州星河科技客户 老板张总 extracts company name, not the boss title', async () => {
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const beforeCustomers = (fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;
      const turn = await controller.submit('新建一个广州星河科技客户 老板张总');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_customer');
      expect(turn.state.latest_proposal?.proposed_values.name).toBe('广州星河科技');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe('老板张总');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('张总');
      expect(turn.state.latest_proposal?.proposed_values.region).not.toBe('广州');
      expect((fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c).toBe(beforeCustomers);
    } finally {
      fixture.close();
    }
  });
});

describe('T7 — DELETE SAFETY + PRESENTATION', () => {
  it('这客户没用了，删了吧。 stays STRONG and hides internal confirmation data by default', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('这客户没用了，删了吧。');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(CUSTOMER_A)).toEqual({ c: 1 });
      const { projection, text } = visibleConfirmation(turn.state.latest_proposal);
      expect(projection.strength).toBe('strong');
      expect(projection.title).toMatch(/永久删除客户（不可恢复）/);
      expect(text).toMatch(/客户：广州ABC科技有限公司/);
      expect(text).toMatch(/永久移除/);
      expect(projection.confirm_label).toBe('确认永久删除');
      expect(projection.cancel_label).toBe('取消');
      expect(text).not.toMatch(INTERNAL_CONFIRM_LEAK);
      expect(text).not.toMatch(UUID_RE);
      expect(text).not.toContain(CUSTOMER_A);
      expect(turn.state.latest_proposal?.reason).toMatch(/W4-4/);
    } finally {
      fixture.close();
    }
  });
});

describe('handoff safety — stale previous actions fail closed', () => {
  it('does not reuse Customer A actions after switching to Customer B', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      await controller.submit('接下来我该咋搞？');
      controller.syncExternalScope(CUSTOMER_B, CUSTOMER_B_NAME);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      const turn = await controller.submit('第一个建个待办。');
      const message = combinedMessage(turn);
      expect(turn.state.latest_proposal?.customer_id).not.toBe(CUSTOMER_B);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(ACTION_1);
      expect(message).toMatch(/已经不可用|不属于当前客户|重新分析/);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});
