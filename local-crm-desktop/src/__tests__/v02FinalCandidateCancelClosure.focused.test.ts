/**
 * V0.2 FINAL — candidate selection Cancel / 取消 UX closure.
 *
 * MAIN PROOF: SalesAgentInteractionController.cancelCandidateSelection +
 * Workspace candidate-stage Cancel wiring. Not startNewConversation.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { TRANSLATION_CATALOG } from '../lib/i18n/catalog';
import { resetAppLocaleForTests, setAppLocale, t } from '../lib/i18n/appLocale';
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
const SEARCH = '找一下广州星河';

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
  resetAppLocaleForTests();
});

type CancelController = SalesAgentInteractionController & {
  cancelCandidateSelection?: () => ReturnType<SalesAgentInteractionController['getState']>;
};

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
    timeWindow: { from: '2026-08-01T00:00:00.000Z', to: NOW },
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
      source_timestamp: '2026-08-09T00:00:00.000Z',
      recorded_at: '2026-08-09T00:00:00.000Z',
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

function crmSnapshot(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite']) {
  return {
    customers: sqlite.prepare('SELECT id, name, next_follow_up_at, opportunity_amount FROM customers ORDER BY id').all(),
    tasks: sqlite.prepare('SELECT id, customer_id, title, status FROM tasks ORDER BY id').all(),
    followUps: sqlite.prepare('SELECT id, customer_id, title FROM follow_up_records ORDER BY id').all(),
  };
}

async function createController() {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  seedCustomer(fixture.sqlite, CUSTOMER_C, CUSTOMER_C_NAME);
  __setDbInstanceForTests(fixture.db);
  let plannerCalls = 0;
  let modelCalls = 0;
  const fake = createFakeTrustedHostTransport(async call => {
    modelCalls += 1;
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
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: (customerId) => sessionFor(
      customerId,
      customerId === CUSTOMER_A ? CUSTOMER_A_NAME : customerId === CUSTOMER_B ? CUSTOMER_B_NAME : CUSTOMER_C_NAME,
      fake.caller,
    ),
    clock: () => NOW,
    model_planner: async () => {
      plannerCalls += 1;
      return { kind: 'invoke', capability_id: 'customer.search', arguments: {} };
    },
    customer_catalog: [
      { id: CUSTOMER_A, name: CUSTOMER_A_NAME },
      { id: CUSTOMER_B, name: CUSTOMER_B_NAME },
      { id: CUSTOMER_C, name: CUSTOMER_C_NAME },
    ],
  }) as CancelController;
  return { fixture, controller, plannerCalls: () => plannerCalls, modelCalls: () => modelCalls };
}

function cancelCandidateSelection(controller: CancelController) {
  if (typeof controller.cancelCandidateSelection !== 'function') {
    throw new Error('cancelCandidateSelection missing');
  }
  return controller.cancelCandidateSelection();
}

function candidateStageBlock(workspace: string): string {
  const start = workspace.indexOf('data-testid="agent-candidate-grid"');
  if (start < 0) return '';
  return workspace.slice(start, start + 2200);
}

describe('V0.2 FINAL — candidate cancel closure', () => {
  it('T1 Cancel is visible during candidate stage; generic optional picker stays hidden', () => {
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    const candidateBlock = candidateStageBlock(workspace);
    expect(resolveUnifiedAgentStageMode({
      sessionBusy: false,
      locatingCustomer: false,
      phase: 'idle',
      candidateCount: 2,
      hasProposal: false,
      hasResult: false,
      hasWriteSuccess: false,
    })).toBe('candidate');
    expect(isGenericOptionalCustomerPickerEnabled('candidate', '')).toBe(false);
    expect(isGenericOptionalCustomerPickerEnabled('input', '')).toBe(true);

    expect(candidateBlock).toContain('data-testid="agent-candidate-grid"');
    expect(candidateBlock).toMatch(/t\(['"]agent\.candidatesTitle['"]\)/);
    expect(candidateBlock).toContain('data-testid="agent-candidate-cancel"');
    expect(candidateBlock).toMatch(/t\(['"]agent\.cancel['"]\)/);
    expect(candidateBlock).not.toMatch(/btn-danger|destructive/);
    expect(candidateBlock).not.toContain('agent-optional-picker');
    expect(candidateBlock).not.toMatch(/locale\s*===\s*['"]en-US['"]/);
    expect(workspace).not.toMatch(/locale\s*===\s*['"]en-US['"]/);
    expect(workspace).toMatch(/isGenericOptionalCustomerPickerEnabled\(stageMode, customerId\)/);

    expect(TRANSLATION_CATALOG['agent.cancel']['zh-CN']).toBe('取消');
    expect(TRANSLATION_CATALOG['agent.cancel']['en-US']).toBe('Cancel');
    setAppLocale('zh-CN', { persist: false });
    expect(t('agent.cancel')).toBe('取消');
    setAppLocale('en-US', { persist: false });
    expect(t('agent.cancel')).toBe('Cancel');
  });

  it('T2 Cancel clears only candidate flow and restores the idle optional picker contract', async () => {
    const { fixture, controller } = await createController();
    try {
      const search = await controller.submit(SEARCH);
      expect(search.state.phase).toBe('awaiting_candidate_selection');
      const ids = search.state.candidate_results.map(item => item.id);
      expect(ids).toEqual(expect.arrayContaining([CUSTOMER_A, CUSTOMER_B]));
      expect(search.state.pending_original_instruction).toBe(SEARCH);
      expect(search.state.scoped_customer_id).toBeNull();

      const cancelled = cancelCandidateSelection(controller);
      expect(cancelled.candidate_results).toEqual([]);
      expect(cancelled.phase).toBe('unscoped');
      expect(cancelled.pending_original_instruction).toBeNull();
      expect(cancelled.pending_session.pending_instruction).toBeNull();
      expect(cancelled.pending_session.candidate_customer_ids).toEqual([]);
      expect(cancelled.pending_session.resume_after_scope).toBe(false);
      expect(cancelled.scoped_customer_id).toBeNull();
      expect(controller.getState().candidate_results).toEqual([]);
      expect(controller.getState().pending_original_instruction).toBeNull();

      const blocked = await controller.selectCandidate(CUSTOMER_A);
      expect(blocked.outcome?.kind).toBe('blocked');
      expect(controller.getState().scoped_customer_id).toBeNull();

      const idleStage = resolveUnifiedAgentStageMode({
        sessionBusy: false,
        locatingCustomer: false,
        phase: 'idle',
        candidateCount: cancelled.candidate_results.length,
        hasProposal: Boolean(cancelled.latest_proposal),
        hasResult: Boolean(cancelled.latest_result) || Boolean(cancelled.latest_direct_answer),
        hasWriteSuccess: false,
      });
      expect(idleStage).toBe('input');
      expect(isGenericOptionalCustomerPickerEnabled(idleStage, cancelled.scoped_customer_id ?? '')).toBe(true);

      const controllerSrc = src('lib/salesAgentTools/interactionController.ts');
      const cancelFn = controllerSrc.slice(
        controllerSrc.indexOf('cancelCandidateSelection'),
        controllerSrc.indexOf('cancelCandidateSelection') + 1800,
      );
      expect(cancelFn).not.toMatch(/startNewConversation\(/);
      expect(cancelFn).not.toMatch(/enterCustomerConversation\(/);
    } finally {
      fixture.close();
    }
  });

  it('T3 Cancel is zero CRM mutation', async () => {
    const { fixture, controller, plannerCalls, modelCalls } = await createController();
    try {
      const before = crmSnapshot(fixture.sqlite);
      const search = await controller.submit(SEARCH);
      expect(search.state.phase).toBe('awaiting_candidate_selection');
      const afterSearch = crmSnapshot(fixture.sqlite);
      expect(afterSearch).toEqual(before);

      const plannerBeforeCancel = plannerCalls();
      const modelBeforeCancel = modelCalls();
      cancelCandidateSelection(controller);
      const after = crmSnapshot(fixture.sqlite);

      console.log(`CRM_WRITE_COUNT=0 customers=${after.customers.length} tasks=${after.tasks.length} followUps=${after.followUps.length}`);
      expect(after).toEqual(before);
      expect(plannerCalls()).toBe(plannerBeforeCancel);
      expect(modelCalls()).toBe(modelBeforeCancel);
      expect(controller.getState().latest_proposal).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it('T4 Cancel cannot accidentally continue the old instruction on another customer', async () => {
    const { fixture, controller, modelCalls } = await createController();
    try {
      const search = await controller.submit(SEARCH);
      expect(search.state.phase).toBe('awaiting_candidate_selection');
      const pending = search.state.pending_original_instruction ?? SEARCH;
      const modelBefore = modelCalls();
      cancelCandidateSelection(controller);

      controller.enterCustomerConversation(CUSTOMER_C, CUSTOMER_C_NAME);
      expect(controller.getState().scoped_customer_id).toBe(CUSTOMER_C);
      expect(controller.getState().pending_original_instruction).toBeNull();

      const continued = await controller.continueAfterBind(pending, CUSTOMER_C);
      expect(continued.outcome?.kind).toBe('blocked');
      expect(controller.getState().latest_result).toBeNull();
      expect(controller.getState().latest_proposal).toBeNull();
      expect(modelCalls()).toBe(modelBefore);

      console.log('CROSS_CUSTOMER_PENDING_EXECUTION_COUNT=0');
    } finally {
      fixture.close();
    }
  });
});
