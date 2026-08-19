/**
 * V0.2 FINAL P0-A — Genuine Previous-result Reference Gate.
 *
 * TEST FIRST. REAL ENTRY: SalesAgentInteractionController.submit
 * Handoff may fire only when the user points at a previous structured result,
 * never because the current sentence mentions a weekday + 联系/安排.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import {
  classifyReasoningActionContinuation,
  isGenuinePreviousResultReference,
} from '../lib/planner/reasoningActionHandoff';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const CUSTOMER_B = 'gz-xyz';
const CUSTOMER_B_NAME = '广州XYZ贸易有限公司';
const NEXT_FOLLOW_AT = '2026-07-20T10:00:00+08:00';
const ADVICE = '我周一联系他合适吗';
const WRITE_UTTERANCE = '写一条跟进 下周一联系';
const DELETE_UTTERANCE = '这个客户没用了，删了吧';
const SECOND_ARRANGE = '第二个帮我安排上';
const ACTION_PREP = '准备实施周期说明材料';
const ACTION_SCHEDULE = '周三再次联系客户确认实施周期';
const ACTION_INTERNAL = '内部确认可能的实施周期与关键里程碑';
const HANDOFF_BLOCK = /当前没有可执行的上一步建议|上一轮建议已经不可用|请重新分析当前客户/;
const ADVICE_QUESTIONS = [
  '我周一联系他合适吗',
  '下周联系是不是有点早',
  '明天给他打电话怎么样',
  '什么时候再联系比较好',
  '周三再找他行不行',
] as const;

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
    if (/第[一二三四五六七八九十1-9]|刚才|按你|上一条|按上面|把那个记下来|按这个来/.test(text)) {
      return { ...base, intent: 'ACTION_FROM_PREVIOUS_RESULT' };
    }
    if (/合适吗|怎么样|是不是|行不行|比较好|什么时候|啥时候/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
    }
    if (/下一步|咋搞|咋弄/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
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
    if (/删/.test(instruction) && /客户/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.delete',
        arguments: {},
      });
    }
    if (/分析|咋搞|下一步|合适|联系|安排/.test(instruction)) {
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

function nextActionOutput(evidenceIds: readonly string[], steps: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    recommended_next_steps: [...steps],
    reasoning_summary: '该客户已有互动与跟进安排，下一步应围绕现有事实推进，而不是改 CRM。',
    evidence_refs: ids,
    uncertainty: [],
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
  };
}

async function controllerFor(opts?: {
  readonly withCustomerB?: boolean;
  readonly steps?: readonly string[];
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  if (opts?.withCustomerB) seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  __setDbInstanceForTests(fixture.db);
  const steps = opts?.steps ?? [ACTION_PREP, ACTION_SCHEDULE, ACTION_INTERNAL];

  const fake = createFakeTrustedHostTransport(async call => {
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    return { kind: 'success', output: nextActionOutput(ids, steps) };
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

function isHandoffBlock(turn: {
  state: { agent_message: string | null; resolution_reason: string | null };
}) {
  return HANDOFF_BLOCK.test(combinedMessage(turn));
}

describe('T1 — Fresh Session + Advice Question', () => {
  it('我周一联系他合适吗 is current-turn reasoning, not a missing previous-result handoff', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller } = await controllerFor();
    try {
      controller.startNewConversation();
      expect(controller.getState().scoped_customer_id).toBe(CUSTOMER_A);
      expect(controller.getState().last_reasoning_action_context).toBeNull();
      const classified = classifyReasoningActionContinuation(ADVICE);
      const genuine = isGenuinePreviousResultReference(ADVICE);
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(ADVICE);
      const message = combinedMessage(turn);
      // Fail-first evidence for the foreground sentence.
      // eslint-disable-next-line no-console
      console.log([
        'INPUT=我周一联系他合适吗',
        `ACTUAL_CLASSIFIER=${classified ? classified.kind : 'null'}`,
        `ACTUAL_GENUINE_REFERENCE=${genuine}`,
        `ACTUAL_HANDOFF=${isHandoffBlock(turn)}`,
        `ACTUAL_MESSAGE=${message.replace(/\n/g, ' | ')}`,
        'EXPECTED_HANDOFF=false',
      ].join('\n'));
      expect(genuine).toBe(false);
      expect(isHandoffBlock(turn)).toBe(false);
      expect(message).not.toMatch(HANDOFF_BLOCK);
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('NEXT_ACTION_PREPARATION');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.state.latest_proposal).toBeNull();
      expect(reasoningSpy).toHaveBeenCalled();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T2 — Stale Context + Advice Question', () => {
  it('does not let Customer B reasoning block an advice question on Customer A', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      controller.syncExternalScope(CUSTOMER_B, CUSTOMER_B_NAME);
      const first = await controller.submit('接下来我该咋搞？');
      expect(first.state.last_reasoning_action_context?.customer_id).toBe(CUSTOMER_B);
      controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
      expect(controller.getState().last_reasoning_action_context?.customer_id).toBe(CUSTOMER_B);
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(ADVICE);
      expect(isHandoffBlock(turn)).toBe(false);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expect(turn.outcome?.kind).toBe('reasoning_result');
      expect(turn.state.latest_proposal).toBeNull();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T3 — Valid Ordinal Previous-result Reference', () => {
  it('第二个帮我安排上 uses structured action[1], not chat prose', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor({
      steps: [ACTION_PREP, ACTION_SCHEDULE, ACTION_INTERNAL],
    });
    try {
      await controller.submit('接下来我该咋搞？');
      const actions = controller.getState().last_reasoning_action_context?.suggested_actions ?? [];
      expect(actions[1]?.text).toBe(ACTION_SCHEDULE);
      expect(actions[1]?.optional_action_type_hint).toBe('schedule');
      expect(isGenuinePreviousResultReference(SECOND_ARRANGE)).toBe(true);
      const classified = classifyReasoningActionContinuation(SECOND_ARRANGE);
      expect(classified).toEqual({ kind: 'execute_ordinal', ordinal: 2 });
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(SECOND_ARRANGE);
      expect(isGenuinePreviousResultReference(SECOND_ARRANGE)).toBe(true);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(SECOND_ARRANGE);
      expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
      if (turn.state.phase === 'proposal') {
        expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
      } else {
        expect(turn.state.phase).toBe('clarification');
        expect(combinedMessage(turn)).toMatch(/几点|具体.*时间|日期和时间/);
        expect(String(turn.state.current_intent)).toMatch(/next_follow_up|UPDATE_CUSTOMER/);
      }
      expect(plannerCalls.length).toBe(plannerBefore);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — Reference Without Context', () => {
  it('第二个帮我安排上 fail-closes when there is no previous structured result', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      controller.startNewConversation();
      expect(controller.getState().last_reasoning_action_context).toBeNull();
      expect(isGenuinePreviousResultReference(SECOND_ARRANGE)).toBe(true);
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(SECOND_ARRANGE);
      expect(isHandoffBlock(turn)).toBe(true);
      expect(combinedMessage(turn)).toMatch(/当前没有可执行的上一步建议|上一轮建议已经不可用/);
      expect(turn.state.latest_proposal).toBeNull();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — Explicit Previous-result Language', () => {
  it.each([
    '按刚才那个来',
    '把你刚才第二条记下来',
  ])('%s is a genuine previous-result reference and executes only with valid context', async (utterance) => {
    const { fixture, controller } = await controllerFor({
      steps: [ACTION_PREP, ACTION_INTERNAL, ACTION_SCHEDULE],
    });
    try {
      expect(isGenuinePreviousResultReference(utterance)).toBe(true);
      await controller.submit('接下来我该咋搞？');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(utterance);
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.latest_proposal?.tool_id === 'create_task'
        || turn.state.phase === 'clarification'
        || turn.state.phase === 'proposal').toBe(true);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T6 — Action Content Is NOT Previous-result Reference', () => {
  it.each([...ADVICE_QUESTIONS])('%s does not enter reasoning-action handoff', async (utterance) => {
    const { fixture, controller } = await controllerFor();
    try {
      controller.startNewConversation();
      expect(isGenuinePreviousResultReference(utterance)).toBe(false);
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(utterance);
      expect(isHandoffBlock(turn)).toBe(false);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expect(turn.outcome?.kind).toBe('reasoning_result');
      expect(turn.state.latest_proposal).toBeNull();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T7 — Current Explicit Write Still Wins', () => {
  it('写一条跟进 下周一联系 is not stolen by reasoning handoff', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('接下来我该咋搞？');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(WRITE_UTTERANCE);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
      if (turn.state.phase === 'proposal') {
        expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
      } else {
        expect(turn.state.phase).toBe('clarification');
        expect(combinedMessage(turn)).toMatch(/几点|具体.*时间/);
      }
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T8 — Explicit Delete Regression', () => {
  it('这个客户没用了，删了吧 stays customer.delete with STRONG confirmation', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit(DELETE_UTTERANCE);
      expect(isHandoffBlock(turn)).toBe(false);
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(turn.state.latest_proposal?.operation).toBe('delete');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(counts(fixture.sqlite).customers).toBe(1);
    } finally {
      fixture.close();
    }
  });
});

describe('T9 — Cross-customer Reference Still Fail Closed', () => {
  it('does not reuse Customer A action[1] against Customer B', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      await controller.submit('接下来我该咋搞？');
      expect(controller.getState().last_reasoning_action_context?.customer_id).toBe(CUSTOMER_A);
      controller.syncExternalScope(CUSTOMER_B, CUSTOMER_B_NAME);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      const turn = await controller.submit(SECOND_ARRANGE);
      expect(isGenuinePreviousResultReference(SECOND_ARRANGE)).toBe(true);
      expect(turn.state.latest_proposal?.customer_id).not.toBe(CUSTOMER_B);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(ACTION_SCHEDULE);
      expect(combinedMessage(turn)).toMatch(HANDOFF_BLOCK);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});
