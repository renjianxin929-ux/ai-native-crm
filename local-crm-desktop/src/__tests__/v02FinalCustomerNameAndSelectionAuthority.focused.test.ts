/**
 * V0.2 FINAL — customer.create name truth + candidate selection authority.
 *
 * MAIN PROOF: SalesAgentInteractionController.submit / selectCandidate /
 * enterCustomerConversation / continueAfterBind.
 * Do not make the main proof a helper-only parser call.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import {
  extractCreateCustomerName,
  extractCreateContactPerson,
} from '../lib/planner/customerCreateArgumentIntegrity';
import { selectCapabilityDeterministic } from '../lib/planner/deterministicCapabilitySelector';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';
import {
  isGenericOptionalCustomerPickerEnabled,
  resolveUnifiedAgentStageMode,
} from '../lib/salesAgentUi/stageMode';

const NOW = '2026-08-19T10:00:00+08:00';
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CUSTOMER_A = 'gz-xinghe';
const CUSTOMER_A_NAME = '广州星河科技';
const CUSTOMER_B = 'gz-xinghewan';
const CUSTOMER_B_NAME = '广州星河湾科技有限公司';
const CUSTOMER_C = 'gz-abc';
const CUSTOMER_C_NAME = '广州ABC科技有限公司';

const INPUT_1 = '创建一个广州星河湾科技有限公司 老板王总';
const INPUT_2 = '新增一家客户成功科技有限公司 联系人李总';
const INPUT_3 = '新增一家企业微信服务有限公司 联系人李总';
const INPUT_4 = '创建一个客户 广州星河科技 老板王总';
const INPUT_5 = '新增客户 广州银河科技 联系人张总';

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
});

function src(rel: string): string {
  return readFileSync(resolve(SRC_ROOT, rel), 'utf8');
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
    industry: '科技',
    customer_grade: 'A',
    stage: 'NEW_LEAD',
    intent_level: 'HIGH',
    last_contacted_at: '2026-08-17T21:51:50+08:00',
    next_follow_up_at: '2026-08-20T10:00:00+08:00',
  });
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
      source_timestamp: '2026-07-09T00:00:00.000Z',
      recorded_at: '2026-07-09T00:00:00.000Z',
    }],
  });
  return { snapshot, context, memory };
}

function sessionFor(customerId: string, name: string, modelCaller?: ReturnType<typeof createFakeTrustedHostTransport>['caller']) {
  const { snapshot, context, memory } = emptyWorkspace(customerId, name);
  return new SalesAgentSession(customerId, null, () => NOW, {
    snapshot,
    context,
    memory,
    planning_mode: 'deterministic',
    model_caller: modelCaller,
  });
}

async function createController(opts?: {
  readonly seedSearchCustomers?: boolean;
  readonly modelPlanner?: SalesAgentInteractionController['modelPlanner'];
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  if (opts?.seedSearchCustomers) {
    seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
    seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
    seedCustomer(fixture.sqlite, CUSTOMER_C, CUSTOMER_C_NAME);
  }
  __setDbInstanceForTests(fixture.db);
  const fake = createFakeTrustedHostTransport(async call => {
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    return {
      kind: 'success',
      output: {
        customer_understanding: '客户当前推进顺利。',
        recent_changes: '最近互动已记录。',
        risks: [],
        opportunities: ['已建立联系'],
        recommended_next_steps: ['下周五再次联系'],
        evidence_refs: ids.length > 0 ? ids.slice(0, 2) : [CUSTOMER_C],
        uncertainty: [],
        speculative_claims: [],
        requires_human_review: true,
      },
    };
  });
  let plannerCalls = 0;
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: (customerId) => sessionFor(customerId, customerId === CUSTOMER_A ? CUSTOMER_A_NAME : customerId === CUSTOMER_B ? CUSTOMER_B_NAME : CUSTOMER_C_NAME, fake.caller),
    clock: () => NOW,
    model_planner: opts?.modelPlanner ?? (async request => {
      plannerCalls += 1;
      return {
        kind: 'invoke',
        capability_id: 'customer.create',
        arguments: {
          name: request.instruction.includes('星河湾') ? '广州星河湾科技有限公司' : 'SHOULD_NOT_BE_USED',
          contact_person: '王总',
        },
      };
    }),
    customer_catalog: [
      { id: CUSTOMER_A, name: CUSTOMER_A_NAME },
      { id: CUSTOMER_B, name: CUSTOMER_B_NAME },
      { id: CUSTOMER_C, name: CUSTOMER_C_NAME },
    ],
  });
  return { fixture, controller, plannerCalls: () => plannerCalls, fake };
}

function customerCount(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'], id?: string): number {
  if (id) {
    return (sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(id) as { c: number }).c;
  }
  return (sqlite.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;
}

describe('TEST GROUP A — customer.create name integrity', () => {
  it('T1 创建一个广州星河湾科技有限公司 老板王总 keeps 有限公司 and 王总', async () => {
    const { fixture, controller, plannerCalls } = await createController();
    try {
      const before = customerCount(fixture.sqlite);
      const selected = selectCapabilityDeterministic({
        utterance: INPUT_1,
        now_iso: NOW,
        scoped_customer_id: null,
      });
      const turn = await controller.submit(INPUT_1);
      const name = turn.state.latest_proposal?.proposed_values.name;
      const contact = turn.state.latest_proposal?.proposed_values.contact_person;

      console.log([
        'FAIL_FIRST_T1_CUSTOMER_NAME',
        `INPUT=${INPUT_1}`,
        `DETERMINISTIC_CAPABILITY=${selected.kind === 'invoke' ? selected.selection.capability_id : selected.kind}`,
        `DETERMINISTIC_NAME=${selected.kind === 'invoke' ? String(selected.selection.arguments.name ?? '') : ''}`,
        `MODEL_PLANNER_CALLS=${plannerCalls()}`,
        `PHASE=${turn.state.phase}`,
        `ACTUAL_NAME=${String(name ?? '')}`,
        `ACTUAL_CONTACT=${String(contact ?? '')}`,
        `PRE_CONFIRM_WRITES=${customerCount(fixture.sqlite) - before}`,
      ].join('\n'));
      expect(selected.kind).toBe('invoke');
      if (selected.kind === 'invoke') {
        expect(selected.selection.capability_id).toBe('customer.create');
        expect(selected.selection.arguments.name).toBeUndefined();
      }
      expect(turn.state.current_intent).toBe('customer.create');
      expect(turn.state.phase).toBe('proposal');
      expect(turn.state.latest_proposal?.tool_id).toBe('create_customer');
      expect(name).toBe('广州星河湾科技有限公司');
      expect(contact).toBe('王总');
      expect(name).not.toBe('广州星河湾科技有限');
      expect(contact).not.toBe('老板王总');
      expect(String(name)).not.toContain('创建');
      expect(plannerCalls()).toBe(0);
      expect(customerCount(fixture.sqlite)).toBe(before);
    } finally {
      fixture.close();
    }
  });

  it('T2 客户成功科技有限公司 keeps 客户 inside the legal name', async () => {
    const { fixture, controller } = await createController();
    try {
      const selected = selectCapabilityDeterministic({
        utterance: INPUT_2,
        now_iso: NOW,
        scoped_customer_id: null,
      });
      const turn = await controller.submit(INPUT_2);
      const name = turn.state.latest_proposal?.proposed_values.name;

      console.log([
        'FAIL_FIRST_T2_CUSTOMER_SUCCESS',
        `DETERMINISTIC_NAME=${selected.kind === 'invoke' ? String(selected.selection.arguments.name ?? '') : ''}`,
        `ACTUAL_NAME=${String(name ?? '')}`,
      ].join('\n'));
      expect(selected.kind).toBe('invoke');
      if (selected.kind === 'invoke') {
        expect(selected.selection.capability_id).toBe('customer.create');
        expect(selected.selection.arguments.name).toBeUndefined();
      }
      expect(name).toBe('客户成功科技有限公司');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('李总');
      expect(name).not.toBe('成功科技有限公司');
      expect(name).not.toBe('成功科技有限');
    } finally {
      fixture.close();
    }
  });

  it('T3 企业微信服务有限公司 keeps 企业 and 公司', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit(INPUT_3);
      const name = turn.state.latest_proposal?.proposed_values.name;

      console.log(`FAIL_FIRST_T3_WECOM_NAME ACTUAL_NAME=${String(name ?? '')}`);
      expect(name).toBe('企业微信服务有限公司');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('李总');
      expect(name).not.toBe('微信服务有限公司');
      expect(name).not.toBe('微信服务有限');
    } finally {
      fixture.close();
    }
  });

  it('T4 leading structural marker 客户 can be stripped', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit(INPUT_4);
      expect(turn.state.latest_proposal?.proposed_values.name).toBe('广州星河科技');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('王总');
    } finally {
      fixture.close();
    }
  });

  it('T5 新增客户 广州银河科技 strips the command marker only', async () => {
    const { fixture, controller } = await createController();
    try {
      const turn = await controller.submit(INPUT_5);
      expect(turn.state.latest_proposal?.proposed_values.name).toBe('广州银河科技');
      expect(turn.state.latest_proposal?.proposed_values.contact_person).toBe('张总');
    } finally {
      fixture.close();
    }
  });

  it('supporting: sanitizer uses structural markers, not global entity-word deletion', () => {
    expect(extractCreateCustomerName(INPUT_1)).toBe('广州星河湾科技有限公司');
    expect(extractCreateContactPerson(INPUT_1)).toBe('王总');
    expect(extractCreateCustomerName(INPUT_2)).toBe('客户成功科技有限公司');
    expect(extractCreateCustomerName(INPUT_3)).toBe('企业微信服务有限公司');
    expect(extractCreateCustomerName(INPUT_4)).toBe('广州星河科技');
    expect(extractCreateCustomerName(INPUT_5)).toBe('广州银河科技');
    expect(extractCreateCustomerName('新建客户广州星河科技，对接人张总')).toBe('广州星河科技');
    const integrity = src('lib/planner/customerCreateArgumentIntegrity.ts');
    expect(integrity).not.toMatch(/ENTITY_WORD/);
    expect(integrity).not.toMatch(/replace\(\/\(\?:客户\|企业\|公司\)\/g/);
    const selector = src('lib/planner/deterministicCapabilitySelector.ts');
    expect(selector).not.toMatch(/if \(name && contact\) args\.name = name/);
  });
});

describe('TEST GROUP B — single customer selection authority', () => {
  it('T6 generic optional picker is not operable during candidate stage', () => {
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    const stageMode = src('lib/salesAgentUi/stageMode.ts');
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false,
      locatingCustomer: false,
      phase: 'idle',
      candidateCount: 2,
      hasProposal: false,
      hasResult: false,
      hasWriteSuccess: false,
    })).toBe('candidate');
    expect(stageMode).toMatch(/isGenericOptionalCustomerPickerEnabled/);
    expect(workspace).toMatch(/isGenericOptionalCustomerPickerEnabled/);
    expect(isGenericOptionalCustomerPickerEnabled('candidate', '')).toBe(false);
    expect(isGenericOptionalCustomerPickerEnabled('portfolio', '')).toBe(false);
    expect(isGenericOptionalCustomerPickerEnabled('input', '')).toBe(true);
    const pickerBlock = workspace.slice(
      workspace.indexOf('agent-optional-picker'),
      workspace.indexOf('agent-optional-picker') + 1600,
    );
    expect(pickerBlock).toMatch(/isGenericOptionalCustomerPickerEnabled/);
  });

  it('T7 clicking candidate A goes through selectCandidate and the candidateIds guard', async () => {
    const { fixture, controller } = await createController({ seedSearchCustomers: true });
    try {
      const search = await controller.submit('找一下广州星河');
      expect(search.state.phase).toBe('awaiting_candidate_selection');
      const ids = search.state.candidate_results.map(item => item.id);
      expect(ids).toEqual(expect.arrayContaining([CUSTOMER_A, CUSTOMER_B]));
      expect(ids).not.toContain(CUSTOMER_C);
      const pending = search.state.pending_original_instruction;
      const selected = await controller.selectCandidate(CUSTOMER_A);
      expect(selected.event.type).toBe('bind_required');
      if (selected.event.type !== 'bind_required') throw new Error('expected bind');
      expect(selected.event.customer_id).toBe(CUSTOMER_A);
      expect(selected.event.continue_prompt).toBeTruthy();
      expect(controller.getState().pending_original_instruction ?? pending).toBeTruthy();
    } finally {
      fixture.close();
    }
  });

  it('T8 generic/manual path must not execute the pending instruction on non-candidate C', async () => {
    const { fixture, controller } = await createController({ seedSearchCustomers: true });
    try {
      const beforeC = customerCount(fixture.sqlite, CUSTOMER_C);
      const search = await controller.submit('找一下广州星河');
      expect(search.state.phase).toBe('awaiting_candidate_selection');
      const pending = search.state.pending_original_instruction;
      const blocked = await controller.selectCandidate(CUSTOMER_C);
      expect(blocked.outcome?.kind).toBe('blocked');
      expect(controller.getState().phase).toBe('awaiting_candidate_selection');
      expect(controller.getState().pending_original_instruction).toBe(pending);
      expect(controller.getState().scoped_customer_id).not.toBe(CUSTOMER_C);

      controller.enterCustomerConversation(CUSTOMER_C, CUSTOMER_C_NAME);
      expect(controller.getState().scoped_customer_id).toBe(CUSTOMER_C);
      expect(controller.getState().pending_original_instruction).toBeNull();
      expect(controller.getState().latest_proposal).toBeNull();
      expect(controller.getState().latest_result).toBeNull();
      expect(controller.getState().candidate_results).toEqual([]);
      const continued = await controller.continueAfterBind(pending ?? '找一下广州星河', CUSTOMER_C);
      expect(continued.outcome?.kind).toBe('blocked');
      expect(controller.getState().latest_proposal).toBeNull();
      expect(customerCount(fixture.sqlite, CUSTOMER_C)).toBe(beforeC);
    } finally {
      fixture.close();
    }
  });

  it('T9 candidate mode ending restores the generic optional picker contract', () => {
    expect(isGenericOptionalCustomerPickerEnabled('candidate', '')).toBe(false);
    expect(isGenericOptionalCustomerPickerEnabled('input', '')).toBe(true);
    expect(isGenericOptionalCustomerPickerEnabled('result', '')).toBe(true);
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    expect(workspace).toContain('data-testid="agent-optional-customer"');
    expect(workspace).toMatch(/isGenericOptionalCustomerPickerEnabled\(stageMode, customerId\)/);
  });

  it('T10 unscoped Agent idle still has the generic optional picker', () => {
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    expect(workspace).toContain('data-testid="agent-optional-customer"');
    expect(workspace).toContain('onBindCustomer(item.id)');
    expect(workspace).toContain('agent-optional-picker');
    expect(isGenericOptionalCustomerPickerEnabled('input', '')).toBe(true);
    expect(isGenericOptionalCustomerPickerEnabled('input', CUSTOMER_A)).toBe(false);
  });

  it('T11 human navigation A → B still starts a fresh customer conversation', async () => {
    const { fixture, controller } = await createController({ seedSearchCustomers: true });
    try {
      controller.enterCustomerConversation(CUSTOMER_A, CUSTOMER_A_NAME);
      const first = await controller.submit('总结一下最近情况');
      expect(first.outcome?.kind).toBe('reasoning_result');
      expect(controller.getState().scoped_customer_id).toBe(CUSTOMER_A);
      expect(controller.getState().latest_result).not.toBeNull();
      controller.enterCustomerConversation(CUSTOMER_B, CUSTOMER_B_NAME);
      const next = controller.getState();
      expect(next.scoped_customer_id).toBe(CUSTOMER_B);
      expect(next.last_reasoning_action_context).toBeNull();
      expect(next.latest_result).toBeNull();
      expect(next.pending_original_instruction).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it('T12 internal bind continuation still works', async () => {
    const { fixture, controller } = await createController({ seedSearchCustomers: true });
    try {
      const before = customerCount(fixture.sqlite, CUSTOMER_C);
      const locating = await controller.submit('打开广州ABC科技有限公司，然后总结一下最近情况');
      expect(locating.event.type).toBe('bind_required');
      if (locating.event.type !== 'bind_required') throw new Error('expected bind');
      expect(locating.event.customer_id).toBe(CUSTOMER_C);
      expect(locating.state.phase).not.toBe('awaiting_candidate_selection');
      const pending = locating.state.pending_original_instruction;
      controller.syncExternalScope(CUSTOMER_C, CUSTOMER_C_NAME);
      expect(controller.getState().pending_original_instruction).toBe(pending);
      const continued = await controller.continueAfterBind(locating.event.continue_prompt, CUSTOMER_C);
      expect(continued.outcome?.kind).toBe('reasoning_result');
      expect(continued.state.scoped_customer_id).toBe(CUSTOMER_C);
      expect(customerCount(fixture.sqlite, CUSTOMER_C)).toBe(before);
    } finally {
      fixture.close();
    }
  });
});
