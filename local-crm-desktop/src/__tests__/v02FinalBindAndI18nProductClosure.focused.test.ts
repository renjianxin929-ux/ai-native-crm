/**
 * V0.2 FINAL — Bind Continuation + Unique Exact Match + Core en-US Surface.
 *
 * TEST FIRST. ~10 focused acceptance cases. Do not invent a second matcher,
 * conversation engine, or i18n framework.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { buildCustomerMemoryContext } from '../lib/customerMemory';
import { __setDbInstanceForTests } from '../lib/db';
import { createTrustedHostModelPlannerCaller } from '../lib/planner/productionModelPlanner';
import { createFakeTrustedHostTransport } from '../lib/productionAi/fakeTransport';
import { SalesAgentInteractionController } from '../lib/salesAgentTools/interactionController';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { resumeInstructionAfterScope } from '../lib/salesAgentTools/filterNormalization';
import { matchCustomerNameScore } from '../lib/salesAgentTools/searchCustomers';
import { __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { insertSeededCustomer, sqliteFixtureFromReasoning } from './v02ForegroundReasoningDateHarness';
import {
  getAppLocale,
  resetAppLocaleForTests,
  setAppLocale,
  t,
  tStage,
} from '../lib/i18n/appLocale';
import { formatUserTimeLabel } from '../lib/salesAgentUi/userFacingFieldFormatter';
import {
  BOARD_COLUMN_LABELS,
  formatOpportunityAmount,
} from '../lib/opportunityBoard/boardPresentation';

const NOW = '2026-07-15T12:00:00+08:00';
const CUSTOMER_A = 'gz-abc';
const CUSTOMER_A_NAME = '广州ABC科技有限公司';
const CUSTOMER_B = 'gz-xyz';
const CUSTOMER_B_NAME = '广州XYZ贸易有限公司';
const CUSTOMER_A_SHARE = 'gz-abc-share';
const CUSTOMER_A_SHARE_NAME = '广州ABC科技股份';
const ISO_CONTACT = '2026-08-17T21:51:50+08:00';
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HANZI = /[\u4e00-\u9fff]/;
const CLARIFY_INTENT = /无法高置信度确定请求意图|请明确是总结、风险分析/;

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

function sessionFor(customerId: string, name: string, modelCaller?: ReturnType<typeof createFakeTrustedHostTransport>['caller']): SalesAgentSession {
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
  extras?: { readonly stage?: string; readonly last_contacted_at?: string | null },
) {
  insertSeededCustomer(sqlite, {
    id,
    name,
    region: '广州',
    industry: '科技',
    customer_grade: 'A',
    stage: extras?.stage ?? 'NEW_LEAD',
    intent_level: 'HIGH',
    last_contacted_at: extras?.last_contacted_at ?? ISO_CONTACT,
    next_follow_up_at: '2026-07-20T10:00:00+08:00',
  });
}

function counts(sqlite: ReturnType<typeof sqliteFixtureFromReasoning>['sqlite'], customerId: string) {
  return {
    customers: (sqlite.prepare('SELECT COUNT(*) AS c FROM customers WHERE id=?').get(customerId) as { c: number }).c,
    tasks: (sqlite.prepare('SELECT COUNT(*) AS c FROM tasks WHERE customer_id=?').get(customerId) as { c: number }).c,
    followUps: (sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id=?').get(customerId) as { c: number }).c,
    stage: (sqlite.prepare('SELECT stage AS s FROM customers WHERE id=?').get(customerId) as { s: string }).s,
    lastContact: (sqlite.prepare('SELECT last_contacted_at AS t FROM customers WHERE id=?').get(customerId) as { t: string | null }).t,
  };
}

function hostilePlanner() {
  return createTrustedHostModelPlannerCaller(async ({ user }) => {
    const instruction = user.split('指令：').pop()?.trim() ?? user;
    if (/分析|总结|最近情况/.test(instruction)) {
      return JSON.stringify({
        kind: 'clarify',
        capability_id: null,
        clarification_question: '请明确你想调用哪个能力：查看时间线、拜访记录、作战卡还是客户资料？',
        missing_fields: ['capability_id'],
      });
    }
    return JSON.stringify({ kind: 'unknown', reason: '模型选择无法识别。' });
  });
}

async function controllerFor(opts?: {
  readonly scoped?: boolean;
  readonly extraCustomers?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}) {
  const fixture = sqliteFixtureFromReasoning();
  await fixture.initialize();
  seedCustomer(fixture.sqlite, CUSTOMER_A, CUSTOMER_A_NAME);
  seedCustomer(fixture.sqlite, CUSTOMER_B, CUSTOMER_B_NAME, { stage: 'CONTACTED' });
  for (const extra of opts?.extraCustomers ?? []) {
    seedCustomer(fixture.sqlite, extra.id, extra.name);
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
        evidence_refs: ids.length > 0 ? ids.slice(0, 2) : [CUSTOMER_A],
        uncertainty: [],
        speculative_claims: [],
        requires_human_review: true,
      },
    };
  });
  const controller = new SalesAgentInteractionController({
    db: fixture.db,
    createSession: (customerId) => {
      if (customerId === CUSTOMER_B) return sessionFor(CUSTOMER_B, CUSTOMER_B_NAME, fake.caller);
      return sessionFor(CUSTOMER_A, CUSTOMER_A_NAME, fake.caller);
    },
    clock: () => NOW,
    model_planner: hostilePlanner(),
    customer_catalog: [
      { id: CUSTOMER_A, name: CUSTOMER_A_NAME },
      { id: CUSTOMER_B, name: CUSTOMER_B_NAME },
      ...(opts?.extraCustomers ?? []),
    ],
  }) as NavController;
  if (opts?.scoped !== false) controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
  return { fixture, controller };
}

function visibleCatalog(keys: readonly string[]): string {
  return keys.map(key => t(key)).join('\n');
}

function chineseCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

describe('T1 — Internal Bind Continuation', () => {
  it('打开 unique exact customer 然后总结 continues summary without asking the user to repeat intent', async () => {
    const prompt = `打开${CUSTOMER_A_NAME}，然后总结一下最近情况`;
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const before = counts(fixture.sqlite, CUSTOMER_A);
      const locating = await controller.submit(prompt);
      const message = `${locating.state.agent_message ?? ''}\n${locating.state.resolution_reason ?? ''}`;

      console.log([
        'FAIL_FIRST_T1',
        `INPUT=${prompt}`,
        `ACTUAL_EVENT=${locating.event.type}`,
        `ACTUAL_PHASE=${locating.state.phase}`,
        `ACTUAL_INTENT=${locating.state.current_intent}`,
        `ACTUAL_CONTINUE=${locating.event.type === 'bind_required' ? locating.event.continue_prompt : ''}`,
        `ACTUAL_MESSAGE=${message.replace(/\n/g, ' | ').slice(0, 240)}`,
      ].join('\n'));
      expect(message, 'must not ask the user to restate analysis intent').not.toMatch(CLARIFY_INTENT);
      expect(locating.event.type).toBe('bind_required');
      if (locating.event.type !== 'bind_required') throw new Error('expected bind');
      expect(locating.event.customer_id).toBe(CUSTOMER_A);
      expect(locating.state.phase).not.toBe('awaiting_candidate_selection');
      expect(locating.event.continue_prompt).toMatch(/总结一下最近情况/);
      expect(locating.event.continue_prompt).not.toMatch(/^打开/);
      controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
      const continued = await controller.continueAfterBind(locating.event.continue_prompt, CUSTOMER_A);
      const continuedMessage = `${continued.state.agent_message ?? ''}\n${continued.state.resolution_reason ?? ''}`;
      expect(continuedMessage).not.toMatch(CLARIFY_INTENT);
      expect(continued.outcome?.kind).toBe('reasoning_result');
      expect(continued.state.scoped_customer_id).toBe(CUSTOMER_A);
      expect(continued.state.latest_proposal).toBeNull();
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(before);
    } finally {
      fixture.close();
    }
  });
});

describe('T2 — Unique Exact Match Auto Bind', () => {
  it('打开完整客户名分析一下 binds the unique exact customer without a candidate picker', async () => {
    const prompt = `打开${CUSTOMER_A_NAME}分析一下`;
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const locating = await controller.submit(prompt);

      console.log([
        'FAIL_FIRST_T2',
        `INPUT=${prompt}`,
        `ACTUAL_EVENT=${locating.event.type}`,
        `ACTUAL_PHASE=${locating.state.phase}`,
        `ACTUAL_CANDIDATES=${locating.state.candidate_results.map(item => item.name).join(',')}`,
        `ACTUAL_EMPTY_EXACT=${locating.state.candidate_empty_exact}`,
      ].join('\n'));
      expect(locating.state.phase).not.toBe('awaiting_candidate_selection');
      expect(locating.event.type).toBe('bind_required');
      if (locating.event.type !== 'bind_required') throw new Error('expected bind');
      expect(locating.event.customer_id).toBe(CUSTOMER_A);
      expect(locating.event.customer_name).toBe(CUSTOMER_A_NAME);
      controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
      const continued = await controller.continueAfterBind(locating.event.continue_prompt, CUSTOMER_A);
      expect(`${continued.state.agent_message ?? ''}\n${continued.state.resolution_reason ?? ''}`).not.toMatch(CLARIFY_INTENT);
      expect(continued.outcome?.kind).toBe('reasoning_result');
    } finally {
      fixture.close();
    }
  });
});

describe('T3 — Fuzzy Multiple Candidates Still Need Picker', () => {
  it('approximate name with two fuzzy hits still shows the candidate picker', async () => {
    const { fixture, controller } = await controllerFor({
      scoped: false,
      extraCustomers: [{ id: CUSTOMER_A_SHARE, name: CUSTOMER_A_SHARE_NAME }],
    });
    try {
      const locating = await controller.submit('打开广州ABC科技分析一下');

      console.log([
        'FAIL_FIRST_T3',
        `ACTUAL_PHASE=${locating.state.phase}`,
        `ACTUAL_EVENT=${locating.event.type}`,
        `ACTUAL_CANDIDATES=${locating.state.candidate_results.map(item => item.name).join(',')}`,
        `ACTUAL_EXACT=${locating.state.candidate_results.filter(item => matchCustomerNameScore(item, '广州ABC科技') >= 100).length}`,
      ].join('\n'));
      expect(locating.event.type).not.toBe('bind_required');
      expect(locating.state.phase).toBe('awaiting_candidate_selection');
      expect(locating.state.candidate_results.length).toBeGreaterThan(1);
      expect(locating.state.candidate_results.filter(item => matchCustomerNameScore(item, '广州ABC科技') >= 100)).toHaveLength(0);
    } finally {
      fixture.close();
    }
  });
});

describe('T4 — Internal Bind Preserves Original Command', () => {
  it('unscoped resolve → bind → continueAfterBind keeps the remaining instruction', async () => {
    const prompt = `打开${CUSTOMER_A_NAME}，然后总结一下最近情况`;
    const { fixture, controller } = await controllerFor({ scoped: false });
    try {
      const locating = await controller.submit(prompt);
      expect(locating.event.type).toBe('bind_required');
      if (locating.event.type !== 'bind_required') throw new Error('expected bind');
      const remaining = resumeInstructionAfterScope(prompt);
      expect(remaining).toMatch(/总结一下最近情况/);
      expect(locating.event.continue_prompt).toBe(remaining);
      const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
      expect(workspace).toMatch(/isInternalBind/);
      expect(workspace).toMatch(/continueAfterBind/);
      controller.syncExternalScope(CUSTOMER_A, CUSTOMER_A_NAME);
      const continued = await controller.continueAfterBind(locating.event.continue_prompt, CUSTOMER_A);
      expect(continued.outcome?.kind).toBe('reasoning_result');
    } finally {
      fixture.close();
    }
  });
});

describe('T5 — Human Navigation Fresh Session Preserved', () => {
  it('user navigation A → B still starts a fresh conversation and does not inherit A transients', async () => {
    const { fixture, controller } = await controllerFor();
    try {
      await controller.submit('总结一下最近情况');
      expect(controller.getState().latest_result).not.toBeNull();
      const beforeA = counts(fixture.sqlite, CUSTOMER_A);
      const beforeB = counts(fixture.sqlite, CUSTOMER_B);
      if (typeof controller.enterCustomerConversation !== 'function') {
        throw new Error('enterCustomerConversation missing');
      }
      controller.enterCustomerConversation(CUSTOMER_B, CUSTOMER_B_NAME);
      const next = controller.getState();

      console.log([
        'FAIL_FIRST_T5',
        `ACTUAL_SCOPED=${next.scoped_customer_id}`,
        `ACTUAL_RESULT=${next.latest_result ? 'present' : 'null'}`,
        `ACTUAL_REASONING=${next.last_reasoning_action_context ? 'present' : 'null'}`,
      ].join('\n'));
      expect(next.scoped_customer_id).toBe(CUSTOMER_B);
      expect(next.latest_result).toBeNull();
      expect(next.last_reasoning_action_context).toBeNull();
      expect(next.latest_proposal).toBeNull();
      expect(next.pending_original_instruction).toBeNull();
      expect(counts(fixture.sqlite, CUSTOMER_A)).toEqual(beforeA);
      expect(counts(fixture.sqlite, CUSTOMER_B)).toEqual(beforeB);
      const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
      expect(workspace).toMatch(/enterCustomerConversation/);
      expect(workspace).toMatch(/isInternalBind/);
    } finally {
      fixture.close();
    }
  });
});

describe('T6 — en-US Agent Core Chrome', () => {
  it('Agent home select-customer / history / core actions use catalog English, not leftover Chinese', () => {
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    setAppLocale('en-US');
    const keys = [
      'agent.selectCustomerOptional',
      'agent.history',
      'agent.home.title',
      'agent.home.subtitle',
      'quick.summary',
      'quick.interactions',
      'quick.followUp',
    ] as const;
    const surface = visibleCatalog(keys);

    console.log([
      'FAIL_FIRST_T6',
      `ACTUAL_SURFACE=${surface.replace(/\n/g, ' | ')}`,
      `ACTUAL_HARDCODED_SELECT=${workspace.includes('选择客户 (可选)') || workspace.includes('选择客户（可选）')}`,
      `ACTUAL_HARDCODED_HISTORY=${workspace.includes('>历史记录<') || workspace.includes('历史记录</')}`,
    ].join('\n'));
    expect(workspace).toMatch(/t\(['"]agent\.selectCustomerOptional['"]\)/);
    expect(workspace).toMatch(/t\(['"]agent\.history['"]\)/);
    expect(workspace).not.toMatch(/选择客户\s*[（(]可选[）)]/);
    expect(workspace).not.toMatch(/>历史记录</);
    expect(chineseCount(surface)).toBe(0);
    expect(t('agent.selectCustomerOptional')).toMatch(/Select customer/i);
    expect(t('agent.history')).toBe('History');
  });
});

describe('T7 — en-US Board First Screen', () => {
  it('Board current visible first-screen chrome is English via the catalog', () => {
    const page = src('pages/OpportunityBoardPage.tsx');
    const presentation = src('lib/opportunityBoard/boardPresentation.ts');
    setAppLocale('en-US');
    const keys = [
      'board.title',
      'board.subtitle',
      'board.openPipeline',
      'board.weekFollowUps',
      'board.pending',
      'board.addCustomer',
      'board.empty',
      'board.column.new',
      'board.column.active',
      'board.column.pending',
      'board.column.won',
      'board.amountUnknown',
    ] as const;
    const surface = visibleCatalog(keys);

    console.log([
      'FAIL_FIRST_T7',
      `ACTUAL_SURFACE=${surface.replace(/\n/g, ' | ')}`,
      `ACTUAL_H2=${/<h2>看板<\/h2>/.test(page)}`,
    ].join('\n'));
    expect(page).toMatch(/t\(['"]board\.title['"]\)/);
    expect(page).toMatch(/t\(['"]board\.subtitle['"]\)/);
    expect(page).not.toMatch(/<h2>看板<\/h2>/);
    expect(page).not.toMatch(/新增客户/);
    expect(presentation).toMatch(/board\.column\./);
    expect(chineseCount(surface)).toBe(0);
    expect(BOARD_COLUMN_LABELS.NEW).toBe(t('board.column.new'));
    expect(formatOpportunityAmount(null)).toBe(t('board.amountUnknown'));
  });
});

describe('T8 — en-US Review First Screen', () => {
  it('Review current visible first-screen chrome is English via the catalog', () => {
    const page = src('pages/DailyBattleReviewPage.tsx');
    setAppLocale('en-US');
    const keys = [
      'review.title',
      'review.subtitle',
      'review.emptyConclusion',
      'review.today',
      'review.watch',
      'review.tomorrow',
      'review.askAgent',
      'review.expand',
    ] as const;
    const surface = visibleCatalog(keys);

    console.log([
      'FAIL_FIRST_T8',
      `ACTUAL_SURFACE=${surface.replace(/\n/g, ' | ')}`,
      `ACTUAL_H2=${/<h2>今日复盘<\/h2>/.test(page)}`,
    ].join('\n'));
    expect(page).toMatch(/t\(['"]review\.title['"]\)/);
    expect(page).toMatch(/t\(['"]review\.expand['"]\)/);
    expect(page).not.toMatch(/<h2>今日复盘<\/h2>/);
    expect(page).not.toMatch(/让 Agent 生成复盘草稿/);
    expect(page).not.toMatch(/展开完整复盘/);
    expect(chineseCount(surface)).toBe(0);
  });
});

describe('T9 — Stage User Projection', () => {
  it('NEW_LEAD projects to 新线索 / New lead while canonical value stays NEW_LEAD', async () => {
    const { fixture } = await controllerFor({ scoped: false });
    try {
      const before = counts(fixture.sqlite, CUSTOMER_A);
      expect(before.stage).toBe('NEW_LEAD');
      setAppLocale('zh-CN');
      const zh = tStage('NEW_LEAD');
      setAppLocale('en-US');
      const en = tStage('NEW_LEAD');
      expect(tStage('NEW_LEAD')).toBe(en);
      setAppLocale('zh-CN');
      expect(counts(fixture.sqlite, CUSTOMER_A).stage).toBe('NEW_LEAD');
      expect(zh).toBe('新线索');
      expect(en).toBe('New lead');
      expect(src('components/aiNative/SalesAgentInteractionWorkspace.tsx')).toMatch(/tStage\(|formatStageLabel\(/);
      expect(src('components/aiNative/SalesAgentInteractionWorkspace.tsx')).not.toMatch(/阶段：\{candidate\.stage/);
    } finally {
      fixture.close();
    }
  });
});

describe('T10 — Datetime User Projection', () => {
  it('ISO contact time stays in CRM; zh-CN and en-US projections differ and do not leak the raw instant', async () => {
    const { fixture } = await controllerFor({ scoped: false });
    try {
      const before = counts(fixture.sqlite, CUSTOMER_A);
      expect(before.lastContact).toBe(ISO_CONTACT);
      setAppLocale('zh-CN');
      const zh = formatUserTimeLabel(ISO_CONTACT);
      setAppLocale('en-US');
      const en = formatUserTimeLabel(ISO_CONTACT);
      expect(counts(fixture.sqlite, CUSTOMER_A).lastContact).toBe(ISO_CONTACT);
      expect(zh).not.toBe(en);
      expect(zh).not.toContain('T21:51:50');
      expect(en).not.toContain('T21:51:50');
      expect(HANZI.test(zh)).toBe(true);
      expect(HANZI.test(en)).toBe(false);
      expect(src('components/aiNative/SalesAgentInteractionWorkspace.tsx')).toMatch(/formatUserTimeLabel\(/);
      expect(src('components/aiNative/SalesAgentInteractionWorkspace.tsx')).not.toMatch(/最近互动：\{candidate\.last_contacted_at/);
    } finally {
      fixture.close();
    }
  });
});

describe('infrastructure — no second matcher / locale forks', () => {
  it('reuses existing locale catalog and does not special-case the sample company name', () => {
    const envelope = src('lib/salesAgentTools/agentIntentEnvelope.ts');
    const normalization = src('lib/salesAgentTools/filterNormalization.ts');
    const controller = src('lib/salesAgentTools/interactionController.ts');
    const workspace = src('components/aiNative/SalesAgentInteractionWorkspace.tsx');
    const joined = [envelope, normalization, controller, workspace].join('\n');
    expect(joined).not.toMatch(/if\s*\([^)]*广州ABC科技有限公司/);
    expect(joined).not.toMatch(/locale\s*===\s*['"]en-US['"]\s*\?/);
    expect(src('lib/i18n/appLocale.ts')).toMatch(/export function tStage/);
    expect(getAppLocale()).toBe('zh-CN');
  });
});
