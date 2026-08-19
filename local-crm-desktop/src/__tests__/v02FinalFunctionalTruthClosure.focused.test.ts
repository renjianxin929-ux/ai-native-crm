/**
 * V0.2 FINAL — Functional Truth Closure (Batch A).
 *
 * TEST FIRST. Real entry is SalesAgentInteractionController.submit.
 * Fake Transport proves the contract only. Real DeepSeek argument
 * extraction still requires foreground acceptance.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { selectCapabilityDeterministic } from '../lib/planner/deterministicCapabilitySelector';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import type { ModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { reasoningTaskInstructionFor } from '../lib/productionAi/modelOutputSchemas';
import { resolveCapabilityRoute } from '../lib/productionAi/capabilityRoutingMatrix';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { projectResultCards } from '../lib/salesAgentUi/resultCards';
import { projectConfirmationCard } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { buildAgentWorkProcess } from '../lib/salesAgentUi/workProcess';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';
import { sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const ACTION_1 = '下一个工作日再次联系客户，跟进未接电话';
const ACTION_2 = '准备一份实施周期说明或案例材料';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const INTERNAL_LEAK = /W4-4|W3-1|confirmed-write|db\.deleteCustomer|capability_id|NEXT_ACTION_PREPARATION|get_customer_timeline|get_active_memory|SEMANTIC_INTENT_ROUTING|CUSTOMER_SUMMARY|INTERACTION_SUMMARY/i;

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

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
    if (/复盘|沟通下来|最近跟他的进展|聊得怎么样/.test(text)) {
      return { ...base, intent: 'INTERACTION_SUMMARY' };
    }
    if (/接下来应该怎么办|下一步/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
    }
    if (/分析一下|你怎么看/.test(text)) {
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

function hostileClarificationSemanticRouter() {
  return async (): Promise<SemanticIntentResolution> => ({
    intent: 'CLARIFICATION_REQUIRED',
    filters: {},
    entities: [],
    scope: CUSTOMER_A,
    missing_fields: ['intent'],
    confidence: 0.2,
    clarification_question: '请明确你想调用哪个能力。',
  });
}

function contractFaithfulCreatePlanner(onInstruction?: (instruction: string) => void) {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    onInstruction?.(instruction);
    if (!/新建|新增|创建|登记/.test(instruction) || !/客户/.test(instruction)) {
      return JSON.stringify({ kind: 'unknown', reason: '不是新建客户' });
    }
    if (/新增客户，老板张总/.test(instruction) || /新建一个广州客户\s*$/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'customer.create',
        clarification_question: '请提供客户名称，例如“新建一个客户，广州星河科技”。',
        missing_fields: ['name'],
      });
    }
    if (/广州星河科技/.test(instruction)) {
      const contact = /张总/.test(instruction) ? { contact_person: '张总' } : {};
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.create',
        arguments: { name: '广州星河科技', ...contact },
      });
    }
    if (/星河科技/.test(instruction) && /张总/.test(instruction)) {
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.create',
        arguments: { name: '星河科技', contact_person: '张总' },
      });
    }
    return JSON.stringify({
      kind: 'clarify',
      capability_id: 'customer.create',
      clarification_question: '请提供客户名称，例如“新建一个客户，广州星河科技”。',
      missing_fields: ['name'],
    });
  });
}

function summaryOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    customer_understanding: `${CUSTOMER_A_NAME} 当前可推进，实施周期仍待确认。`,
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

function reviewOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    interaction_summary: '本次进展：今天拜访，客户担心实施周期；另有未接电话。',
    key_points: ['需要注意：实施周期未闭环', '下一步：回拨并准备周期说明'],
    evidence_refs: ids,
    uncertainty: [],
    requires_human_review: true,
  };
}

function nextActionOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    recommended_next_steps: [ACTION_1, ACTION_2],
    reasoning_summary: '下一步应围绕未接电话与实施周期顾虑推进。',
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
      source_timestamp: NOW,
      recorded_at: NOW,
    }],
  });
  return { snapshot, context, memory };
}

async function reasoningController(opts?: {
  readonly semantic?: (instruction: string, envelopeId: string) => Promise<SemanticIntentResolution>;
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  insertSeededCustomer(fixture.sqlite, {
    id: CUSTOMER_A,
    name: CUSTOMER_A_NAME,
    region: '广州',
    industry: '软件',
    customer_grade: 'A',
    stage: 'CONTACTED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-15T10:00:00+08:00',
    next_follow_up_at: '2026-07-20T10:00:00+08:00',
  });
  fixture.sqlite.prepare(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'fu-1', CUSTOMER_A, '上次跟进记录', 'phone', 'no_answer', '今天电话没接',
    'MEDIUM', null, null, null, 1, NOW, NOW,
  );
  fixture.sqlite.prepare(
    `INSERT INTO visit_records (
      id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit,
      visit_outcome, next_action, expected_contract_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'vi-1', CUSTOMER_A, '今天拜访', NOW, '工厂参观', '客户担心实施周期',
    'HIGH', 'POSITIVE', null, null, NOW, NOW,
  );
  __setDbInstanceForTests(fixture.db);

  const fake = createFakeTrustedHostTransport(async call => {
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    if (call.envelope.intent === 'INTERACTION_SUMMARY') {
      return { kind: 'success', output: reviewOutput(ids) };
    }
    if (call.envelope.intent === 'NEXT_ACTION_PREPARATION' || call.envelope.intent === 'NEXT_ACTION_RECOMMENDATION') {
      return { kind: 'success', output: nextActionOutput(ids) };
    }
    return { kind: 'success', output: summaryOutput(ids) };
  });
  const { snapshot, context, memory } = emptyWorkspaceFor(CUSTOMER_A, CUSTOMER_A_NAME);
  const session = new SalesAgentSession(CUSTOMER_A, null, () => NOW, {
    snapshot,
    context,
    memory,
    profile_id: 'foreign_trade_geo',
    planning_mode: 'deterministic',
    model_caller: fake.caller,
    loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-07-20T10:00:00+08:00' }),
  });
  const semanticCalls: string[] = [];
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: () => session,
    clock: () => NOW,
    semantic_intent_router: opts?.semantic ?? productionLikeSemanticRouter(semanticCalls),
  });
  controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
  return { fixture, controller, fake, semanticCalls };
}

async function createController() {
  const fixture = sqliteFixture();
  await fixture.initialize();
  __setDbInstanceForTests(fixture.db);
  const plannerCalls: string[] = [];
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: () => null,
    clock: () => NOW,
    model_planner: contractFaithfulCreatePlanner(instruction => plannerCalls.push(instruction)),
  });
  return { fixture, controller, plannerCalls };
}

function taskInstruction(envelope: ModelContextEnvelope): string {
  return String(envelope.reasoning_task_instruction ?? '');
}

describe('A1 — review vs analysis vs next-action profiles', () => {
  it('A1 分析一下 is customer analysis, not review, not next-action', async () => {
    const { fixture, controller, fake } = await reasoningController();
    try {
      const turn = await controller.submit('分析一下');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('CUSTOMER_SUMMARY');
      expect(turn.outcome.result.writes_crm).toBe(false);
      const envelope = fake.calls[0]!.envelope;
      expect(envelope.requested_output_schema).toBe('customer_summary_v1');
      expect(taskInstruction(envelope)).toMatch(/核心判断|客户分析|风险/);
      expect(taskInstruction(envelope)).not.toMatch(/本次进展；需要注意；下一步/);
      const cards = projectResultCards(turn.outcome.result);
      expect(cards.headline).toBe('客户分析');
      expect(cards.headline).not.toBe('客户洞察');
      expect(cards.headline).not.toBe('客户复盘');
      expect(cards.sections.map(item => item.title)).toEqual(['核心判断', '风险机会', '建议']);
    } finally {
      fixture.close();
    }
  });

  it('A2 这个客户你怎么看 is open customer analysis', async () => {
    const { fixture, controller, fake } = await reasoningController();
    try {
      const turn = await controller.submit('这个客户你怎么看');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('CUSTOMER_SUMMARY');
      expect(fake.calls[0]!.envelope.requested_output_schema).toBe('customer_summary_v1');
      const cards = projectResultCards(turn.outcome.result);
      expect(cards.headline).toBe('客户分析');
    } finally {
      fixture.close();
    }
  });

  it('A3 做个复盘 is interaction review, not generic portrait', async () => {
    const { fixture, controller, fake } = await reasoningController();
    try {
      const turn = await controller.submit('做个复盘');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('INTERACTION_SUMMARY');
      const envelope = fake.calls[0]!.envelope;
      expect(envelope.requested_output_schema).toBe('interaction_summary_v1');
      expect(taskInstruction(envelope)).toMatch(/本次进展|需要注意|复盘/);
      const cards = projectResultCards(turn.outcome.result);
      expect(cards.headline).toBe('客户复盘');
      expect(cards.sections.map(item => item.title)).toEqual(['本次进展', '需要注意', '下一步']);
    } finally {
      fixture.close();
    }
  });

  it('A4 帮我复盘一下最近跟他的进展 stays review', async () => {
    const { fixture, controller } = await reasoningController();
    try {
      const turn = await controller.submit('帮我复盘一下最近跟他的进展');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('INTERACTION_SUMMARY');
      expect(projectResultCards(turn.outcome.result).headline).toBe('客户复盘');
    } finally {
      fixture.close();
    }
  });

  it('A5 最近沟通下来你觉得怎么样 is review, not generic analysis', async () => {
    const { fixture, controller } = await reasoningController();
    try {
      const turn = await controller.submit('最近沟通下来你觉得怎么样');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('INTERACTION_SUMMARY');
      expect(turn.outcome.result.intent_envelope.intent).not.toBe('CUSTOMER_SUMMARY');
      expect(projectResultCards(turn.outcome.result).headline).toBe('客户复盘');
    } finally {
      fixture.close();
    }
  });

  it('A6 接下来应该怎么办 is next-action preparation', async () => {
    const { fixture, controller, fake } = await reasoningController();
    try {
      const turn = await controller.submit('接下来应该怎么办');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('NEXT_ACTION_PREPARATION');
      expect(fake.calls[0]!.envelope.requested_output_schema).toBe('next_action_v1');
      const cards = projectResultCards(turn.outcome.result);
      expect(cards.headline).toBe('下一步建议');
      expect(cards.sections.map(item => item.title)).toEqual(['结论', '建议下一步', '依据']);
    } finally {
      fixture.close();
    }
  });

  it('hostile clarification must not collapse 做个复盘 into customer analysis', async () => {
    const { fixture, controller } = await reasoningController({
      semantic: hostileClarificationSemanticRouter(),
    });
    try {
      const turn = await controller.submit('做个复盘');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      if (turn.outcome?.kind !== 'reasoning_result') throw new Error('expected reasoning_result');
      expect(turn.outcome.result.intent_envelope.intent).toBe('INTERACTION_SUMMARY');
      expect(turn.outcome.result.intent_envelope.intent).not.toBe('CUSTOMER_SUMMARY');
    } finally {
      fixture.close();
    }
  });

  it('the three profiles are distinct at instruction, schema, tools, and projection', () => {
    expect(resolveCapabilityRoute('CUSTOMER_SUMMARY').output_schema).toBe('customer_summary_v1');
    expect(resolveCapabilityRoute('INTERACTION_SUMMARY').output_schema).toBe('interaction_summary_v1');
    expect(resolveCapabilityRoute('NEXT_ACTION_PREPARATION').output_schema).toBe('next_action_v1');
    expect(resolveCapabilityRoute('CUSTOMER_SUMMARY').deterministic_tools).not.toEqual(
      resolveCapabilityRoute('INTERACTION_SUMMARY').deterministic_tools,
    );
    const analysis = reasoningTaskInstructionFor('CUSTOMER_SUMMARY');
    const review = reasoningTaskInstructionFor('INTERACTION_SUMMARY');
    const next = reasoningTaskInstructionFor('NEXT_ACTION_PREPARATION');
    expect(analysis).not.toBe(review);
    expect(review).not.toBe(next);
    expect(analysis).not.toBe(next);
    expect(createAgentIntentEnvelope('做个复盘', NOW).intent).toBe('INTERACTION_SUMMARY');
    expect(createAgentIntentEnvelope('接下来应该怎么办', NOW).intent).toBe('NEXT_ACTION_PREPARATION');
  });
});

describe('A2 — customer.create argument truth', () => {
  it('deterministic selector must not treat 老板张总 as the customer name', () => {
    const selected = selectCapabilityDeterministic({
      utterance: '新建一个星河科技客户，老板张总',
      now_iso: NOW,
      scoped_customer_id: null,
    });
    expect(selected.kind).toBe('invoke');
    if (selected.kind !== 'invoke') throw new Error('expected invoke');
    expect(selected.selection.capability_id).toBe('customer.create');
    expect(selected.selection.arguments.name).not.toBe('老板张总');
    expect(selected.selection.arguments.name).not.toBe('广州');
  });

  it('T1 新建一个星河科技客户，老板张总 extracts company then contact', async () => {
    const { fixture, controller } = await createController();
    try {
      const before = (fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;
      const turn = await controller.submit('新建一个星河科技客户，老板张总');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_customer');
      expect(turn.state.latest_proposal?.proposed_values.name).toBe('星河科技');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('张总');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe('老板张总');
      expect((fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c).toBe(before);
    } finally {
      fixture.close();
    }
  });

  it('T2 广州 in the company name is not region', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit('新建一个广州星河科技客户，老板张总');
      expect(turn.state.latest_proposal?.proposed_values.name).toBe('广州星河科技');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('张总');
      expect(turn.state.latest_proposal?.proposed_values.region).not.toBe('广州');
    } finally {
      fixture.close();
    }
  });

  it('T3 对接人 stays contact_person', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit('新建客户广州星河科技，对接人张总');
      expect(turn.state.latest_proposal?.proposed_values.name).toBe('广州星河科技');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('张总');
    } finally {
      fixture.close();
    }
  });

  it('T4 名称广州星河科技 is the company name', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit('新增一个客户，名称广州星河科技');
      expect(turn.state.latest_proposal?.proposed_values.name).toBe('广州星河科技');
    } finally {
      fixture.close();
    }
  });

  it('T5 新增客户，老板张总 must not use the boss title as customer_name', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit('新增客户，老板张总');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe('老板张总');
      expect(turn.state.phase).toBe('clarification');
      expect(`${turn.state.agent_message ?? ''}`).toMatch(/张总|客户名称|新客户叫什么/);
    } finally {
      fixture.close();
    }
  });

  it('T6 新建一个广州客户 must not silently name the customer 广州', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit('新建一个广州客户');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe('广州');
      expect(turn.state.phase).toBe('clarification');
    } finally {
      fixture.close();
    }
  });
});

describe('A3 — user-facing technical leak closure', () => {
  it('default work-process copy hides intent enums, tool ids, and evidence UUIDs', () => {
    const steps = buildAgentWorkProcess({
      customerSelected: true,
      contextLoaded: true,
      memoryCount: 2,
      timelineCount: 3,
      sessionBusy: false,
      result: {
        plan: {
          intent: 'NEXT_ACTION_PREPARATION',
          steps: [{ tool_id: 'get_customer_timeline', customer_id: CUSTOMER_A, access: 'read' }],
          safe_fallback: false,
          customer_id: CUSTOMER_A,
        },
        mode: 'mock',
        provider: 'mock',
        model: 'm',
        tool_trace: [{
          tool_id: 'get_customer_timeline',
          records: [{ id: '1' }],
          evidence_refs: ['11111111-2222-4333-8444-555555555555'],
          read_only: true,
          writes_crm: false,
        }],
        evidence_refs: ['11111111-2222-4333-8444-555555555555'],
        confidence: 0.8,
        response: 'next',
        structured: {
          customer_understanding: '先回拨',
          recent_changes: '未接电话',
          risks_and_opportunities: '实施周期',
          recommended_next_step: ACTION_1,
          evidence_refs: ['11111111-2222-4333-8444-555555555555'],
        },
        requires_human_review: true,
        executable: false,
        writes_crm: false,
      } as never,
      proposal: null,
      confirmationPending: false,
    });
    const visible = steps.map(step => `${step.label}\n${step.detail}`).join('\n');
    expect(visible).not.toMatch(INTERNAL_LEAK);
    expect(visible).not.toMatch(UUID_RE);
    expect(visible).toMatch(/已读取客户资料|已检查最近互动|已读取任务|已读取有效记忆|已完成/);
  });

  it('default confirmation projection hides capability, UUID, policy, and schema names', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit('新建客户广州星河科技，对接人张总');
      const proposal = turn.state.latest_proposal!;
      const visible = projectConfirmationCard(proposal);
      const text = [visible.title, visible.headline, ...visible.summary_lines, visible.footnote, visible.confirm_label, visible.cancel_label]
        .filter(Boolean)
        .join('\n');
      expect(visible.title).toBe('新建客户');
      expect(text).not.toMatch(UUID_RE);
      expect(text).not.toContain('customer.create');
      expect(text).not.toContain('capability_id');
      expect(text).not.toContain('W4-1');
      expect(text).not.toContain('create_customer');
      expect(text).not.toContain('nonce');
    } finally {
      fixture.close();
    }
  });

  it('analysis-process default copy does not dump router/tool/intent internals', () => {
    const workspace = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
    expect(workspace).toContain('查看分析过程');
    expect(workspace).toContain("t('technicalDetails.show')");
    expect(workspace).not.toMatch(/意图：\{result\.plan\.intent\}/);
    expect(workspace).not.toMatch(/工具：\{result\.tool_trace\.map/);
  });
});

describe('A4 — security regression holds', () => {
  it('does not change A10 / Layer-1 / nonce replay files in this batch', () => {
    const authority = readFileSync('src/lib/capabilities/authority/policy.ts', 'utf8');
    expect(authority).toContain('REQUIRE_STRONG_CONFIRMATION');
    const confirmed = readFileSync('src/lib/salesAgentTools/confirmedWrite.ts', 'utf8');
    expect(confirmed).toMatch(/nonce|replay/i);
  });
});
