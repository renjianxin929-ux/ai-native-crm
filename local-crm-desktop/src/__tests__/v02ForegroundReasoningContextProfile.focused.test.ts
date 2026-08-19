/**
 * V0.2 FINAL P1 — reasoning context truth + intent profile.
 *
 * REAL ENTRY: SalesAgentInteractionController.submit
 * Production-like: ContextSnapshot.recentInteractions is EMPTY (workspace
 * snapshot does not contain follow-ups/visits). Live CRM tables hold 3
 * timeline rows. The model envelope must receive those rows, not the empty
 * snapshot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import type { ModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { projectResultCards } from '../lib/salesAgentUi/resultCards';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_ID = 'gz-abc';
const CUSTOMER_NAME = '广州ABC科技有限公司';

const EVENT_PHONE = '今天电话没接';
const EVENT_FOLLOW = '上次跟进记录';
const EVENT_VISIT = '今天拜访';
const EVENT_CONCERN = '客户担心实施周期';

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

function productionLikePlanner(onInstruction?: (instruction: string) => void) {
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
    return JSON.stringify({ kind: 'unknown', reason: '模型选择无法识别。' });
  });
}

function interactionBlob(envelope: ModelContextEnvelope): string {
  return JSON.stringify(envelope.recent_interactions);
}

function groundedNextAction(envelope: ModelContextEnvelope) {
  const blob = interactionBlob(envelope);
  const hasFacts = blob.includes(EVENT_PHONE) && blob.includes(EVENT_FOLLOW) && blob.includes(EVENT_VISIT);
  const evidenceIds = envelope.evidence_map.map(item => item.evidence_id);
  const ids = evidenceIds.length > 0 ? evidenceIds : [CUSTOMER_ID];
  return {
    recommended_next_steps: hasFacts
      ? ['回拨确认今天未接电话原因', '针对实施周期顾虑准备说明', '把上次跟进结论带进下次沟通']
      : ['主动沟通获取更多信息'],
    reasoning_summary: hasFacts
      ? '结论：今天拜访已暴露实施周期顾虑，且电话未接通，下一步应先回拨并针对实施周期做准备。'
      : '暂无近期交互记录，需要主动沟通获取更多信息。',
    evidence_refs: ids.slice(0, 2),
    uncertainty: hasFacts ? [] : ['近期互动缺失'],
    requires_human_review: true,
  };
}

function groundedReview(envelope: ModelContextEnvelope) {
  const blob = interactionBlob(envelope);
  const hasFacts = blob.includes(EVENT_PHONE) && blob.includes(EVENT_FOLLOW) && blob.includes(EVENT_VISIT);
  const evidenceIds = envelope.evidence_map.map(item => item.evidence_id);
  const ids = evidenceIds.length > 0 ? evidenceIds : [CUSTOMER_ID];
  return {
    interaction_summary: hasFacts
      ? `本次进展：${EVENT_VISIT}，${EVENT_CONCERN}；另有${EVENT_PHONE}与${EVENT_FOLLOW}。`
      : '暂无近期交互记录。',
    key_points: hasFacts
      ? ['需要注意：客户担心实施周期', '今天电话没接，沟通未闭环', '下一步：回拨并解释实施周期']
      : ['暂无近期互动', '需要用户补充事实'],
    evidence_refs: ids.slice(0, 2),
    uncertainty: hasFacts ? [] : ['近期互动缺失'],
    requires_human_review: true,
  };
}

function emptyWorkspaceContext() {
  const snapshot: LoadedReadOnlyAgentSnapshot = {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: `snap-${CUSTOMER_ID}`,
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [{
      id: CUSTOMER_ID,
      name: CUSTOMER_NAME,
      customer_grade: 'A',
      intent_level: 'HIGH',
      evidence_ref: { type: 'customer', id: CUSTOMER_ID, label: CUSTOMER_NAME, synthetic: false, persisted: true },
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
    snapshotId: `snap-${CUSTOMER_ID}`,
    capturedAt: NOW,
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
    customers: [{
      customerId: CUSTOMER_ID,
      name: CUSTOMER_NAME,
      grade: 'A',
      intentLevel: 'HIGH',
      observedAt: NOW,
      evidenceIds: [CUSTOMER_ID],
    }],
    accounts: [],
    interactions: [],
  });
  const memory = buildCustomerMemoryContext({
    customer_id: CUSTOMER_ID,
    items: [{
      memory_id: `mem-${CUSTOMER_ID}`,
      customer_id: CUSTOMER_ID,
      kind: 'fact',
      summary: 'ACTIVE：关注实施周期',
      source_kind: 'human_decision',
      validation_source: 'human_decision',
      source_reference: 'review:1',
      evidence_reference: `mem-${CUSTOMER_ID}`,
      source_timestamp: '2026-07-09T00:00:00.000Z',
      recorded_at: '2026-07-09T00:00:00.000Z',
    }],
  });
  return { snapshot, context, memory };
}

function seedThreeTimelineEvents(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite']) {
  sqlite.prepare(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'fu-phone', CUSTOMER_ID, EVENT_PHONE, 'phone', 'no_answer', EVENT_PHONE,
    'MEDIUM', null, null, null, 1, '2026-07-15T10:00:00+08:00', '2026-07-15T10:00:00+08:00',
  );
  sqlite.prepare(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'fu-prev', CUSTOMER_ID, EVENT_FOLLOW, 'wechat', 'positive', EVENT_FOLLOW,
    'HIGH', null, null, '2026-07-20T10:00:00+08:00', 1, '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z',
  );
  sqlite.prepare(
    `INSERT INTO visit_records (
      id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit,
      visit_outcome, next_action, expected_contract_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'visit-today', CUSTOMER_ID, EVENT_VISIT, '2026-07-15T09:00:00+08:00', EVENT_VISIT, EVENT_CONCERN,
    'HIGH', 'POSITIVE', null, null, '2026-07-15T09:00:00+08:00', '2026-07-15T09:00:00+08:00',
  );
}

async function controllerFor(opts?: { readonly failModel?: boolean }) {
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
    last_contacted_at: '2026-07-15T10:00:00+08:00',
    next_follow_up_at: '2026-07-20T10:00:00+08:00',
  });
  fixture.sqlite.prepare('UPDATE customers SET opportunity_amount = ? WHERE id = ?').run(200000, CUSTOMER_ID);
  seedThreeTimelineEvents(fixture.sqlite);
  __setDbInstanceForTests(fixture.db);

  const fake = createFakeTrustedHostTransport(async call => {
    if (opts?.failModel) return { kind: 'error', status: 401, message: 'unauthorized' };
    if (call.envelope.intent === 'INTERACTION_SUMMARY') {
      return { kind: 'success', output: groundedReview(call.envelope) };
    }
    return { kind: 'success', output: groundedNextAction(call.envelope) };
  });

  const { snapshot, context, memory } = emptyWorkspaceContext();
  expect(context.recentInteractions).toHaveLength(0);

  const session = new SalesAgentSession(CUSTOMER_ID, null, () => NOW, {
    snapshot,
    context,
    memory,
    profile_id: 'foreign_trade_geo',
    planning_mode: 'deterministic',
    model_caller: fake.caller,
    loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-07-20T10:00:00+08:00' }),
  });
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

function taskInstruction(envelope: ModelContextEnvelope): string {
  return String((envelope as { reasoning_task_instruction?: unknown }).reasoning_task_instruction ?? '');
}

function resultSections(cards: ReturnType<typeof projectResultCards>): readonly { readonly title: string; readonly body: string }[] {
  return (cards as { sections?: readonly { title: string; body: string }[] }).sections ?? [];
}

function expectFaithfulTimeline(envelope: ModelContextEnvelope) {
  const blob = interactionBlob(envelope);
  expect(blob).toContain(EVENT_PHONE);
  expect(blob).toContain(EVENT_FOLLOW);
  expect(blob).toMatch(new RegExp(`${EVENT_VISIT}|${EVENT_CONCERN}`));
}

describe('T1 — timeline handoff truth', () => {
  it('get_customer_timeline(3) reaches the model envelope, not an empty snapshot', async () => {
    const { fixture, controller, fake } = await controllerFor();
    try {
      const turn = await controller.submit('分析一下下一步怎么做');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      const timeline = turn.outcome.result.tool_trace.find(item => item.tool_id === 'get_customer_timeline');
      expect(timeline?.records.length).toBe(3);
      expect(turn.outcome.result.runtime_details.runtime_mode).toBe('REAL_MODEL');
      expect(fake.calls.length).toBeGreaterThan(0);
      const envelope = fake.calls[0]!.envelope;
      expect(envelope.recent_interactions.length).toBe(3);
      expectFaithfulTimeline(envelope);
    } finally {
      fixture.close();
    }
  });
});

describe('T2 — NEXT_ACTION output profile', () => {
  it('分析一下下一步怎么做 is next-action reasoning, not a generic customer portrait', async () => {
    const { fixture, controller, fake } = await controllerFor();
    try {
      const turn = await controller.submit('分析一下下一步怎么做');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('NEXT_ACTION_PREPARATION');
      expect(turn.outcome.result.writes_crm).toBe(false);
      expect(turn.outcome.result.executable).toBe(false);
      expect(turn.state.latest_proposal).toBeNull();

      const envelope = fake.calls[0]!.envelope;
      expect(taskInstruction(envelope)).toMatch(/建议下一步|结论|当前已核实/);
      expect(taskInstruction(envelope)).not.toMatch(/客户理解[\s\S]*风险与机会/);
      expectFaithfulTimeline(envelope);

      const cards = projectResultCards(turn.outcome.result);
      const sections = resultSections(cards);
      expect(cards.headline).toBe('下一步建议');
      expect(cards.headline).not.toBe('客户洞察');
      expect(sections.map(item => item.title)).toEqual(['结论', '建议下一步', '依据']);
      expect(cards.nextSteps.length).toBeGreaterThan(0);
      expect(cards.nextSteps.length).toBeLessThanOrEqual(3);
      const rendered = `${cards.headline}\n${sections.map(item => `${item.title}\n${item.body}`).join('\n')}\n${turn.state.agent_message ?? ''}`;
      expect(rendered).not.toMatch(/暂无近期交互|暂无近期互动/);
      expect(rendered).not.toMatch(/请.*补充.*实施周期|请把拜访记录再发一遍/);
    } finally {
      fixture.close();
    }
  });
});

describe('T3 — INTERACTION_SUMMARY output profile', () => {
  it('生成复盘草稿 summarizes actual interactions, not the customer-insight template', async () => {
    const { fixture, controller, fake } = await controllerFor();
    try {
      const turn = await controller.submit('生成复盘草稿');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('INTERACTION_SUMMARY');
      expect(turn.outcome.result.writes_crm).toBe(false);

      const envelope = fake.calls[0]!.envelope;
      expect(taskInstruction(envelope)).toMatch(/本次进展|需要注意|复盘/);
      expectFaithfulTimeline(envelope);

      const cards = projectResultCards(turn.outcome.result);
      const sections = resultSections(cards);
      expect(cards.headline).toBe('客户复盘');
      expect(cards.headline).not.toBe('客户洞察');
      expect(sections.map(item => item.title)).toEqual(['本次进展', '需要注意', '下一步']);
      expect(sections.map(item => item.title)).not.toEqual(expect.arrayContaining(['客户理解', '风险与机会']));
      const rendered = `${cards.headline}\n${sections.map(item => `${item.title}\n${item.body}`).join('\n')}`;
      expect(rendered).toMatch(new RegExp(`${EVENT_VISIT}|${EVENT_CONCERN}|${EVENT_PHONE}|${EVENT_FOLLOW}`));
      expect(rendered).not.toMatch(/暂无近期交互|暂无近期互动/);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — same facts, different reasoning task profile', () => {
  it('reuses CRM truth but does not share identical task instructions', async () => {
    const { fixture, controller, fake } = await controllerFor();
    try {
      const nextTurn = await controller.submit('分析一下下一步怎么做');
      const reviewTurn = await controller.submit('生成复盘草稿');
      expect(nextTurn.outcome?.kind).toBe('reasoning_result');
      expect(reviewTurn.outcome?.kind).toBe('reasoning_result');
      expect(fake.calls.length).toBeGreaterThanOrEqual(2);
      const nextEnvelope = fake.calls[0]!.envelope;
      const reviewEnvelope = fake.calls[1]!.envelope;

      expect(nextEnvelope.recent_interactions.length).toBe(3);
      expect(reviewEnvelope.recent_interactions.length).toBe(3);
      expectFaithfulTimeline(nextEnvelope);
      expectFaithfulTimeline(reviewEnvelope);

      expect(nextEnvelope.intent).toBe('NEXT_ACTION_RECOMMENDATION');
      expect(reviewEnvelope.intent).toBe('INTERACTION_SUMMARY');
      expect(nextEnvelope.requested_output_schema).toBe('next_action_v1');
      expect(reviewEnvelope.requested_output_schema).toBe('interaction_summary_v1');
      expect(taskInstruction(nextEnvelope)).toBeTruthy();
      expect(taskInstruction(reviewEnvelope)).toBeTruthy();
      expect(taskInstruction(nextEnvelope)).not.toEqual(taskInstruction(reviewEnvelope));
      expect(taskInstruction(nextEnvelope)).not.toEqual(nextEnvelope.output_schema_spec);
      expect(taskInstruction(reviewEnvelope)).not.toEqual(reviewEnvelope.output_schema_spec);
      expect(taskInstruction(nextEnvelope)).toMatch(/建议下一步|结论/);
      expect(taskInstruction(reviewEnvelope)).toMatch(/本次进展|复盘/);
      expect(taskInstruction(nextEnvelope)).not.toMatch(/本次进展/);
      expect(taskInstruction(reviewEnvelope)).not.toMatch(/最多 3 条行动|最多三条行动/);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — factual read does not double-call the reasoning model', () => {
  it('上次什么时候联系这个客户 stays on timeline read, without a second reasoning call', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller, fake } = await controllerFor();
    try {
      const turn = await controller.submit('上次什么时候联系这个客户？');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.latest_direct_answer?.presentation).toBe('direct');
      expect(turn.state.latest_direct_answer?.shape).toBe('DIRECT_FACT');
      expect(turn.state.latest_direct_answer?.message).toMatch(/上次联系|今天拜访|电话没接|跟进/);
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T6 — write routing regression', () => {
  it('把商机金额改成21万 still routes to confirmation, not reasoning', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('把商机金额改成21万');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
      expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(210000);
      expect(previewAuthorityForSelection('customer.opportunity_amount.update')).toBe('REQUIRE_CONFIRMATION');
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(fixture.sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ n: 200000 });
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T7 — delete regression', () => {
  it('删除这个客户 still requires STRONG confirmation', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('删除这个客户');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(turn.state.latest_proposal?.operation).toBe('delete');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ c: 1 });
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });

  it('删掉 stays fail-closed and never enters open-ended reasoning', async () => {
    const reasoningSpy = vi.spyOn(await import('../lib/productionAi/productionReasoningPath'), 'runProductionReasoningPath');
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('删掉');
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(turn.state.latest_proposal).toBeNull();
      expect(reasoningSpy).not.toHaveBeenCalled();
      expect(fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(CUSTOMER_ID)).toEqual({ c: 1 });
    } finally {
      reasoningSpy.mockRestore();
      fixture.close();
    }
  });
});

describe('T8 — model unavailable stays truthful', () => {
  it('open-ended next-action with unauthorized model does not invent advice', async () => {
    const { fixture, controller } = await controllerFor({ failModel: true });
    try {
      const turn = await controller.submit('分析一下下一步怎么做');
      const message = `${turn.state.agent_message ?? ''}\n${turn.outcome && 'result' in turn.outcome ? turn.outcome.result.blocked_message ?? '' : ''}`;
      expect(message).toMatch(/AI 分析暂时不可用|大模型.*不可用|未生成 AI 分析|凭据无效或未授权/);
      expect(message).not.toMatch(/请明确你想调用哪个能力|上传材料|Analyze image|建议先做商机分析画像/);
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
