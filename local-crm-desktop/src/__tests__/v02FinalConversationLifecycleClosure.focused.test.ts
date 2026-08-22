/**
 * V0.2 FINAL — current-turn decision + fresh customer conversation lifecycle.
 *
 * TEST FIRST. REAL ENTRY: SalesAgentInteractionController.submit
 * USER NAVIGATION SEAM: enterCustomerConversation (foreground customer entry)
 * INTERNAL BIND SEAM: bind_required → continueAfterBind (must NOT fresh-reset)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
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
import { classifyClosedWriteIntent } from '../lib/salesAgentTools/writeIntent';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';
import { openSalesAgentSqliteFixture } from './salesAgentFunctionalFixture';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const CUSTOMER_B = 'gz-xyz';
const CUSTOMER_B_NAME = '广州XYZ贸易有限公司';
const NEXT_FOLLOW_AT = '2026-07-20T10:00:00+08:00';
const CURRENT_DECISION = '那就周三再找他';
const SECOND_ARRANGE = '第二个帮我安排上';
const DELETE_UTTERANCE = '这个客户没用了，删了吧';
const ACTION_PREP = '准备实施周期说明材料';
const ACTION_FRIDAY = '下周五再次联系客户确认实施周期';
const ACTION_INTERNAL = '内部确认可能的实施周期与关键里程碑';
const HANDOFF_BLOCK = /当前没有可执行的上一步建议|上一轮建议已经不可用|请重新分析当前客户/;
const CURRENT_TURN_DECISIONS = [
  '那就周三再找他',
  '那就周五再找他',
  '那就下周一再联系',
] as const;

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

type NavController = SalesAgentInteractionController & {
  enterCustomerConversation?(customerId: string, customerName?: string | null): void;
};

/**
 * Production user-navigation seam.
 * Foreground: CustomerDetail → Ask Sales Agent, or picker without continuePrompt.
 * Must NOT be used for bind_required continuation.
 */
function simulateForegroundUserEnterCustomer(
  controller: NavController,
  customerId: string,
  customerName: string,
) {
  if (typeof controller.enterCustomerConversation === 'function') {
    controller.enterCustomerConversation(customerId, customerName);
    return;
  }
  controller.syncExternalScope(customerId, customerName);
}

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
    if (/下一步|咋搞|咋弄|总结/.test(text)) {
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
    if (/分析|咋搞|下一步|合适|联系|安排|总结/.test(instruction)) {
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
    amount: (sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(customerId) as { n: number | null }).n,
  };
}

async function controllerFor(opts?: {
  readonly withCustomerB?: boolean;
  readonly scoped?: boolean;
  readonly steps?: readonly string[];
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  if (opts?.withCustomerB) seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  __setDbInstanceForTests(fixture.db);
  const steps = opts?.steps ?? [ACTION_PREP, ACTION_FRIDAY, ACTION_INTERNAL];

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
  }) as NavController;
  if (opts?.scoped !== false) controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
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

function expectCurrentTurnScheduleWrite(turn: {
  state: {
    phase: string;
    current_intent: string | null;
    latest_proposal: { tool_id: string } | null;
    agent_message: string | null;
    resolution_reason: string | null;
  };
}) {
  expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
  if (turn.state.phase === 'proposal') {
    expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
  } else {
    expect(turn.state.phase).toBe('clarification');
    expect(combinedMessage(turn)).toMatch(/几点|具体.*时间|日期和时间/);
    expect(String(turn.state.current_intent)).toMatch(/next_follow_up|UPDATE_CUSTOMER/);
  }
}

describe('T1 — Current-turn Decision Must NOT Be Handoff', () => {
  it('那就周三再找他 is a current-turn decision, not a previous-result pointer', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      controller.startNewConversation();
      expect(controller.getState().scoped_customer_id).toBe(CUSTOMER_A);
      expect(controller.getState().last_reasoning_action_context).toBeNull();
      const classified = classifyReasoningActionContinuation(CURRENT_DECISION);
      const genuine = isGenuinePreviousResultReference(CURRENT_DECISION);
      const write = classifyClosedWriteIntent(CURRENT_DECISION);
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(CURRENT_DECISION);

      console.log([
        'FAIL_FIRST_CURRENT_DECISION',
        `INPUT=${CURRENT_DECISION}`,
        `ACTUAL_CLASSIFIER=${classified ? classified.kind : 'null'}`,
        `ACTUAL_GENUINE_REFERENCE=${genuine}`,
        `ACTUAL_WRITE=${write?.tool_id ?? 'null'}`,
        `ACTUAL_HANDOFF=${isHandoffBlock(turn)}`,
        `ACTUAL_MESSAGE=${combinedMessage(turn).replace(/\n/g, ' | ')}`,
        'EXPECTED_HANDOFF=false',
        'EXPECTED_GENUINE_REFERENCE=false',
      ].join('\n'));
      expect(genuine).toBe(false);
      expect(classified).toBeNull();
      expect(write?.tool_id).toBe('update_next_follow_up_time');
      expect(isHandoffBlock(turn)).toBe(false);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expectCurrentTurnScheduleWrite(turn);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });

  it.each([...CURRENT_TURN_DECISIONS])('%s is not a previous-result pointer', (utterance) => {
    expect(isGenuinePreviousResultReference(utterance)).toBe(false);
    expect(classifyReasoningActionContinuation(utterance)).toBeNull();
  });
});

describe('T2 — Same Customer + Old Reasoning Context', () => {
  it('那就周三再找他 still does not copy previous suggested_actions', async () => {
    const { fixture, controller } = await controllerFor({
      steps: [ACTION_PREP, ACTION_FRIDAY, ACTION_INTERNAL],
    });
    try {
      await controller.submit('接下来我该咋搞？');
      expect(controller.getState().last_reasoning_action_context?.customer_id).toBe(CUSTOMER_A);
      expect(controller.getState().last_reasoning_action_context?.suggested_actions[1]?.text).toBe(ACTION_FRIDAY);
      expect(isGenuinePreviousResultReference(CURRENT_DECISION)).toBe(false);
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(CURRENT_DECISION);
      expect(isHandoffBlock(turn)).toBe(false);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expect(combinedMessage(turn)).not.toContain('下周五');
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(ACTION_FRIDAY);
      expectCurrentTurnScheduleWrite(turn);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T3 — Stale Other-customer Context Must NOT Block Current Decision', () => {
  it('does not use Customer B reasoning to block 那就周三再找他 on Customer A', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      simulateForegroundUserEnterCustomer(controller, CUSTOMER_B, CUSTOMER_B_NAME);
      const first = await controller.submit('接下来我该咋搞？');
      expect(first.state.last_reasoning_action_context?.customer_id).toBe(CUSTOMER_B);
      simulateForegroundUserEnterCustomer(controller, CUSTOMER_A, CUSTOMER_A_NAME);
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(CURRENT_DECISION);
      expect(isHandoffBlock(turn)).toBe(false);
      expect(combinedMessage(turn)).not.toMatch(/刚才的建议属于广州XYZ|属于广州XYZ/);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expectCurrentTurnScheduleWrite(turn);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — Genuine Previous-result Reference Still Works', () => {
  it('第二个帮我安排上 still reads structured action[1]', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor({
      steps: [ACTION_PREP, ACTION_FRIDAY, ACTION_INTERNAL],
    });
    try {
      await controller.submit('接下来我该咋搞？');
      const actions = controller.getState().last_reasoning_action_context?.suggested_actions ?? [];
      expect(actions[1]?.text).toBe(ACTION_FRIDAY);
      expect(isGenuinePreviousResultReference(SECOND_ARRANGE)).toBe(true);
      expect(classifyReasoningActionContinuation(SECOND_ARRANGE)).toEqual({ kind: 'execute_ordinal', ordinal: 2 });
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);
      const turn = await controller.submit(SECOND_ARRANGE);
      expect(combinedMessage(turn)).not.toMatch(HANDOFF_BLOCK);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(SECOND_ARRANGE);
      expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
      if (turn.state.phase === 'proposal') {
        expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
      } else {
        expect(turn.state.phase).toBe('clarification');
        expect(combinedMessage(turn)).toMatch(/几点|具体.*时间|日期和时间|下周五/);
      }
      expect(plannerCalls.length).toBe(plannerBefore);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — Explicit Previous-turn Pointer Still Works', () => {
  it.each([
    '按刚才那个来',
    '把你刚才第二条记下来',
  ])('%s remains a genuine previous-result reference', async (utterance) => {
    const { fixture, controller } = await controllerFor({
      steps: [ACTION_PREP, ACTION_INTERNAL, ACTION_FRIDAY],
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

describe('T6 — Cross-customer Genuine Reference Still Fail Closed', () => {
  it('does not write Customer A action[1] onto Customer B', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      await controller.submit('接下来我该咋搞？');
      expect(controller.getState().last_reasoning_action_context?.customer_id).toBe(CUSTOMER_A);
      simulateForegroundUserEnterCustomer(controller, CUSTOMER_B, CUSTOMER_B_NAME);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      const turn = await controller.submit(SECOND_ARRANGE);
      expect(isGenuinePreviousResultReference(SECOND_ARRANGE)).toBe(true);
      expect(turn.state.latest_proposal?.customer_id).not.toBe(CUSTOMER_B);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toBe(ACTION_FRIDAY);
      expect(isHandoffBlock(turn)).toBe(true);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('T7 — User Enters Customer A → Fresh Scoped Conversation', () => {
  it('foreground user navigation clears transient chat state and keeps CRM + scope', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      simulateForegroundUserEnterCustomer(controller, CUSTOMER_B, CUSTOMER_B_NAME);
      await controller.submit('接下来我该咋搞？');
      const stale = controller.getState();
      expect(stale.last_reasoning_action_context).not.toBeNull();
      expect(stale.latest_result).not.toBeNull();
      expect(stale.current_intent).not.toBeNull();
      expect(stale.agent_message).toBeTruthy();
      const beforeA = counts(fixture.sqlite, CUSTOMER_A);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      simulateForegroundUserEnterCustomer(controller, CUSTOMER_A, CUSTOMER_A_NAME);
      const next = controller.getState();

      console.log([
        'FAIL_FIRST_FRESH_CUSTOMER',
        `SCOPED=${next.scoped_customer_id}`,
        `REASONING_CONTEXT=${next.last_reasoning_action_context?.customer_id ?? 'null'}`,
        `LATEST_RESULT=${next.latest_result ? 'present' : 'null'}`,
        `PROPOSAL=${next.latest_proposal ? 'present' : 'null'}`,
        `CLARIFICATION=${next.latest_clarification ? 'present' : 'null'}`,
      ].join('\n'));
      expect(next.scoped_customer_id).toBe(CUSTOMER_A);
      expect(next.scoped_customer_name).toBe(CUSTOMER_A_NAME);
      expect(next.last_reasoning_action_context).toBeNull();
      expect(next.latest_result).toBeNull();
      expect(next.latest_proposal).toBeNull();
      expect(next.latest_clarification).toBeNull();
      expect(next.current_intent).toBeNull();
      expect(next.pending_original_instruction).toBeNull();
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(beforeA);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });

  it('production UI wires user navigation to enterCustomerConversation, not all-scope-change reset', () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const workspace = readFileSync(resolve(srcRoot, 'components/aiNative/SalesAgentInteractionWorkspace.tsx'), 'utf8');
    const controllerSrc = readFileSync(resolve(srcRoot, 'lib/salesAgentTools/interactionController.ts'), 'utf8');
    const detail = readFileSync(resolve(srcRoot, 'pages/CustomerDetail.tsx'), 'utf8');
    expect(detail).toMatch(/customerScopedEntry/);
    expect(controllerSrc).toMatch(/enterCustomerConversation\s*\(/);
    expect(workspace).toMatch(/enterCustomerConversation/);
    expect(workspace).toMatch(/pendingContinue/);
    expect(workspace).toMatch(/continueAfterBind/);
    expect(controllerSrc).toMatch(/syncExternalScope\s*\(/);
    expect(controllerSrc).not.toMatch(/syncExternalScope[\s\S]{0,400}startNewConversation\(\)/);
  });
});

describe('T8 — User Navigates A → B', () => {
  it('drops Customer A transient conversation state when the user enters Customer B', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      await controller.submit('接下来我该咋搞？');
      expect(controller.getState().last_reasoning_action_context?.customer_id).toBe(CUSTOMER_A);
      expect(controller.getState().latest_result).not.toBeNull();
      const beforeA = counts(fixture.sqlite, CUSTOMER_A);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      simulateForegroundUserEnterCustomer(controller, CUSTOMER_B, CUSTOMER_B_NAME);
      const next = controller.getState();
      expect(next.scoped_customer_id).toBe(CUSTOMER_B);
      expect(next.scoped_customer_name).toBe(CUSTOMER_B_NAME);
      expect(next.last_reasoning_action_context).toBeNull();
      expect(next.latest_result).toBeNull();
      expect(next.latest_proposal).toBeNull();
      expect(next.latest_clarification).toBeNull();
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(beforeA);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('T9 — Re-enter Same Customer', () => {
  it('re-entering Customer A from user navigation still starts a fresh scoped conversation', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('接下来我该咋搞？');
      expect(controller.getState().last_reasoning_action_context).not.toBeNull();
      const before = counts(fixture.sqlite, CUSTOMER_A);
      simulateForegroundUserEnterCustomer(controller, CUSTOMER_A, CUSTOMER_A_NAME);
      const next = controller.getState();
      expect(next.scoped_customer_id).toBe(CUSTOMER_A);
      expect(next.last_reasoning_action_context).toBeNull();
      expect(next.latest_result).toBeNull();
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T10 — Internal Bind Must Preserve Current Turn', () => {
  it('总结一下广州ABC科技有限公司 continues after bind and is not wiped by fresh navigation', async () => {
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const before = counts(fixture.sqlite, CUSTOMER_A);
      const locating = await controller.submit('总结一下广州ABC科技有限公司');
      expect(locating.event.type).toBe('bind_required');
      if (locating.event.type !== 'bind_required') throw new Error('expected bind');
      const continuePrompt = locating.event.continue_prompt;
      const pending = locating.state.pending_original_instruction;
      const envelopeId = locating.state.intent_envelope?.envelope_id;
      controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
      expect(controller.getState().pending_original_instruction).toBe(pending);
      expect(controller.getState().intent_envelope?.envelope_id).toBe(envelopeId);
      const continued = await controller.continueAfterBind(continuePrompt, CUSTOMER_A);
      expect(continued.outcome?.kind).toBe('reasoning_result');
      expect(continued.state.scoped_customer_id).toBe(CUSTOMER_A);
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T11 — Internal Write Bind Still Works', () => {
  it('unscoped write bind continues the original write with zero pre-confirm writes', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    let active: SalesAgentSession | null = null;
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      clock: () => NOW,
      createSession: () => active,
    });
    try {
      const beforeFollowUps = (fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get() as { c: number }).c;
      const first = await controller.submit('帮我给这个客户写一条跟进，下周一联系');
      expect(first.state.phase).toBe('awaiting_candidate_selection');
      const candidate = first.state.candidate_results[0]!;
      const selected = await controller.selectCandidate(candidate.id);
      expect(selected.event.type).toBe('bind_required');
      if (selected.event.type !== 'bind_required') throw new Error('expected bind');
      const pending = selected.state.pending_original_instruction;
      controller.syncExternalScope(selected.event.customer_id, selected.event.customer_name);
      expect(controller.getState().pending_original_instruction).toBe(pending);
      active = {
        submit: async envelope => ({
          kind: 'clarification_required',
          clarification: {
            kind: 'CLARIFICATION_REQUIRED',
            clarification_id: 'clarify-1',
            intent: envelope.write_intent ?? 'UPDATE_CUSTOMER_REQUEST',
            tool_id: envelope.write_draft?.tool_id ?? 'update_next_follow_up_time',
            original_instruction: envelope.original_instruction,
            customer_id: candidate.id,
            question: '下周一几点联系？',
            missing_fields: ['next_follow_up_time'],
            parsed_fields: envelope.write_draft?.parsed_fields ?? {},
            quick_replies: envelope.write_draft?.quick_replies ?? [],
            pending_write_intent: envelope.write_intent ?? 'UPDATE_CUSTOMER_REQUEST',
          },
        }),
      } as unknown as SalesAgentSession;
      const continued = await controller.continueAfterBind(selected.event.continue_prompt, candidate.id);
      expect(continued.state.phase).toBe('clarification');
      expect(continued.state.agent_message).toMatch(/几点联系/);
      expect((fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get() as { c: number }).c).toBe(beforeFollowUps);
    } finally {
      fixture.close();
    }
  });
});

describe('regression — delete STRONG confirmation still holds', () => {
  it('这个客户没用了，删了吧 stays customer.delete with zero pre-confirm writes', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit(DELETE_UTTERANCE);
      expect(isHandoffBlock(turn)).toBe(false);
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(counts(fixture.sqlite).customers).toBe(1);
    } finally {
      fixture.close();
    }
  });
});
