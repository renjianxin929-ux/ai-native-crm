/**
 * V0.2 FINAL — Conversation Scope Isolation + Localization & i18n.
 *
 * TEST FIRST. Do not invent a second conversation engine or i18n framework.
 *
 * P1 REAL SEAMS:
 *   Human navigation → enterCustomerConversation (fresh transient session)
 *   Agent internal bind → syncExternalScope + continueAfterBind (preserve instruction)
 *   UI pendingContinue / pendingUserSubmit must be customer-bound
 *
 * P2 REAL SEAMS:
 *   Locale Source of Truth + typed catalog + user-facing projection
 *   Capability / DB / A10 / nonce remain language-invariant
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { previewAuthorityForSelection } from '../lib/planner/capabilitySelectionRouter';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import type { SemanticIntentResolution } from '../lib/salesAgentTools/agentIntentEnvelope';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';
import {
  formatProposalValues,
  projectClarificationQuestion,
  projectConfirmationCard,
  projectConfirmationTechnicalDetails,
} from '../lib/salesAgentUi/userFacingFieldFormatter';
import { projectResultCards } from '../lib/salesAgentUi/resultCards';
import { buildAgentWorkProcess } from '../lib/salesAgentUi/workProcess';
import { mapUserExecutionState } from '../lib/salesAgentUi/executionState';
import { resetAppLocaleForTests } from '../lib/i18n/appLocale';
import type { AgentSessionResult } from '../lib/salesAgentTools/agentSession';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const CUSTOMER_B = 'gz-xyz';
const CUSTOMER_B_NAME = '广州XYZ贸易有限公司';
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HANZI = /[\u4e00-\u9fff]/;
const RAW_INTERNAL_KEYS = [
  'contact_method',
  'wechat_search_status',
  'qualification_reason',
  'rough_visit_time_text',
  'CUSTOMER_SUMMARY',
  'NEXT_ACTION_PREPARATION',
  'customer.create',
] as const;

afterEach(() => {
  __resetSessionWriteStateStoreForTests();
  __setDbInstanceForTests(null);
  resetAppLocaleForTests();
});

type NavController = SalesAgentInteractionController & {
  enterCustomerConversation?(customerId: string, customerName?: string | null): void;
};

function src(rel: string): string {
  return readFileSync(resolve(SRC_ROOT, rel), 'utf8');
}

function countRawInternalKeys(text: string): number {
  return RAW_INTERNAL_KEYS.filter(key => text.includes(key)).length;
}

function humanEnterCustomer(controller: NavController, customerId: string, customerName: string) {
  if (typeof controller.enterCustomerConversation !== 'function') {
    throw new Error('enterCustomerConversation missing');
  }
  controller.enterCustomerConversation(customerId, customerName);
}

async function loadPendingScope(): Promise<{
  decideCustomerBoundPendingResume: (
    pending: { readonly prompt: string; readonly expectedCustomerId: string | null } | null,
    currentCustomerId: string | null,
  ) => { readonly action: 'resume' | 'discard'; readonly prompt?: string };
} | null> {
  try {
    return await import('../lib/salesAgentUi/conversationPendingScope');
  } catch {
    return null;
  }
}

async function loadI18n(): Promise<{
  getAppLocale: () => 'zh-CN' | 'en-US';
  setAppLocale: (locale: 'zh-CN' | 'en-US') => void;
  t: (key: string) => string;
  configureLocalePersistence?: (adapter: {
    read: () => string | null;
    write: (locale: string) => void;
  }) => void;
  hydrateAppLocale?: () => void;
  resetAppLocaleForTests?: () => void;
} | null> {
  try {
    return await import('../lib/i18n/appLocale');
  } catch {
    return null;
  }
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
    if (/下一步|咋搞|咋弄|总结/.test(text)) {
      return { ...base, intent: 'NEXT_ACTION_RECOMMENDATION' };
    }
    if (/跟进/.test(text)) return { ...base, intent: 'UPDATE_CUSTOMER_REQUEST' };
    return {
      ...base,
      intent: 'CLARIFICATION_REQUIRED',
      confidence: 0.3,
      missing_fields: ['intent'],
      clarification_question: '请明确意图。',
    };
  };
}

function hostilePlanner() {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    if (/写(?:一)?条跟进|跟进/.test(instruction) && !/总结/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: 'follow_up.create',
        clarification_question: '请提供跟进记录的标题以及跟进内容。',
        missing_fields: ['title', 'feedback_notes'],
      });
    }
    if (/分析|咋搞|下一步|总结/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: null,
        clarification_question: '请明确你想调用哪个能力。',
        missing_fields: ['capability_id'],
      });
    }
    return JSON.stringify({ kind: 'unknown', reason: '模型选择无法识别。' });
  });
}

function nextActionOutput(evidenceIds: readonly string[]) {
  const ids = evidenceIds.length > 0 ? evidenceIds.slice(0, 2) : [CUSTOMER_A];
  return {
    recommended_next_steps: ['准备实施周期说明材料', '下周五再次联系客户确认实施周期'],
    reasoning_summary: '该客户已有互动与跟进安排。',
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
    planning_mode: 'deterministic',
    model_caller: modelCaller,
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
    industry: '科技',
    customer_grade: 'A',
    stage: 'CONTACTED',
    intent_level: 'HIGH',
    last_contacted_at: '2026-07-15T10:00:00+08:00',
    next_follow_up_at: '2026-07-20T10:00:00+08:00',
  });
  sqlite.prepare('UPDATE customers SET opportunity_amount = ? WHERE id = ?').run(200000, id);
}

function counts(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'], customerId: string) {
  return {
    customers: (sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(customerId) as { c: number }).c,
    tasks: (sqlite.prepare('SELECT COUNT(*) AS c FROM tasks WHERE customer_id=?').get(customerId) as { c: number }).c,
    followUps: (sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get(customerId) as { c: number }).c,
    nextFollow: (sqlite.prepare('SELECT next_follow_up_at AS t FROM customers WHERE id=?').get(customerId) as { t: string | null }).t,
    amount: (sqlite.prepare('SELECT opportunity_amount AS n FROM customers WHERE id=?').get(customerId) as { n: number | null }).n,
  };
}

async function controllerFor(opts?: { readonly scoped?: boolean }) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME);
  __setDbInstanceForTests(fixture.db);
  const fake = createFakeTrustedHostTransport(async call => {
    const ids = call.envelope.evidence_map.map(item => item.evidence_id);
    return { kind: 'success', output: nextActionOutput(ids) };
  });
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: (customerId) => {
      if (customerId === CUSTOMER_B) return sessionFor(CUSTOMER_B, CUSTOMER_B_NAME, fake.caller);
      return sessionFor(CUSTOMER_A, CUSTOMER_A_NAME, fake.caller);
    },
    clock: () => NOW,
    model_planner: hostilePlanner(),
    semantic_intent_router: productionLikeSemanticRouter(),
    customer_catalog: [
      { id: CUSTOMER_A, name: CUSTOMER_A_NAME },
      { id: CUSTOMER_B, name: CUSTOMER_B_NAME },
    ],
  }) as NavController;
  if (opts?.scoped !== false) controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
  return { fixture, controller, fake };
}

function fakeProposal(toolId: AgentWriteProposal['tool_id'], proposed: Record<string, unknown>): AgentWriteProposal {
  return {
    proposal_id: `p-${toolId}`,
    proposal_hash: `h-${toolId}`,
    tool_id: toolId,
    customer_id: CUSTOMER_A,
    entity_type: toolId === 'create_customer' || toolId === 'delete_customer' ? 'customer' : 'follow_up',
    operation: toolId === 'create_customer' ? 'create' : toolId === 'delete_customer' ? 'delete' : 'update',
    current_values: toolId === 'delete_customer' ? { name: CUSTOMER_A_NAME } : {},
    proposed_values: proposed,
    reason: '用户本次明确指令',
    evidence_refs: [],
    reversible: toolId !== 'delete_customer',
    nonce: 'nonce-test-1',
    created_at: NOW,
    status: 'awaiting_confirmation',
    executable: false,
    requires_confirmation: true,
  };
}

function fakeResult(intent: string): AgentSessionResult {
  return {
    response: '客户当前推进顺利。',
    plan: { intent, rationale: 'test', tools: [] },
    structured: {
      customer_understanding: '客户当前推进顺利。',
      risks_and_opportunities: '风险：周期不确定；机会：已建立联系',
      recommended_next_step: '下周五再次联系',
      evidence_refs: [CUSTOMER_A],
    },
    tool_trace: [],
    evidence_refs: [CUSTOMER_A],
  } as AgentSessionResult;
}

function chromeBundle(): string {
  const card = projectConfirmationCard(fakeProposal('create_customer', { name: 'Northwind', contact_person: 'Ada' }));
  const update = projectConfirmationCard(fakeProposal('update_next_follow_up_time', { next_follow_up_at: '2026-07-22T10:00:00+08:00' }));
  const del = projectConfirmationCard(fakeProposal('delete_customer', {}));
  const analysis = projectResultCards(fakeResult('CUSTOMER_SUMMARY'));
  const review = projectResultCards(fakeResult('INTERACTION_SUMMARY'));
  const next = projectResultCards(fakeResult('NEXT_ACTION_PREPARATION'));
  const clarify = projectClarificationQuestion('follow_up.create', ['feedback_notes']);
  const work = buildAgentWorkProcess({
    customerSelected: true,
    contextLoaded: true,
    memoryCount: 1,
    timelineCount: 1,
    sessionBusy: false,
    result: fakeResult('CUSTOMER_SUMMARY'),
    proposal: null,
    confirmationPending: false,
  });
  return [
    card.title, card.confirm_label, card.cancel_label, card.success_label, card.footnote ?? '',
    update.title, update.confirm_label, update.cancel_label, update.success_label,
    del.title, del.confirm_label, del.cancel_label, del.destructive_note ?? '',
    analysis.headline, ...analysis.sections.map(s => s.title),
    review.headline, ...review.sections.map(s => s.title),
    next.headline, ...next.sections.map(s => s.title),
    clarify,
    ...work.map(step => step.label),
    mapUserExecutionState({ awaitingConfirmation: true }),
    mapUserExecutionState({ failed: true }),
    formatProposalValues({
      next_follow_up_at: '2026-07-22T10:00:00+08:00',
      contact_method: 'wechat',
      wechat_search_status: 'FOUND',
      qualification_reason: 'inbound',
      rough_visit_time_text: 'next week',
    }),
  ].join('\n');
}

describe('T1 — Pending Continue Cross-customer Race', () => {
  it('A pendingContinue resumed after human navigation to B is discarded, not executed on B or rebound to A', async () => {
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    const pendingScope = await loadPendingScope();
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const locating = await controller.submit(`总结一下${CUSTOMER_A_NAME}`);
      expect(locating.event.type).toBe('bind_required');
      if (locating.event.type !== 'bind_required') throw new Error('expected bind');
      const stalePrompt = locating.event.continue_prompt;
      const staleCustomer = locating.event.customer_id;
      humanEnterCustomer(controller, CUSTOMER_B, CUSTOMER_B_NAME);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      const resumed = await controller.continueAfterBind(stalePrompt, CUSTOMER_B);
      const decision = pendingScope?.decideCustomerBoundPendingResume(
        { prompt: stalePrompt, expectedCustomerId: staleCustomer },
        CUSTOMER_B,
      );

      console.log([
        'FAIL_FIRST_T1',
        `BEFORE=pendingContinue is string-only; continueAfterBind(A prompt, B) runs`,
        'EXPECTED=discard; B unchanged; not rebound to A',
        `ACTUAL_OUTCOME=${resumed.outcome?.kind ?? 'none'}`,
        `ACTUAL_SCOPED=${resumed.state.scoped_customer_id}`,
        `ACTUAL_DECISION=${decision?.action ?? 'missing-helper'}`,
      ].join('\n'));
      expect(resumed.outcome?.kind).not.toBe('reasoning_result');
      expect(resumed.state.scoped_customer_id).toBe(CUSTOMER_B);
      expect(resumed.state.scoped_customer_id).not.toBe(CUSTOMER_A);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
      expect(pendingScope).not.toBeNull();
      expect(decision?.action).toBe('discard');
      expect(workspace).toContain('bindPendingPrompt');
      expect(workspace).toContain('decideCustomerBoundPendingResume');
    } finally {
      fixture.close();
    }
  });
});

describe('T2 — Pending User Submit Cross-customer Race', () => {
  it('A pendingUserSubmit callback resumed on B is discarded', async () => {
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    const pendingScope = await loadPendingScope();
    const decision = pendingScope?.decideCustomerBoundPendingResume(
      { prompt: '帮我给这个客户写一条跟进，下周一联系', expectedCustomerId: CUSTOMER_A },
      CUSTOMER_B,
    );
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('帮我给这个客户写一条跟进，下周一联系');
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      humanEnterCustomer(controller, CUSTOMER_B, CUSTOMER_B_NAME);

      console.log([
        'FAIL_FIRST_T2',
        'BEFORE=pendingUserSubmit is a bare string resumed against current customerId',
        'EXPECTED=discard when expectedCustomerId !== current',
        `ACTUAL_DECISION=${decision?.action ?? 'missing-helper'}`,
        `ACTUAL_SCOPED=${controller.getState().scoped_customer_id}`,
      ].join('\n'));
      expect(pendingScope).not.toBeNull();
      expect(decision?.action).toBe('discard');
      expect(workspace).toContain('bindPendingPrompt');
      expect(workspace).toContain('pendingUserSubmit');
      expect(controller.getState().scoped_customer_id).toBe(CUSTOMER_B);
      expect(controller.getState().latest_proposal).toBeNull();
      expect(controller.getState().latest_clarification).toBeNull();
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('T3 — Human Navigation Fresh Conversation', () => {
  it('entering B from A clears A transient conversation state and keeps CRM rows', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('接下来我该咋搞？');
      expect(controller.getState().last_reasoning_action_context).not.toBeNull();
      expect(controller.getState().latest_result).not.toBeNull();
      const writeTurn = await controller.submit('帮我给这个客户写一条跟进');
      expect(
        writeTurn.state.phase === 'clarification'
        || writeTurn.state.latest_proposal
        || writeTurn.state.latest_clarification
        || writeTurn.state.pending_original_instruction,
      ).toBe(true);
      const beforeA = counts(fixture.sqlite, CUSTOMER_A);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      humanEnterCustomer(controller, CUSTOMER_B, CUSTOMER_B_NAME);
      const next = controller.getState();

      console.log([
        'FAIL_FIRST_T3',
        'BEFORE=A has latest_result / reasoning / proposal-or-clarification',
        'EXPECTED=scoped=B and all A transients cleared; CRM unchanged',
        `ACTUAL_SCOPED=${next.scoped_customer_id}`,
        `ACTUAL_RESULT=${next.latest_result ? 'present' : 'null'}`,
        `ACTUAL_REASONING=${next.last_reasoning_action_context ? 'present' : 'null'}`,
      ].join('\n'));
      expect(next.scoped_customer_id).toBe(CUSTOMER_B);
      expect(next.last_reasoning_action_context).toBeNull();
      expect(next.latest_result).toBeNull();
      expect(next.latest_proposal).toBeNull();
      expect(next.latest_clarification).toBeNull();
      expect(next.pending_original_instruction).toBeNull();
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(beforeA);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — Same-customer Continue', () => {
  it('same-customer pending continuation still resumes', async () => {
    const pendingScope = await loadPendingScope();
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const locating = await controller.submit(`总结一下${CUSTOMER_A_NAME}`);
      expect(locating.event.type).toBe('bind_required');
      if (locating.event.type !== 'bind_required') throw new Error('expected bind');
      const decision = pendingScope?.decideCustomerBoundPendingResume(
        { prompt: locating.event.continue_prompt, expectedCustomerId: locating.event.customer_id },
        CUSTOMER_A,
      );
      controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
      const continued = await controller.continueAfterBind(locating.event.continue_prompt, CUSTOMER_A);

      console.log([
        'FAIL_FIRST_T4',
        'BEFORE=same-customer continueAfterBind',
        'EXPECTED=resume, not discard-all',
        `ACTUAL=${continued.outcome?.kind ?? continued.state.phase}`,
        `ACTUAL_DECISION=${decision?.action ?? 'missing-helper'}`,
      ].join('\n'));
      expect(pendingScope).not.toBeNull();
      expect(decision?.action).toBe('resume');
      expect(continued.outcome?.kind).toBe('reasoning_result');
      expect(continued.state.scoped_customer_id).toBe(CUSTOMER_A);
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — Internal Bind Preserved', () => {
  it('unscoped “打开/总结广州ABC科技” continues after bind and is not fresh-reset', async () => {
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const locating = await controller.submit(`打开${CUSTOMER_A_NAME}，然后总结一下`);
      const bindTurn = locating.event.type === 'bind_required'
        ? locating
        : await controller.submit(`总结一下${CUSTOMER_A_NAME}`);
      expect(bindTurn.event.type).toBe('bind_required');
      if (bindTurn.event.type !== 'bind_required') throw new Error('expected bind');
      const pending = bindTurn.state.pending_original_instruction;
      const envelopeId = bindTurn.state.intent_envelope?.envelope_id;
      controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
      expect(controller.getState().pending_original_instruction).toBe(pending);
      expect(controller.getState().intent_envelope?.envelope_id).toBe(envelopeId);
      const continued = await controller.continueAfterBind(bindTurn.event.continue_prompt, CUSTOMER_A);

      console.log([
        'FAIL_FIRST_T5',
        'BEFORE=unscoped bind_required then syncExternalScope',
        'EXPECTED=original prompt continues; not enterCustomerConversation reset',
        `ACTUAL=${continued.outcome?.kind ?? continued.state.phase}`,
      ].join('\n'));
      expect(continued.outcome?.kind).toBe('reasoning_result');
      expect(continued.state.scoped_customer_id).toBe(CUSTOMER_A);
      const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
      expect(workspace).toMatch(/isInternalBind/);
      expect(workspace).toMatch(/syncExternalScope/);
      expect(workspace).toMatch(/enterCustomerConversation/);
    } finally {
      fixture.close();
    }
  });
});

describe('T6 — zh-CN Raw Internal Key', () => {
  it('zh-CN business UI never renders raw internal keys', async () => {
    const i18n = await loadI18n();
    i18n?.setAppLocale('zh-CN');
    const surface = chromeBundle();
    const rawCount = countRawInternalKeys(surface);

    console.log([
      'FAIL_FIRST_T6',
      'BEFORE=FIELD_LABELS[key] ?? key leaks unmapped schema names',
      'EXPECTED=raw internal key count = 0',
      `ACTUAL=${rawCount}`,
      `SURFACE=${surface.replace(/\n/g, ' | ').slice(0, 400)}`,
    ].join('\n'));
    expect(rawCount).toBe(0);
    expect(surface).not.toMatch(/contact_method|wechat_search_status|qualification_reason|rough_visit_time_text/);
    expect(surface).not.toMatch(/\bCUSTOMER_SUMMARY\b|\bNEXT_ACTION_PREPARATION\b|customer\.create/);
  });
});

describe('T7 — en-US Agent Surface', () => {
  it('en-US critical paths use English business copy, never Chinese chrome', async () => {
    const i18n = await loadI18n();
    expect(i18n, 'locale source of truth must exist').not.toBeNull();
    i18n!.setAppLocale('en-US');
    const surface = chromeBundle();
    const nav = [
      i18n!.t('nav.agent'),
      i18n!.t('nav.board'),
      i18n!.t('nav.customers'),
      i18n!.t('nav.review'),
      i18n!.t('nav.sidebarTitle'),
      i18n!.t('agent.home.title'),
      i18n!.t('agent.analysis.title'),
      i18n!.t('agent.review.title'),
      i18n!.t('agent.nextAction.title'),
      i18n!.t('customer.list.title'),
      i18n!.t('customer.detail.askAgent'),
      i18n!.t('confirmation.confirm'),
      i18n!.t('confirmation.cancel'),
      i18n!.t('technicalDetails.show'),
    ];
    const chineseNav = nav.filter(label => HANZI.test(label));
    const chineseChrome = HANZI.test(surface.replace(new RegExp(CUSTOMER_A_NAME, 'g'), ''));

    console.log([
      'FAIL_FIRST_T7',
      'BEFORE=all production chrome is hardcoded zh-CN',
      'EXPECTED=en-US business chrome, zero Chinese chrome',
      `ACTUAL_NAV=${nav.join(' / ')}`,
      `ACTUAL_CHINESE_NAV=${chineseNav.length}`,
    ].join('\n'));
    expect(chineseNav).toEqual([]);
    expect(chineseChrome).toBe(false);
    expect(nav[0]).toBe('Agent');
    expect(surface).not.toMatch(/查看技术细节|需要补充信息|确认永久删除|客户分析/);
    const app = src('App.tsx');
    const list = src('pages/CustomerList.tsx');
    const detail = src('pages/CustomerDetail.tsx');
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    expect(app).toMatch(/\bt\(/);
    expect(list).toMatch(/\bt\(/);
    expect(detail).toMatch(/\bt\(/);
    expect(workspace).toMatch(/\bt\(/);
    expect(app).not.toMatch(/if\s*\(\s*locale\s*===\s*['"]en/);
    expect(workspace).not.toMatch(/if\s*\(\s*locale\s*===\s*['"]en/);
  });
});

describe('T8 — Runtime Locale Switch', () => {
  it('zh-CN → en-US → zh-CN switches without restart', async () => {
    const i18n = await loadI18n();
    expect(i18n).not.toBeNull();
    i18n!.resetAppLocaleForTests?.();
    i18n!.setAppLocale('zh-CN');
    const zhTitle = projectConfirmationCard(fakeProposal('create_customer', { name: 'Ada' })).title;
    i18n!.setAppLocale('en-US');
    const enTitle = projectConfirmationCard(fakeProposal('create_customer', { name: 'Ada' })).title;
    i18n!.setAppLocale('zh-CN');
    const zhAgain = projectConfirmationCard(fakeProposal('create_customer', { name: 'Ada' })).title;

    console.log([
      'FAIL_FIRST_T8',
      'BEFORE=no runtime locale',
      'EXPECTED=zh / en / zh titles differ then restore',
      `ACTUAL=${zhTitle} | ${enTitle} | ${zhAgain}`,
    ].join('\n'));
    expect(HANZI.test(zhTitle)).toBe(true);
    expect(HANZI.test(enTitle)).toBe(false);
    expect(zhAgain).toBe(zhTitle);
    expect(enTitle).not.toBe(zhTitle);
  });
});

describe('T9 — Locale Persistence', () => {
  it('selected en-US survives simulated reload', async () => {
    const i18n = await loadI18n();
    expect(i18n).not.toBeNull();
    const store = new Map<string, string>();
    i18n!.configureLocalePersistence?.({
      read: () => store.get('app_locale') ?? null,
      write: locale => { store.set('app_locale', locale); },
    });
    i18n!.setAppLocale('en-US');
    expect(store.get('app_locale')).toBe('en-US');
    i18n!.resetAppLocaleForTests?.();
    i18n!.hydrateAppLocale?.();

    console.log([
      'FAIL_FIRST_T9',
      'BEFORE=no persisted locale',
      'EXPECTED=en-US after reload hydrate',
      `ACTUAL=${i18n!.getAppLocale()}`,
    ].join('\n'));
    expect(i18n!.getAppLocale()).toBe('en-US');
  });
});

describe('T10 — Locale Does Not Change CRM Truth', () => {
  it('switching language leaves customer rows, tasks, follow ups, amount, next_follow_up_at unchanged', async () => {
    const i18n = await loadI18n();
    expect(i18n).not.toBeNull();
    const { fixture } = await controllerFor();
    try {
      const beforeA = counts(fixture.sqlite, CUSTOMER_A);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      i18n!.setAppLocale('en-US');
      i18n!.setAppLocale('zh-CN');
      i18n!.setAppLocale('en-US');
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(beforeA);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
    } finally {
      fixture.close();
    }
  });
});

describe('T11 — Locale Does Not Change Capability Contracts', () => {
  it('capability id / A10 / canonical proposal identity stay identical across locales', async () => {
    const i18n = await loadI18n();
    expect(i18n).not.toBeNull();
    const snapshot = () => ({
      create: previewAuthorityForSelection('customer.create'),
      update: previewAuthorityForSelection('customer.profile.update'),
      amount: previewAuthorityForSelection('customer.opportunity_amount.update'),
      del: previewAuthorityForSelection('customer.delete'),
      followUp: previewAuthorityForSelection('follow_up.create'),
      proposal: fakeProposal('create_customer', { name: 'Ada', contact_method: 'wechat' }),
    });
    i18n!.setAppLocale('zh-CN');
    const zh = snapshot();
    i18n!.setAppLocale('en-US');
    const en = snapshot();
    i18n!.setAppLocale('zh-CN');
    const zh2 = snapshot();
    expect(en).toEqual(zh);
    expect(zh2).toEqual(zh);
    expect(zh.del).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(zh.proposal.tool_id).toBe('create_customer');
    expect(zh.proposal.nonce).toBe('nonce-test-1');
    expect(zh.proposal.proposed_values.contact_method).toBe('wechat');
  });
});

describe('T12 — Internal Technical Details Boundary', () => {
  it('default confirmation card is business copy only; technical details stay behind an explicit entry', async () => {
    const i18n = await loadI18n();
    expect(i18n).not.toBeNull();
    const proposal = fakeProposal('create_customer', {
      name: 'Ada',
      contact_method: 'wechat',
      wechat_search_status: 'FOUND',
      nonce: 'should-not-leak',
    });
    i18n!.setAppLocale('zh-CN');
    const zhCard = projectConfirmationCard(proposal);
    const zhTech = projectConfirmationTechnicalDetails(proposal);
    i18n!.setAppLocale('en-US');
    const enCard = projectConfirmationCard(proposal);
    const enTech = projectConfirmationTechnicalDetails(proposal);
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    const zhDefault = [zhCard.title, zhCard.confirm_label, zhCard.cancel_label, ...zhCard.summary_lines].join('\n');
    const enDefault = [enCard.title, enCard.confirm_label, enCard.cancel_label, ...enCard.summary_lines].join('\n');

    console.log([
      'FAIL_FIRST_T12',
      'BEFORE=technical heading hardcoded; raw keys may leak in default card',
      'EXPECTED=zh business / en business; technical only after explicit show',
      `ACTUAL_ZH_TITLE=${zhCard.title}`,
      `ACTUAL_EN_TITLE=${enCard.title}`,
      `ACTUAL_ZH_TECH=${zhTech.heading}`,
      `ACTUAL_EN_TECH=${enTech.heading}`,
    ].join('\n'));
    expect(countRawInternalKeys(zhDefault)).toBe(0);
    expect(countRawInternalKeys(enDefault)).toBe(0);
    expect(zhDefault).not.toMatch(/nonce|proposal_id|capability_id/);
    expect(enDefault).not.toMatch(/nonce|proposal_id|capability_id/);
    expect(HANZI.test(zhCard.title)).toBe(true);
    expect(HANZI.test(enCard.title)).toBe(false);
    expect(zhTech.heading).toMatch(/技术细节/);
    expect(enTech.heading).toMatch(/Technical Details/i);
    expect(workspace).toMatch(/t\(['"]technicalDetails\.show['"]\)|technicalDetails\.show/);
    expect(workspace).toMatch(/confirmExpanded/);
  });
});

describe('infrastructure — no second engine / no i18n framework', () => {
  it('does not introduce i18next and keeps conversation seamed on the existing controller', () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC_ROOT, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps.i18next).toBeUndefined();
    expect(deps['react-i18next']).toBeUndefined();
    expect(deps['react-intl']).toBeUndefined();
    expect(existsSync(resolve(SRC_ROOT, 'lib/salesAgentTools/interactionController.ts'))).toBe(true);
    const controller = src('lib/salesAgentTools/interactionController.ts');
    expect(controller).toMatch(/enterCustomerConversation/);
    expect(controller).toMatch(/syncExternalScope/);
    expect(controller).toMatch(/continueAfterBind/);
  });
});
