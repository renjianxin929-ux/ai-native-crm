/**
 * V0.2 FINAL — customer.create selected-scope isolation.
 *
 * MAIN PROOF: SalesAgentInteractionController.submit with the same selected-customer
 * binding the foreground UI uses (syncExternalScope).
 * Do not make the main proof a direct helper/parser/adapter call.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { confirmSalesAgentProposal } from '../components/aiNative/SalesAgentInteractionWorkspace';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests, createCrmRepository } from '../lib/db';
import { selectCapabilityDeterministic } from '../lib/planner/deterministicCapabilitySelector';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import type { ModelPlannerRequest } from '../lib/planner/runtimePlanner';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-08-18T14:00:00+08:00';
const EXISTING_ID = 'existing_customer_A';
const EXISTING_NAME = '广州ABC科技有限公司';
const NEW_NAME = '广州星河科技';
const FORBIDDEN_CREATE_NAMES = ['新增客户', '新增一个客户', '老板张总', EXISTING_NAME] as const;
const SCHEMA_LEAK = /\b(?:missing_fields|capability_id|customer\.create|selected_customer_id|clarification_answer)\b/;

afterEach(() => {
  __setDbInstanceForTests(null);
  __resetSessionWriteStateStoreForTests();
});

function customerCount(sqlite: ReturnType<typeof sqliteFixture>['sqlite'], id?: string): number {
  if (id) {
    return (sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(id) as { c: number }).c;
  }
  return (sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;
}

/**
 * Test-only Trusted Host planner.
 * Mirrors production prompt semantics (老板/对接人/联系人 → contact_person).
 * If the controller forwards a selected-customer id into create argument planning,
 * this planner inherits that identity — the same contamination a real model can
 * produce when the prompt says 当前客户ID=<selected>.
 * No phrase-specific regex for “新增客户，老板张总”.
 */
function scopeAwareCreatePlanner(
  onRequest?: (request: ModelPlannerRequest) => void,
) {
  return async (request: ModelPlannerRequest, signal?: AbortSignal) => {
    onRequest?.(request);
    const caller = createTrustedHostModelPlannerCaller(async ({ user }) => {
      const instruction = user.split('指令：').pop()?.trim() ?? user;
      const forwarded = /当前客户ID=(\(无\)|[^\s。]+)/.exec(user)?.[1];
      const forwardedId = forwarded && forwarded !== '(无)' ? forwarded : null;
      const extracted = extractCreateArgsFromUtterance(instruction);
      if (forwardedId) {
        return JSON.stringify({
          kind: 'invoke',
          capability_id: 'customer.create',
          arguments: {
            ...extracted,
            name: EXISTING_NAME,
            customer_id: forwardedId,
          },
        });
      }
      if (typeof extracted.name === 'string' && extracted.name.trim()) {
        return JSON.stringify({
          kind: 'invoke',
          capability_id: 'customer.create',
          arguments: extracted,
        });
      }
      return JSON.stringify({
        kind: 'invoke',
        capability_id: 'customer.create',
        arguments: extracted,
      });
    });
    return caller(request, signal);
  };
}

function extractCreateArgsFromUtterance(instruction: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const contact = instruction.match(/(?:联系人|对接人|负责人|老板)\s*(?:是|为)?\s*([^\s，。！？]{1,20})/);
  if (contact?.[1]) args.contact_person = contact[1];
  const leftover = instruction
    .replace(/(?:联系人|对接人|负责人|老板)\s*(?:是|为)?\s*[^\s，。！？]{1,20}/g, ' ')
    .replace(/(?:新建|新增|创建|登记|录入)(?:一个|一名|一家)?/g, ' ')
    .replace(/(?:客户|企业|公司)/g, ' ')
    .replace(/名称/g, ' ')
    .replace(/[，,：:。！？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (leftover.length >= 2) args.name = leftover;
  return args;
}

function seedExistingCustomer(sqlite: ReturnType<typeof sqliteFixture>['sqlite']) {
  sqlite.prepare(
    "INSERT INTO customers (id,name,customer_grade,stage,intent_level,contact_person,region,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(EXISTING_ID, EXISTING_NAME, 'A', 'CONTACTED', 'HIGH', '原联系人', '广州', NOW, NOW);
}

async function controllerFor(opts?: { readonly bindSelected?: boolean }) {
  const fixture = sqliteFixture();
  await fixture.initialize();
  seedExistingCustomer(fixture.sqlite);
  __setDbInstanceForTests(fixture.db);
  const plannerRequests: ModelPlannerRequest[] = [];
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: () => null,
    clock: () => NOW,
    model_planner: scopeAwareCreatePlanner(request => plannerRequests.push(request)),
  });
  if (opts?.bindSelected !== false) {
    controller.syncExternalScope(EXISTING_ID, EXISTING_NAME);
  }
  return { fixture, controller, plannerRequests };
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

function assertForbiddenCreateName(name: unknown) {
  expect(FORBIDDEN_CREATE_NAMES).not.toContain(name);
}

describe('V0.2 foreground — customer.create selected-scope isolation', () => {
  it('TRACE T1 chain: selected ABC + 新增客户，老板张总', async () => {
    const { fixture, controller, plannerRequests } = await controllerFor();
    try {
      const deterministic = selectCapabilityDeterministic({
        utterance: '新增客户，老板张总',
        now_iso: NOW,
        scoped_customer_id: EXISTING_ID,
      });
      const before = customerCount(fixture.sqlite);
      const turn = await controller.submit('新增客户，老板张总');
      const proposal = turn.state.latest_proposal;
      const trace = {
        controller_input: '新增客户，老板张总',
        selected_customer_scope: { id: controller.getState().scoped_customer_id, name: controller.getState().scoped_customer_name },
        deterministic_kind: deterministic.kind,
        deterministic_capability: deterministic.kind === 'invoke' ? deterministic.selection.capability_id : null,
        deterministic_arguments: deterministic.kind === 'invoke' ? deterministic.selection.arguments : null,
        model_planner_calls: plannerRequests.map(item => ({
          instruction: item.instruction,
          customer_id: item.customer_id,
        })),
        phase: turn.state.phase,
        current_intent: turn.state.current_intent,
        agent_message: turn.state.agent_message,
        proposal_name: proposal?.proposed_values.name ?? null,
        proposal_contact: proposal?.proposed_values.contact_person ?? null,
        proposal_customer_id: proposal?.customer_id ?? null,
        pre_confirm_writes: customerCount(fixture.sqlite) - before,
      };
      // eslint-disable-next-line no-console
      console.log('TRACE_T1_CUSTOMER_CREATE_SCOPE', JSON.stringify(trace, null, 2));
      expect(trace.deterministic_capability).toBe('customer.create');
    } finally {
      fixture.close();
    }
  });

  it('T1 selected customer must not contaminate create; missing name stays missing', async () => {
    const { fixture, controller, plannerRequests } = await controllerFor();
    try {
      const before = customerCount(fixture.sqlite);
      const turn = await controller.submit('新增客户，老板张总');
      const visible = `${turn.state.agent_message ?? ''}\n${turn.state.resolution_reason ?? ''}`;
      const proposal = turn.state.latest_proposal;
      expect(turn.state.current_intent).toBe('customer.create');
      expect(turn.state.phase).toBe('clarification');
      expect(proposal).toBeNull();
      expect(visible).toMatch(/张总/);
      expect(visible).toMatch(/叫什么|客户名称|新客户/);
      expect(visible).not.toMatch(SCHEMA_LEAK);
      expect(visible).not.toMatch(/请.*重复|重新说一遍|把全部信息再/);
      for (const request of plannerRequests) {
        expect(request.customer_id).not.toBe(EXISTING_ID);
      }
      if (proposal) {
        assertForbiddenCreateName(proposal.proposed_values.name);
        expect(proposal.customer_id).not.toBe(EXISTING_ID);
      }
      expect(controller.getState().scoped_customer_id).toBe(EXISTING_ID);
      expect(controller.getState().scoped_customer_name).toBe(EXISTING_NAME);
      expect(customerCount(fixture.sqlite)).toBe(before);
    } finally {
      fixture.close();
    }
  });

  it('T2 same pending create resumes with 广州星河科技 and keeps 张总', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const first = await controller.submit('新增客户，老板张总');
      expect(first.state.phase).toBe('clarification');
      const before = customerCount(fixture.sqlite);
      const continued = await controller.submit('广州星河科技');
      expect(continued.state.phase).toBe('proposal');
      const proposal = continued.state.latest_proposal;
      expect(proposal?.tool_id).toBe('create_customer');
      expect(proposal?.proposed_values.name).toBe(NEW_NAME);
      expect(proposal?.proposed_values.contact_person).toBe('张总');
      expect(proposal?.proposed_values.clarification_answer).toBeUndefined();
      expect(proposal?.customer_id).not.toBe(EXISTING_ID);
      assertForbiddenCreateName(proposal?.proposed_values.name);
      expect(continued.state.scoped_customer_id).toBe(EXISTING_ID);
      expect(continued.state.scoped_customer_name).toBe(EXISTING_NAME);
      expect(JSON.stringify(proposal)).not.toContain('clarification_answer');
      expect(customerCount(fixture.sqlite)).toBe(before);
      expect(customerCount(fixture.sqlite, EXISTING_ID)).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('T3 confirm creates only the new customer; ABC is unchanged', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('新增客户，老板张总');
      const continued = await controller.submit('广州星河科技');
      const proposal = continued.state.latest_proposal!;
      expect(customerCount(fixture.sqlite)).toBe(1);
      const boundary = createApprovedCrmWriteBoundary(createCrmRepository(fixture.db, () => SALES_AGENT_APP_CLOCK.now()));
      const confirmSession = new SalesAgentSession(EXISTING_ID, null, () => SALES_AGENT_APP_CLOCK.now());
      await confirmSalesAgentProposal(confirmSession, proposal, async () => undefined, boundary);
      const rows = fixture.sqlite.prepare('SELECT id, name, contact_person FROM customers ORDER BY name').all() as {
        id: string; name: string; contact_person: string | null;
      }[];
      expect(rows).toHaveLength(2);
      const existing = rows.find(row => row.id === EXISTING_ID);
      const created = rows.find(row => row.id !== EXISTING_ID);
      expect(existing?.name).toBe(EXISTING_NAME);
      expect(existing?.contact_person).toBe('原联系人');
      expect(created?.name).toBe(NEW_NAME);
      expect(created?.contact_person).toBe('张总');
      expect(created?.id).not.toBe(EXISTING_ID);
      expect(proposal.customer_id).toBe(created?.id);
    } finally {
      fixture.close();
    }
  });

  it('T4 分析一下 still uses selected ABC customer', async () => {
    const fixture = sqliteFixture();
    await fixture.initialize();
    seedExistingCustomer(fixture.sqlite);
    __setDbInstanceForTests(fixture.db);
    const { snapshot, context, memory } = emptyWorkspace(EXISTING_ID, EXISTING_NAME);
    const fake = createFakeTrustedHostTransport(async () => ({
      kind: 'success',
      output: {
        customer_understanding: `${EXISTING_NAME} 当前可推进。`,
        recent_changes: '近期有跟进。',
        risks: ['实施周期待确认'],
        opportunities: ['高意向'],
        recommended_next_steps: ['回拨确认需求'],
        evidence_refs: [EXISTING_ID],
        uncertainty: [],
        speculative_claims: [],
        requires_human_review: true,
      },
    }));
    const session = new SalesAgentSession(EXISTING_ID, null, () => NOW, {
      snapshot,
      context,
      memory,
      profile_id: 'foreign_trade_geo',
      planning_mode: 'deterministic',
      model_caller: fake.caller,
      loadCustomerSnapshot: async () => ({ next_follow_up_at: null }),
    });
    const controller = new SalesAgentInteractionController({
      db: fixture.db,
      createSession: () => session,
      clock: () => NOW,
      semantic_intent_router: async (): Promise<SemanticIntentResolution> => ({
        intent: 'CUSTOMER_SUMMARY',
        filters: {},
        entities: [],
        scope: EXISTING_ID,
        missing_fields: [],
        confidence: 0.92,
        clarification_question: null,
      }),
      model_planner: scopeAwareCreatePlanner(),
    });
    controller.syncExternalScope(EXISTING_ID, EXISTING_NAME);
    try {
      const turn = await controller.submit('分析一下');
      expect(turn.outcome?.kind).toBe('reasoning_result');
      expect(fake.calls[0]?.envelope.customer_id).toBe(EXISTING_ID);
      expect(`${turn.state.agent_message ?? ''}`).toContain(EXISTING_NAME);
      expect(turn.state.scoped_customer_id).toBe(EXISTING_ID);
      expect(customerCount(fixture.sqlite, EXISTING_ID)).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('T5 把商机金额改成21万 still targets selected ABC', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('把商机金额改成21万');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('update_opportunity_amount');
      expect(turn.state.latest_proposal?.customer_id).toBe(EXISTING_ID);
      expect(turn.state.latest_proposal?.proposed_values.opportunity_amount).toBe(210000);
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      expect(previewAuthorityForSelection('customer.opportunity_amount.update')).toBe('REQUIRE_CONFIRMATION');
      expect(customerCount(fixture.sqlite, EXISTING_ID)).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('T6 这客户没用了，删了吧 stays STRONG on selected ABC', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('这客户没用了，删了吧');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('delete_customer');
      expect(turn.state.latest_proposal?.customer_id).toBe(EXISTING_ID);
      expect(previewAuthorityForSelection('customer.delete')).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(turn.state.latest_proposal?.requires_confirmation).toBe(true);
      expect(customerCount(fixture.sqlite, EXISTING_ID)).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('T7 complete create name must not use selected ABC', async () => {
    const { fixture, controller, plannerRequests } = await controllerFor();
    try {
      const before = customerCount(fixture.sqlite);
      const turn = await controller.submit('新增一个广州星河科技客户，联系人张总');
      expect(turn.state.phase).toBe('proposal');
      const proposal = turn.state.latest_proposal;
      expect(proposal?.tool_id).toBe('create_customer');
      expect(proposal?.proposed_values.name).toBe(NEW_NAME);
      expect(proposal?.proposed_values.contact_person).toBe('张总');
      expect(proposal?.customer_id).not.toBe(EXISTING_ID);
      assertForbiddenCreateName(proposal?.proposed_values.name);
      expect(plannerRequests.every(item => item.customer_id !== EXISTING_ID)).toBe(true);
      expect(turn.state.scoped_customer_id).toBe(EXISTING_ID);
      expect(customerCount(fixture.sqlite)).toBe(before);
    } finally {
      fixture.close();
    }
  });

  it('T8 新增客户，广州星河科技 extracts company name only', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      const turn = await controller.submit('新增客户，广州星河科技');
      expect(turn.state.phase).toBe('proposal');
      const name = turn.state.latest_proposal?.proposed_values.name;
      expect(name).toBe(NEW_NAME);
      expect(name).not.toBe('新增客户，广州星河科技');
      expect(name).not.toBe(EXISTING_NAME);
      expect(turn.state.latest_proposal?.customer_id).not.toBe(EXISTING_ID);
      expect(customerCount(fixture.sqlite)).toBe(1);
    } finally {
      fixture.close();
    }
  });

  it('T9 no selected customer still clarifies 老板张总 without inventing a name', async () => {
    const { fixture, controller, plannerRequests } = await controllerFor({ bindSelected: false });
    try {
      expect(controller.getState().scoped_customer_id).toBeNull();
      const before = customerCount(fixture.sqlite);
      const turn = await controller.submit('新增客户，老板张总');
      expect(turn.state.phase).toBe('clarification');
      expect(turn.state.latest_proposal).toBeNull();
      expect(`${turn.state.agent_message ?? ''}`).toMatch(/张总/);
      expect(`${turn.state.agent_message ?? ''}`).not.toMatch(SCHEMA_LEAK);
      expect(plannerRequests.every(item => item.customer_id == null || item.customer_id === '')).toBe(true);
      expect(customerCount(fixture.sqlite)).toBe(before);
    } finally {
      fixture.close();
    }
  });
});

describe('helper — deterministic create does not invent a name from 老板张总', () => {
  it('selects customer.create with name missing', () => {
    const selected = selectCapabilityDeterministic({
      utterance: '新增客户，老板张总',
      now_iso: NOW,
      scoped_customer_id: EXISTING_ID,
    });
    expect(selected.kind).toBe('invoke');
    if (selected.kind !== 'invoke') throw new Error('expected invoke');
    expect(selected.selection.capability_id).toBe('customer.create');
    expect(selected.selection.arguments.name).toBeUndefined();
    expect(selected.selection.arguments.name).not.toBe('老板张总');
    expect(selected.selection.arguments.name).not.toBe(EXISTING_NAME);
  });
});
