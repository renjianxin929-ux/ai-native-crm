/**
 * V0.2 FINAL — Create argument integrity + explicit write precedence +
 * confirmation projection closure.
 *
 * REAL ENTRY: SalesAgentInteractionController.submit
 * Hostile seams mimic production foreground: a model that copies the
 * utterance into customer.create name, and a semantic classifier that
 * prefers CUSTOMER_SUMMARY when it does not understand a write.
 *
 * Do not add per-utterance golden maps. If these cases are already green
 * before the production fix, the tests are not on the real path — STOP.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { selectCapabilityDeterministic } from '../lib/planner/deterministicCapabilitySelector';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import type { ModelPlannerRequest } from '../lib/planner/runtimePlanner';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { createAgentIntentEnvelope, isReadOnlyReasoningIntent } from '../lib/salesAgentTools/agentIntentEnvelope';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { projectConfirmationCard } from '../lib/salesAgentUi/userFacingFieldFormatter';
import { t } from '../lib/i18n/appLocale';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';

const NOW = '2026-08-18T14:00:00+08:00';
const EXISTING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EXISTING_NAME = '广州ABC科技有限公司';
const NEW_XINGHE = '广州星河科技';
const NEW_YINHE = '广州银河科技';
const ACTION_1 = '下一个工作日再次联系客户，跟进未接电话';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const INTERNAL_CONFIRM_LEAK = /W4-4|confirmed-write|db\.deleteCustomer|follow_up_records|visit_records|tasks|customer_stage_cards|customer_hypotheses|reviewed_facts|intelligence_imports|capability_id|customer\.delete/i;

afterEach(() => {
  __setDbInstanceForTests(null);
  __resetSessionWriteStateStoreForTests();
});

function customerCount(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'], id?: string): number {
  if (id) {
    return (sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(id) as { c: number }).c;
  }
  return (sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;
}

/**
 * Production-like argument filler: copy the whole instruction into name.
 * Real models do this when they treat “新增客户 / 创建一个客户” as the company name.
 * Contact may still be recognized. This is not a per-sentence golden map.
 */
function hostileUtteranceAsCreateNamePlanner(
  onRequest?: (request: ModelPlannerRequest) => void,
) {
  return async (request: ModelPlannerRequest) => {
    onRequest?.(request);
    const instruction = request.instruction.trim();
    const contact = instruction.match(/(?:联系人|对接人|负责人|老板)\s*(?:是|为)?\s*([^\s，。！？,]+)/)?.[1];
    return {
      kind: 'invoke',
      capability_id: 'customer.create',
      arguments: {
        name: instruction,
        ...(contact ? { contact_person: contact } : {}),
      },
    };
  };
}

function hostileSummarySemanticRouter(): (
  instruction: string,
  envelopeId: string,
) => Promise<SemanticIntentResolution> {
  return async (instruction, envelopeId) => {
    void envelopeId;
    const text = instruction.trim();
    const base = {
      filters: {} as Record<string, string>,
      entities: [] as { type: string; value: string }[],
      scope: EXISTING_ID,
      missing_fields: [] as string[],
      confidence: 0.92,
      clarification_question: null as string | null,
    };
    if (/分析一下|你怎么看/.test(text)) {
      return { ...base, intent: 'CUSTOMER_SUMMARY' };
    }
    if (/接下来我该咋搞|下一步/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
    }
    if (/最近跟他聊得怎么样|复盘/.test(text)) {
      return { ...base, intent: 'INTERACTION_SUMMARY' };
    }
    return { ...base, intent: 'CUSTOMER_SUMMARY' };
  };
}

function emptyWorkspace(customerId: string, name: string) {
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

async function controllerFor(opts?: {
  readonly bindSelected?: boolean;
  readonly withReasoning?: boolean;
  readonly semantic?: (instruction: string, envelopeId: string) => Promise<SemanticIntentResolution>;
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  insertSeededCustomer(fixture.sqlite, {
    id: EXISTING_ID,
    name: EXISTING_NAME,
    region: '广州',
    industry: '软件',
    customer_grade: 'A',
    stage: 'CONTACTED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-08-10T10:00:00+08:00',
    next_follow_up_at: '2026-08-20T10:00:00+08:00',
  });
  __setDbInstanceForTests(fixture.db);
  const plannerRequests: ModelPlannerRequest[] = [];
  const fake = createFakeTrustedHostTransport(async () => ({
    kind: 'success',
    output: {
      customer_understanding: `${EXISTING_NAME} 当前可推进。`,
      recent_changes: '近期有跟进。',
      risks: ['实施周期待确认'],
      opportunities: ['高意向'],
      recommended_next_steps: [ACTION_1],
      evidence_refs: [EXISTING_ID],
      uncertainty: [],
      speculative_claims: [],
      requires_human_review: true,
    },
  }));
  const { snapshot, context, memory } = emptyWorkspace(EXISTING_ID, EXISTING_NAME);
  const session = opts?.withReasoning
    ? new SalesAgentSession(EXISTING_ID, null, () => NOW, {
      snapshot,
      context,
      memory,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'deterministic',
      model_caller: fake.caller,
      loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-08-20T10:00:00+08:00' }),
    })
    : null;
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: () => session,
    clock: () => NOW,
    model_planner: hostileUtteranceAsCreateNamePlanner(request => plannerRequests.push(request)),
    semantic_intent_router: opts?.semantic ?? hostileSummarySemanticRouter(),
  });
  if (opts?.bindSelected !== false) {
    controller.syncExternalScope(EXISTING_ID, EXISTING_NAME);
  }
  return { fixture, controller, plannerRequests, fake };
}

function defaultConfirmationText(proposal: AgentWriteProposal): string {
  const visible = projectConfirmationCard(proposal);
  return [
    visible.title,
    visible.headline,
    ...visible.summary_lines,
    visible.footnote,
    visible.destructive_note,
    visible.confirm_label,
    visible.cancel_label,
    t('technicalDetails.show'),
  ].filter(Boolean).join('\n');
}

function workspaceConfirmationSource(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return readFileSync(path.join(here, '../components/aiNative/SalesAgentInteractionWorkspace.tsx'), 'utf8');
}

describe('PHASE 0 TRACE — prove first wrong seams before the fix', () => {
  it('prints the create / write / confirmation chain for the real foreground utterances', async () => {
    const { fixture, controller, plannerRequests } = await controllerFor();
    try {
      const utteranceA = '新增客户，老板张总';
      const deterministicA = selectCapabilityDeterministic({
        utterance: utteranceA,
        now_iso: NOW,
        scoped_customer_id: EXISTING_ID,
      });
      const beforeA = customerCount(fixture.sqlite);
      const turnA = await controller.submit(utteranceA);
      const traceA = {
        INPUT: utteranceA,
        SELECTED_CUSTOMER: EXISTING_NAME,
        DETERMINISTIC_CAPABILITY: deterministicA.kind === 'invoke' ? deterministicA.selection.capability_id : deterministicA.kind,
        DETERMINISTIC_ARGUMENTS: deterministicA.kind === 'invoke' ? deterministicA.selection.arguments : null,
        MODEL_PLANNER_INPUT: plannerRequests.map(item => ({ instruction: item.instruction, customer_id: item.customer_id })),
        PHASE: turnA.state.phase,
        LAYER1_NAME: turnA.state.latest_proposal?.proposed_values.name ?? null,
        CONTACT: turnA.state.latest_proposal?.proposed_values.contact_person
          ?? (turnA.state.phase === 'clarification' ? turnA.state.agent_message : null),
        CONFIRMATION_NAME: turnA.state.latest_proposal?.proposed_values.name ?? null,
        PRE_CONFIRM_WRITES: customerCount(fixture.sqlite) - beforeA,
      };

      console.log('TRACE_CASE_A', JSON.stringify(traceA, null, 2));

      const utteranceB = '把商机金额改到22万';
      const deterministicB = selectCapabilityDeterministic({
        utterance: utteranceB,
        now_iso: NOW,
        scoped_customer_id: EXISTING_ID,
      });
      const envelopeB = createAgentIntentEnvelope(utteranceB, NOW);
      const { fixture: fixtureB, controller: controllerB, fake } = await controllerFor({ withReasoning: true });
      try {
        const beforeB = customerCount(fixtureB.sqlite);
        const turnB = await controllerB.submit(utteranceB);
        const traceB = {
          INPUT: utteranceB,
          DETERMINISTIC_KIND: deterministicB.kind,
          DETERMINISTIC_CAPABILITY: deterministicB.kind === 'invoke' ? deterministicB.selection.capability_id : null,
          ENVELOPE_MODE: envelopeB.mode,
          ENVELOPE_INTENT: envelopeB.intent,
          READ_ONLY_REASONING: isReadOnlyReasoningIntent(envelopeB),
          PHASE: turnB.state.phase,
          CURRENT_INTENT: turnB.state.current_intent,
          TOOL: turnB.state.latest_proposal?.tool_id ?? null,
          AMOUNT: turnB.state.latest_proposal?.proposed_values.opportunity_amount ?? null,
          REASONING_MODEL_CALLS: fake.calls.length,
          PRE_CONFIRM_WRITES: customerCount(fixtureB.sqlite) - beforeB,
        };

        console.log('TRACE_CASE_B', JSON.stringify(traceB, null, 2));
      } finally {
        fixtureB.close();
      }

      const workspace = workspaceConfirmationSource();
      const traceC = {
        WORKSPACE_DUMPS_PROPOSAL_REASON: workspace.includes('{proposal.reason}'),
        WORKSPACE_RESETS_EXPANDED_ON_PROPOSAL: /setConfirmExpanded\(false\)/.test(workspace),
      };

      console.log('TRACE_CASE_C', JSON.stringify(traceC, null, 2));
    } finally {
      fixture.close();
    }
  });
});

describe('CASE A — customer.create argument integrity', () => {
  it('A1 新增客户，老板张总 clarifies missing name, keeps 张总, no confirmation', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const before = customerCount(fixture.sqlite);
      const turn = await controller.submit('新增客户，老板张总');
      const visible = `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
      expect(turn.state.current_intent).toBe('customer.create');
      expect(turn.state.phase).toBe('clarification');
      expect(turn.state.latest_proposal).toBeNull();
      expect(turn.state.agent_message).toBe('可以。联系人张总已经记下了，新客户叫什么？');
      expect(visible).toContain('可以。联系人张总已经记下了，新客户叫什么？');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe('新增客户');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe('新建客户');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe(EXISTING_NAME);
      expect(customerCount(fixture.sqlite)).toBe(before);
    } finally {
      fixture.close();
    }
  });

  it('A2 广州星河科技 resumes the same pending create and keeps 张总', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const first = await controller.submit('新增客户，老板张总');
      expect(first.state.phase).toBe('clarification');
      const before = customerCount(fixture.sqlite);
      const continued = await controller.submit(NEW_XINGHE);
      expect(continued.state.phase).toBe('proposal');
      expect(continued.state.latest_proposal?.tool_id).toBe('create_customer');
      expect(continued.state.latest_proposal?.proposed_values.name).toBe(NEW_XINGHE);
      expect(continued.state.latest_proposal?.proposed_values.contact_person).toBe('张总');
      expect(continued.state.latest_proposal?.customer_id).not.toBe(EXISTING_ID);
      expect(customerCount(fixture.sqlite)).toBe(before);
    } finally {
      fixture.close();
    }
  });

  it('A3 创建一个客户 广州星河科技 老板张总 splits name/contact and does not use the utterance as name', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('创建一个客户 广州星河科技 老板张总');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.proposed_values.name).toBe(NEW_XINGHE);
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('张总');
      expect(turn.state.latest_proposal?.proposed_values.name).not.toBe('创建一个客户 广州星河科技 老板张总');
      expect(customerCount(fixture.sqlite)).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('A4 新增一个广州银河科技客户，联系人李总 stays correct', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('新增一个广州银河科技客户，联系人李总');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.proposed_values.name).toBe(NEW_YINHE);
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('李总');
      expect(customerCount(fixture.sqlite)).toBe(1);
    } finally {
      fixture.close();
    }
  });
});

describe('CASE B — explicit write precedence', () => {
  it('B1 把商机金额改到22万 is an explicit write, not customer analysis', async () => {
    const { fixture, controller, fake } = await controllerFor({ withReasoning: true });
    try {
      const before = customerCount(fixture.sqlite);
      const turn = await controller.submit('把商机金额改到22万');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
      expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(220000);
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      expect(turn.state.latest_proposal?.customer_id).toBe(EXISTING_ID);
      expect(turn.outcome?.kind).not.toBe('reasoning_result');
      expect(fake.calls).toHaveLength(0);
      expect(customerCount(fixture.sqlite)).toBe(before);
    } finally {
      fixture.close();
    }
  });

  it('B2 分析一下 still uses selected-customer read-only reasoning', async () => {
    const { fixture, controller, fake } = await controllerFor({ withReasoning: true });
    try {
      const turn = await controller.submit('分析一下');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      expect(fake.calls.length).toBeGreaterThan(0);
      expect(turn.state.latest_proposal).toBeNull();
      expect(customerCount(fixture.sqlite, EXISTING_ID)).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('B3 这客户没用了，删了吧 stays STRONG confirmation', async () => {
    const { fixture, controller, fake } = await controllerFor({ withReasoning: true });
    try {
      const turn = await controller.submit('这客户没用了，删了吧');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      expect(customerCount(fixture.sqlite, EXISTING_ID)).toBe(1);
      expect(fake.calls).toHaveLength(0);
    } finally {
      fixture.close();
    }
  });

  it('B regression: 接下来我该咋搞 and 最近跟他聊得怎么样 stay reasoning, not amount write', async () => {
    const { fixture, controller, fake } = await controllerFor({ withReasoning: true });
    try {
      const next = await controller.submit('接下来我该咋搞');
      expect(next.outcome?.kind).toBe('reasoning_result');
      expect(next.state.latest_proposal).toBeNull();
      const review = await controller.submit('最近跟他聊得怎么样');
      expect(review.outcome?.kind).toBe('reasoning_result');
      expect(review.state.latest_proposal).toBeNull();
      expect(fake.calls.length).toBeGreaterThan(0);
    } finally {
      fixture.close();
    }
  });
});

describe('CASE C — confirmation projection leakage', () => {
  it('C1 default delete confirmation hides W4-4 / db.deleteCustomer / UUID / tables', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('这客户没用了，删了吧');
      const proposal = turn.state.latest_proposal!;
      expect(proposal.tool_id).toBe('delete_customer');
      expect(proposal.reason).toMatch(/W4-4/);
      const text = defaultConfirmationText(proposal);
      expect(text).toMatch(/永久删除客户（不可恢复）/);
      expect(text).toContain(EXISTING_NAME);
      expect(text).toContain('取消');
      expect(text).toContain('确认永久删除');
      expect(text).toContain('查看技术细节');
      expect(text).not.toMatch(INTERNAL_CONFIRM_LEAK);
      expect(text).not.toMatch(UUID_RE);
      expect(text).not.toContain(EXISTING_ID);
      const workspace = workspaceConfirmationSource();
      expect(workspace).not.toContain('{proposal.reason}');
      expect(workspace).toMatch(/setConfirmExpanded\(false\)/);
    } finally {
      fixture.close();
    }
  });

  it('C2 technical details remain available as a secondary collapsed surface', async () => {
    const workspace = workspaceConfirmationSource();
    expect(workspace).toContain("t('technicalDetails.show')");
    expect(workspace).toContain('projectConfirmationTechnicalDetails');
  });
});
