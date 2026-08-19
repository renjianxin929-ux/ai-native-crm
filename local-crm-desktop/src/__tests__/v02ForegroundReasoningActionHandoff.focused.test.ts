/**
 * V0.2 FINAL P1.5 — reasoning → explicit action handoff.
 *
 * REAL ENTRY: SalesAgentInteractionController.submit
 * Reasoning may PREPARE a CRM action. It must never auto-write.
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
const REVIEW_NEXT = '确认客户实施周期与关键里程碑';

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

function productionLikePlanner(onInstruction?: (instruction: string) => void) {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    onInstruction?.(instruction);
    if (/生成(?:下一步)?待办|做成任务|加成待办/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'task.create',
        clarification_question: '请提供下一步待办的具体内容，例如任务标题或跟进事项。',
        missing_fields: ['title'],
      });
    }
    if (/安排.*下次跟进|安排.*下次联系/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'follow_up.create',
        clarification_question: '请提供跟进记录的标题以及跟进内容。',
        missing_fields: ['title', 'feedback_notes'],
      });
    }
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
    return JSON.stringify({ kind: 'unknown', reason: '模型选择无法识别。' });
  });
}

function nextActionOutput(
  evidenceIds: readonly string[],
  steps: readonly string[] = [ACTION_1, ACTION_2, ACTION_3],
  summary = '该客户已有互动与跟进安排，下一步应围绕现有事实推进，而不是改 CRM。',
) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    recommended_next_steps: [...steps],
    reasoning_summary: summary,
    evidence_refs: ids,
    uncertainty: [],
    requires_human_review: true,
  };
}

function reviewOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    interaction_summary: `本次进展：今天电话没接。需要注意：客户关心实施周期。下一步：${REVIEW_NEXT}。`,
    key_points: ['今天电话没接', '客户关心实施周期', `下一步：${REVIEW_NEXT}`],
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
  sqlite.prepare(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `fu-prev-${id}`, id, '上次跟进记录', 'wechat', 'positive', '上次跟进记录',
    'HIGH', null, null, NEXT_FOLLOW_AT, 1, '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z',
  );
  sqlite.prepare(
    `INSERT INTO visit_records (
      id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit,
      visit_outcome, next_action, expected_contract_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `visit-${id}`, id, '今天拜访', '2026-07-15T09:00:00+08:00', '今天拜访', '客户担心实施周期',
    'HIGH', 'POSITIVE', null, null, '2026-07-15T09:00:00+08:00', '2026-07-15T09:00:00+08:00',
  );
}

async function controllerFor(opts?: {
  readonly nextSteps?: readonly string[];
  readonly withCustomerB?: boolean;
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  if (opts?.withCustomerB) seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  __setDbInstanceForTests(fixture.db);

  const fake = createFakeTrustedHostTransport(async call => {
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    if (call.envelope.intent === 'INTERACTION_SUMMARY') {
      return { kind: 'success', output: reviewOutput(ids) };
    }
    return { kind: 'success', output: nextActionOutput(ids, opts?.nextSteps) };
  });

  const session = sessionFor(CUSTOMER_A, CUSTOMER_A_NAME, fake.caller);
  const plannerCalls: string[] = [];
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: (customerId) => {
      if (customerId === CUSTOMER_B) return sessionFor(CUSTOMER_B, CUSTOMER_B_NAME, fake.caller);
      return session;
    },
    clock: () => NOW,
    model_planner: productionLikePlanner(instruction => plannerCalls.push(instruction)),
  });
  controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
  return { fixture, controller, plannerCalls };
}

function counts(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'], customerId = CUSTOMER_A) {
  return {
    tasks: (sqlite.prepare('SELECT COUNT(*) AS c FROM tasks WHERE customer_id=?').get(customerId) as { c: number }).c,
    followUps: (sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get(customerId) as { c: number }).c,
    nextFollow: (sqlite.prepare('SELECT next_follow_up_at AS t FROM customers WHERE id=?').get(customerId) as { t: string | null }).t,
  };
}

describe('T1 — reasoning context is retained', () => {
  it('keeps a bounded structured action context after next-action reasoning, with zero writes', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('分析一下下一步怎么做');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.state.latest_proposal).toBeNull();
      const ctx = turn.state.last_reasoning_action_context;
      expect(ctx?.customer_id).toBe(CUSTOMER_A);
      expect(ctx?.suggested_actions).toHaveLength(3);
      expect(ctx?.suggested_actions.map(item => item.text)).toEqual([ACTION_1, ACTION_2, ACTION_3]);
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T2 — generate todo from previous reasoning', () => {
  it('好，生成下一步待办 proposes task.create from the previous suggestion, without asking to retype it', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      await controller.submit('分析一下下一步怎么做');
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('好，生成下一步待办');
      const message = `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
      expect(message).not.toMatch(/请提供下一步待办的具体内容|任务标题或跟进事项/);
      expect(message).not.toMatch(/请补充.*标题|客户理解|客户洞察/);
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      expect(String(turn.state.latest_proposal?.proposed_values.title)).toContain('实施周期说明');
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      expect(counts(fixture.sqlite)).toEqual(before);
      expect(plannerCalls.length).toBe(plannerBefore);
    } finally {
      fixture.close();
    }
  });
});

describe('T3 — first/second action reference', () => {
  it('把第二条做成任务 uses suggestion #2, not #1 or #3, and does not write before confirm', async () => {
    const { fixture, controller, plannerCalls } = await controllerFor();
    try {
      await controller.submit('分析一下下一步怎么做');
      const plannerBefore = plannerCalls.length;
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('把第二条做成任务');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      const title = String(turn.state.latest_proposal?.proposed_values.title);
      expect(title).toContain(ACTION_2);
      expect(title).not.toContain(ACTION_1);
      expect(title).not.toContain(ACTION_3);
      expect(counts(fixture.sqlite)).toEqual(before);
      expect(plannerCalls.length).toBe(plannerBefore);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — follow-up schedule from reasoning', () => {
  it('安排一下下次跟进 maps 周三再次联系 to next_follow_up_time.update, not follow_up.create', async () => {
    const { fixture, controller } = await controllerFor({
      nextSteps: [SCHEDULE_ACTION, ACTION_2, ACTION_3],
    });
    try {
      await controller.submit('分析一下下一步怎么做');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('安排一下下次跟进');
      const message = `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
      expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
      expect(message).not.toMatch(/跟进记录的标题|这次实际发生了什么/);
      if (turn.state.phase === 'proposal') {
        expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
        expect(String(turn.state.latest_proposal?.proposed_values.next_follow_up_at)).not.toMatch(/T10:00|T15:00/);
      } else {
        expect(turn.state.phase).toBe('clarification');
        expect(message).toMatch(/几点|具体.*时间|日期和时间/);
        expect(turn.state.current_intent).toMatch(/next_follow_up|UPDATE_CUSTOMER/);
      }
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — review to action', () => {
  it('根据复盘生成待办 proposes task.create from the review next step and does not persist the review', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const first = await controller.submit('生成复盘草稿');
      expect(first.outcome?.kind).toBe('reasoning_result');
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('根据复盘生成待办');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_task');
      expect(String(turn.state.latest_proposal?.proposed_values.title)).toContain('实施周期');
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T6 — occurred event does not confuse future plan', () => {
  it('安排下次跟进 after 今天电话没接 + 周三再联系 updates next follow-up, not a completed follow_up', async () => {
    const { fixture, controller } = await controllerFor({
      nextSteps: [SCHEDULE_ACTION, ACTION_2, ACTION_3],
    });
    try {
      const before = counts(fixture.sqlite);
      await controller.submit('分析一下下一步怎么做');
      const turn = await controller.submit('安排下次跟进');
      expect(turn.state.latest_proposal?.tool_id).not.toBe('create_follow_up_record');
      if (turn.state.phase === 'proposal') {
        expect(turn.state.latest_proposal?.tool_id).toBe('update_next_follow_up_time');
      } else {
        expect(turn.state.phase).toBe('clarification');
        expect(turn.state.current_intent).toMatch(/next_follow_up|UPDATE_CUSTOMER/);
      }
      expect(counts(fixture.sqlite).followUps).toBe(before.followUps);
      expect(counts(fixture.sqlite).nextFollow).toBe(before.nextFollow);
    } finally {
      fixture.close();
    }
  });
});

describe('T7 — stale customer context', () => {
  it('does not apply Customer A reasoning to Customer B', async () => {
    const { fixture, controller } = await controllerFor({ withCustomerB: true });
    try {
      await controller.submit('分析一下下一步怎么做');
      controller.syncExternalScope(CUSTOMER_B, CUSTOMER_B_NAME);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      const turn = await controller.submit('把第一条做成任务');
      const message = `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
      expect(turn.state.latest_proposal?.customer_id).not.toBe(CUSTOMER_B);
      expect(String(turn.state.latest_proposal?.proposed_values.title ?? '')).not.toContain(ACTION_1);
      expect(message).toMatch(/广州ABC|当前客户|重新分析|不属于/);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('T8 — explicit write regression', () => {
  it('把商机金额改成21万 still routes to opportunity_amount.update without reasoning context', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('把商机金额改成21万');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
      expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(210000);
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(fixture.sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(CUSTOMER_A)).toEqual({ n: 200000 });
      expect(counts(fixture.sqlite).tasks).toBe(before.tasks);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T9 — delete regression', () => {
  it('删除这个客户 still requires STRONG confirmation and is not weakened by reasoning context', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('分析一下下一步怎么做');
      const turn = await controller.submit('删除这个客户');
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

describe('T10 — no auto write', () => {
  it('next-action reasoning alone does not create tasks, follow-ups, or change next_follow_up_at', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = counts(fixture.sqlite);
      const turn = await controller.submit('分析一下下一步怎么做');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.outcome.result.executable).toBe(false);
      expect(turn.state.latest_proposal).toBeNull();
      expect(counts(fixture.sqlite)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});
