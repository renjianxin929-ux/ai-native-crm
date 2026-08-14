/**
 * V0.2A / W4-1 — customer.create Capability 契约测试（T1–T28 + 黄金路径对等）。
 *
 * 证明唯一新增生产能力 customer.create：
 *   T1  产品能力定义（冻结元数据）          T2  生产计数 21（20 原身份 + 唯一新身份）
 *   T3  生产绑定解析                        T4  输入白名单（20 个人工表单字段）
 *   T5  系统字段拒绝                        T6  name 必填
 *   T7  枚举校验                            T8  未知字段 fail closed（无 mass assignment）
 *   T9  scope=NONE 通过范围校验             T10 customer_id/customerId 注入拒绝
 *   T11 A10 REQUIRE_CONFIRMATION 精确决策   T12 确认前零业务写入
 *   T13 确认交接（现有机制提案）            T14 无新确认系统
 *   T15 确认后真实 DB 路径（恰好一行）      T16 产品默认对等
 *   T17 初始等级对等                        T18 时间解析对等
 *   T19 下次跟进对等                        T20 后置规则对等（Rule 2/3）
 *   T21 未发明去重                          T22 输出最小化（{ customer_id }）
 *   T23 观察生命周期（预确认）              T24 原始载荷不入观察事件
 *   T25 重放/幂等分离                       T26 现有 20 回归
 *   T27 无 Wave-4 泄漏                      T28 无 V0.2B/V0.3 泄漏
 *   §23 真实产品黄金路径对等（A 人工语义组合 vs B 确认后能力路径）
 *
 * 原则：
 * - 只使用隔离测试 DB（better-sqlite3 :memory:），绝不触碰真实用户 CRM 数据。
 * - 统一执行全部经 PRODUCTION_CAPABILITY_EXECUTION（Registry → Input → Scope → A10 →
 *   确认交接）；确认后执行经现有产品确认流（SalesAgentSession.confirmWriteByRef →
 *   approvedCrmWriteBoundary → 共享产品服务 createCustomerWithProductRules）。
 * - 人工路径 A 显式复刻 CustomerForm create-mode 的原始组合（提取前语义），
 *   与能力路径 B 对比持久化真值，证明共享服务提取未改变产品语义。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createCapabilityBindingRegistry,
  createCapabilityExecutionEngine,
  createObservationBridge,
  createProductionCapabilityExecution,
  PRODUCTION_CAPABILITY_BINDINGS,
  PRODUCTION_CAPABILITY_BINDING_REGISTRY,
  PRODUCTION_CAPABILITY_COUNT,
  PRODUCTION_CAPABILITY_EXECUTION,
  PRODUCTION_CAPABILITY_IDS,
  PRODUCTION_CAPABILITY_REGISTRY,
  type CapabilityExecutorBinding,
  type CapabilityExecutionOutcome,
  type CapabilityInvocation,
  type CapabilityInvocationScope,
} from '../lib/capabilities/execution';
import { SALES_AGENT_CONFIRMATION_MECHANISM } from '../lib/capabilities/execution/writeAdapters';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/evidence/manifest';
import { createInMemoryObservationEmitter } from '../lib/capabilities/observation';

import {
  __setDbInstanceForTests,
  createCustomer,
  createTask,
  getCustomer,
  initializeDatabaseSchema,
  updateCustomer,
  type DatabaseLike,
} from '../lib/db';
import {
  applyIntentRule,
  applyWechatPassed,
  calculateNextFollowUpAt,
  getDefaultCustomerGrade,
} from '../lib/rules';
import { parseRoughTime } from '../lib/timeParser';
import type {
  Customer,
  CustomerGrade,
  IntentLevel,
  PhoneFeedback,
  TimeParseStatus,
  WechatAddStatus,
  WechatSearchStatus,
} from '../lib/types';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import {
  __resetSessionWriteStateStoreForTests,
  getCanonicalProposal,
} from '../lib/salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { sqliteFixture } from './salesAgentProductionHarness';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import type { ContextSnapshot } from '../lib/context/types';

const NOW = '2026-07-14T12:00:00.000Z';

/* ------------------------------------------------------------------ */
/* 测试 DB fixture（隔离 :memory:；与能力写集成测试同款）                */
/* ------------------------------------------------------------------ */

function openEmptyFixture() {
  const fixture = sqliteFixture();
  return fixture;
}

function makeSnapshotFixture(): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'w4-create-contract-fixture',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [
      { id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } },
    ],
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
}

function makeContextFixture(snapshot: LoadedReadOnlyAgentSnapshot): ContextSnapshot {
  return {
    kind: 'CRM_CONTEXT_SNAPSHOT',
    profile_id: 'foreign_trade_geo',
    captured_at: NOW,
    time_window: { from: '2026-07-01T00:00:00.000Z', to: NOW },
    customers: [],
    accounts: [],
    interactions: [],
  };
}

/* ------------------------------------------------------------------ */
/* 业务执行器计数 harness（只包 execute，不改生产绑定语义）                */
/* ------------------------------------------------------------------ */

function makeWriteCountingHarness() {
  const counters = new Map<string, number>();
  const wrapped: CapabilityExecutorBinding[] = PRODUCTION_CAPABILITY_BINDINGS.map((binding) => ({
    executor_ref: binding.executor_ref,
    validateInput: binding.validateInput,
    handoff: binding.handoff,
    execute: async (input: unknown, scope: CapabilityInvocationScope) => {
      counters.set(binding.executor_ref, (counters.get(binding.executor_ref) ?? 0) + 1);
      return binding.execute(input, scope);
    },
  }));
  const bindings = createCapabilityBindingRegistry(wrapped);
  const engine = createCapabilityExecutionEngine({
    registry: PRODUCTION_CAPABILITY_REGISTRY,
    bindings,
  });
  return { engine, callsFor: (ref: string) => counters.get(ref) ?? 0 };
}

/* ------------------------------------------------------------------ */
/* 确认后执行 helper（现有产品确认流；与 capabilityWriteProduction 同构）  */
/* ------------------------------------------------------------------ */

async function confirmViaExistingFlow(proposal: AgentWriteProposal): Promise<{ entity_id: string; fields: readonly string[] }> {
  const session = new SalesAgentSession(
    proposal.customer_id,
    null,
    () => SALES_AGENT_APP_CLOCK.now(),
    undefined,
  );
  return session.confirmWriteByRef({
    proposal_id: proposal.proposal_id,
    nonce: proposal.nonce ?? '',
    confirmed_at: SALES_AGENT_APP_CLOCK.now(),
  }, approvedCrmWriteBoundary) as Promise<{ entity_id: string; fields: readonly string[] }>;
}

/** 能力路径 B：invoke customer.create → 现有确认流 → 返回真实持久化 customer_id。 */
async function capabilityCreatePath(input: Record<string, unknown>): Promise<{ customer_id: string }> {
  const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
    capability_id: 'customer.create',
    capability_version: '1.0.0',
    input,
    scope: {},
  });
  expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  if (outcome.status !== 'CONFIRMATION_REQUIRED') throw new Error('unreachable');
  const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
  expect(proposal).not.toBeNull();
  expect(proposal!.tool_id).toBe('create_customer');
  const result = await confirmViaExistingFlow(proposal!);
  expect(result.entity_id).toBe(proposal!.customer_id);
  return { customer_id: proposal!.customer_id };
}

/* ------------------------------------------------------------------ */
/* 人工路径 A：显式复刻 CustomerForm create-mode 原始组合（提取前语义）     */
/* ------------------------------------------------------------------ */

interface HumanCreateInput {
  readonly id: string;
  readonly name: string;
  readonly wechat_id: string | null;
  readonly phone_number: string | null;
  readonly contact_method: string | null;
  readonly wechat_search_status: string | null;
  readonly is_key_decision_maker: number;
  readonly wechat_add_status: string;
  readonly intent_level: string;
  readonly phone_feedback: string | null;
  readonly rough_visit_time_text: string | null;
  readonly notes: string | null;
  readonly website: string | null;
  readonly region: string | null;
  readonly industry: string | null;
  readonly contact_person: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly pitch_angle: string | null;
  readonly qualification_reason: string | null;
  readonly source: string | null;
}

/** 与 CustomerForm.create-mode（提取前）逐语句一致的人工产品组合。 */
async function humanCreatePath(input: HumanCreateInput): Promise<void> {
  let parsedReminder: string | null = null;
  let parseStatus: TimeParseStatus = 'NOT_PARSED';
  let parseNote: string | null = null;
  if (input.rough_visit_time_text?.trim()) {
    const result = parseRoughTime(input.rough_visit_time_text.trim());
    parsedReminder = result.parsed_at;
    parseStatus = result.status;
    parseNote = result.note;
  }
  const grade: CustomerGrade = getDefaultCustomerGrade({
    wechat_search_status: input.wechat_search_status,
    is_key_decision_maker: input.is_key_decision_maker === 1,
  });
  const nextFollowUpAt = calculateNextFollowUpAt(grade);

  await createCustomer(
    input.id, input.name, input.contact_method, input.wechat_id, input.phone_number,
    input.wechat_search_status, input.is_key_decision_maker, grade, input.wechat_add_status,
    input.intent_level, input.phone_feedback, input.rough_visit_time_text, parsedReminder,
    parseStatus, parseNote, nextFollowUpAt, input.notes, input.website, input.region,
    input.industry, input.contact_person, input.email, input.address, input.pitch_angle,
    input.qualification_reason, input.source,
  );

  if (input.wechat_add_status === 'PASSED') {
    const now = new Date().toISOString();
    const dummyCustomer: Customer = {
      id: input.id, name: input.name, customer_grade: grade, stage: 'NEW_LEAD',
      contact_method: input.contact_method as Customer['contact_method'],
      wechat_id: input.wechat_id, phone_number: input.phone_number,
      wechat_search_status: input.wechat_search_status as WechatSearchStatus | null,
      is_key_decision_maker: input.is_key_decision_maker,
      wechat_add_status: 'NOT_ADDED' as WechatAddStatus,
      has_replied: 0, intent_level: input.intent_level as IntentLevel,
      phone_feedback: input.phone_feedback as PhoneFeedback | null,
      can_schedule_visit: 0, visit_scheduled_at: null,
      rough_visit_time_text: input.rough_visit_time_text,
      parsed_visit_reminder_at: parsedReminder,
      time_parse_status: parseStatus as Customer['time_parse_status'],
      time_parse_note: parseNote,
      next_follow_up_at: nextFollowUpAt, last_contacted_at: null,
      last_feedback_type: 'UNKNOWN', next_action: null,
      no_show_count: 0, lost_reason: null,
      payment_status: 'NOT_STARTED', deal_amount: null,
      paid_at: null, closed_at: null, notes: input.notes,
      website: input.website, region: input.region, industry: input.industry,
      contact_person: input.contact_person, email: input.email, address: input.address,
      pitch_angle: input.pitch_angle, qualification_reason: input.qualification_reason, source: input.source,
      created_at: now, updated_at: now,
    };
    const { customer: afterPass, tasks: wxTasks } = applyWechatPassed(dummyCustomer);
    await updateCustomer(input.id, { stage: afterPass.stage, next_follow_up_at: afterPass.next_follow_up_at });
    for (const task of wxTasks) {
      await createTask(task);
    }
  }

  if (input.intent_level === 'HIGH' || input.phone_feedback === 'CAN_MEET' || input.phone_feedback === 'INTERESTED') {
    const current = await getCustomer(input.id);
    if (current) {
      const { customer: afterIntent } = applyIntentRule(current, {
        intent_level: input.intent_level !== 'UNKNOWN' ? input.intent_level : null,
        phone_feedback: input.phone_feedback || null,
      });
      await updateCustomer(input.id, afterIntent);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 行读取 helper                                                       */
/* ------------------------------------------------------------------ */

type CustomerRow = Record<string, unknown>;

async function selectCustomerRow(db: DatabaseLike, id: string): Promise<CustomerRow | undefined> {
  const rows = await db.select<CustomerRow>('SELECT * FROM customers WHERE id = ?', [id]);
  return rows[0];
}

async function countRows(db: DatabaseLike, table: string, customerId?: string): Promise<number> {
  const rows = await db.select<{ n: number }>(
    customerId === undefined
      ? `SELECT COUNT(*) AS n FROM ${table}`
      : `SELECT COUNT(*) AS n FROM ${table} WHERE customer_id = ?`,
    customerId === undefined ? [] : [customerId],
  );
  return rows[0]?.n ?? 0;
}

beforeEach(() => {
  __resetSessionWriteStateStoreForTests();
});

afterEach(() => {
  __setDbInstanceForTests(null);
});

/* ================================================================== */
/* T1 — PRODUCT CAPABILITY DEFINITION                                  */
/* ================================================================== */

describe('T1 — PRODUCT CAPABILITY DEFINITION: customer.create exists exactly once with frozen metadata', () => {
  it('definition is registered exactly once with the frozen W4-1 contract metadata', () => {
    const definitions = PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.id === 'customer.create');
    expect(definitions).toHaveLength(1);
    const definition = definitions[0]!;
    expect(definition.version).toBe('1.0.0');
    expect(definition.domain).toBe('customer');
    expect(definition.effect).toBe('WRITE');
    expect(definition.data_target).toBe('CRM_FACT');
    expect(definition.risk_level).toBe('MEDIUM');
    expect(definition.authority_policy).toBe('POLICY_CONTROLLED');
    expect(definition.requires_confirmation).toBe(true);
    expect(definition.scope_requirement).toBe('NONE');
    expect(definition.idempotency).toBe('NONE');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:create_customer');
    expect(definition.audit_contract).toEqual({
      audit_required: true,
      record_input: true,
      record_output: false,
      record_effect: true,
    });
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.audit_contract)).toBe(true);
    // 契约词汇：A1 core types 未修改（定义使用现有词汇）
    expect(definition.error_contract).toBe('UNSPECIFIED');
  });
});

/* ================================================================== */
/* T2 — PRODUCTION COUNT                                               */
/* ================================================================== */

describe('T2 — PRODUCTION COUNT: registry becomes exactly 21; original 20 preserved; customer.create is the only new identity', () => {
  it('count = 21, all original 20 identities remain, only new identity is customer.create', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(21);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(21);
    const ids = PRODUCTION_CAPABILITY_IDS;
    const original20 = new Set(ids.filter((id) => id !== 'customer.create'));
    expect(original20.size).toBe(20);
    // 无第 22 个能力
    expect(ids).toHaveLength(21);
    // customer.create 是唯一新身份
    expect(ids.filter((id) => id === 'customer.create')).toEqual(['customer.create']);
    expect(ids).not.toContain('customer.profile.update');
    expect(ids).not.toContain('customer.delete');
    expect(ids).not.toContain('visit.create');
    expect(ids).not.toContain('import.execute');
  });

  it('all identities resolve with version 1.0.0', () => {
    for (const id of PRODUCTION_CAPABILITY_IDS) {
      expect(PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0').id).toBe(id);
    }
  });
});

/* ================================================================== */
/* T3 — PRODUCTION BINDING                                             */
/* ================================================================== */

describe('T3 — PRODUCTION BINDING: customer.create executor_ref resolves explicitly; unbound = 0', () => {
  it('binding count = 21 and customer.create executor_ref resolves to the create binding', () => {
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(21);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(21);
    const binding = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve('salesAgentWriteTool:create_customer');
    expect(binding).toBeDefined();
    expect(binding?.executor_ref).toBe('salesAgentWriteTool:create_customer');
    const unbound = PRODUCTION_CAPABILITY_IDS.filter((id) => {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      return PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref) === undefined;
    });
    expect(unbound).toEqual([]);
  });

  it('customer.create is the only new write binding (PRODUCTION_WRITE_BINDINGS has exactly 8)', async () => {
    const { PRODUCTION_WRITE_BINDINGS } = await import('../lib/capabilities/execution/writeAdapters');
    expect(PRODUCTION_WRITE_BINDINGS).toHaveLength(8);
    expect(PRODUCTION_WRITE_BINDINGS.map((b) => b.executor_ref)).toContain('salesAgentWriteTool:create_customer');
  });
});

/* ================================================================== */
/* T4 — INPUT WHITELIST                                                */
/* ================================================================== */

describe('T4 — INPUT WHITELIST: exact audited product input fields accepted', () => {
  it('full valid input reaches confirmation (handoff), never the business executor', async () => {
    const harness = makeWriteCountingHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: {
        name: '完整字段客户',
        wechat_id: 'wx-full',
        phone_number: '13800001111',
        contact_method: 'WECHAT',
        wechat_search_status: 'FOUND',
        is_key_decision_maker: 1,
        wechat_add_status: 'ADDED',
        intent_level: 'MEDIUM',
        phone_feedback: 'CAN_LEARN',
        rough_visit_time_text: '下周三',
        notes: '完整备注',
        website: 'https://example.com',
        region: '广州',
        industry: '软件',
        contact_person: '李经理',
        email: 'li@example.com',
        address: '天河区',
        pitch_angle: '降本增效',
        qualification_reason: '关键决策人',
        source: '转介绍',
      },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    if (outcome.status === 'CONFIRMATION_REQUIRED') {
      expect(outcome.confirmation_handoff?.mechanism).toBe(SALES_AGENT_CONFIRMATION_MECHANISM);
      const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
      expect(proposal).not.toBeNull();
      // 20 个字段全部进入提案（规范化后，人工确认所见即所得）
      for (const key of ['name', 'wechat_id', 'phone_number', 'contact_method', 'wechat_search_status', 'is_key_decision_maker', 'wechat_add_status', 'intent_level', 'phone_feedback', 'rough_visit_time_text', 'notes', 'website', 'region', 'industry', 'contact_person', 'email', 'address', 'pitch_angle', 'qualification_reason', 'source']) {
        expect(Object.prototype.hasOwnProperty.call(proposal!.proposed_values, key), key).toBe(true);
      }
      expect(proposal!.proposed_values.name).toBe('完整字段客户');
      expect(proposal!.proposed_values.wechat_add_status).toBe('ADDED');
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });

  it('empty strings normalize to product null semantics (form `value || null`) and product defaults apply', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '默认值客户', wechat_id: '', contact_method: '', wechat_add_status: '', intent_level: '', is_key_decision_maker: undefined },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    if (outcome.status === 'CONFIRMATION_REQUIRED') {
      const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
      expect(proposal?.proposed_values.wechat_id).toBeNull();
      expect(proposal?.proposed_values.contact_method).toBeNull();
      expect(proposal?.proposed_values.wechat_add_status).toBe('NOT_ADDED'); // 产品默认
      expect(proposal?.proposed_values.intent_level).toBe('UNKNOWN'); // 产品默认
      expect(proposal?.proposed_values.is_key_decision_maker).toBe(0); // 产品默认
    }
  });
});

/* ================================================================== */
/* T5 — SYSTEM FIELDS REJECTED                                         */
/* ================================================================== */

describe('T5 — SYSTEM FIELDS REJECTED: id / stage / grade / payment / timestamps / battle-card etc fail closed', () => {
  it('every system/rule/domain-owned field is rejected with INVALID_INPUT', async () => {
    const harness = makeWriteCountingHarness();
    const forbiddenFieldCases: Array<[string, unknown]> = [
      ['id', 'x'],
      ['created_at', NOW],
      ['updated_at', NOW],
      ['stage', 'PAID'],
      ['has_replied', 1],
      ['can_schedule_visit', 1],
      ['visit_scheduled_at', NOW],
      ['last_contacted_at', NOW],
      ['last_feedback_type', 'POSITIVE'],
      ['next_action', 'CLOSE'],
      ['no_show_count', 3],
      ['lost_reason', 'x'],
      ['payment_status', 'PAID'],
      ['deal_amount', 1000],
      ['paid_at', NOW],
      ['closed_at', NOW],
      ['current_stage_card_id', 'card-x'],
      ['battle_card_status', 'CONFIRMED'],
      ['last_battle_review_at', NOW],
      ['parsed_visit_reminder_at', NOW],
      ['time_parse_status', 'PARSED'],
      ['time_parse_note', 'x'],
      ['next_follow_up_at', NOW],
      ['customer_grade', 'A'],
    ];
    for (const [field, value] of forbiddenFieldCases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input: { name: '系统字段注入', [field]: value },
        scope: {},
      });
      expect(outcome.status, `${field} must fail closed`).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, `${field} must fail in the input layer`).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });
});

/* ================================================================== */
/* T6 — NAME REQUIRED                                                  */
/* ================================================================== */

describe('T6 — NAME REQUIRED: missing / empty / blank name invalid', () => {
  it('missing, empty, and whitespace-only name all fail closed', async () => {
    const harness = makeWriteCountingHarness();
    for (const input of [
      {},
      { name: '' },
      { name: '   ' },
    ]) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input,
        scope: {},
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });
});

/* ================================================================== */
/* T7 — ENUM VALIDATION                                                */
/* ================================================================== */

describe('T7 — ENUM VALIDATION: invalid product enum rejected', () => {
  it('wrong contact_method / wechat_search_status / wechat_add_status / intent_level / phone_feedback fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const cases: Array<Record<string, unknown>> = [
      { name: 'x', contact_method: 'FAX' },
      { name: 'x', wechat_search_status: 'NOPE' },
      { name: 'x', wechat_add_status: 'MAYBE' },
      { name: 'x', intent_level: 'SORT_OF' },
      { name: 'x', phone_feedback: 'WRONG' },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input,
        scope: {},
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });

  it('is_key_decision_maker only accepts real representation 0/1', async () => {
    const harness = makeWriteCountingHarness();
    for (const bad of [2, -1, '1', true, null]) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input: { name: 'x', is_key_decision_maker: bad },
        scope: {},
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });
});

/* ================================================================== */
/* T8 — MASS ASSIGNMENT CLOSED                                         */
/* ================================================================== */

describe('T8 — MASS ASSIGNMENT CLOSED: unknown keys fail closed (no mass assignment, no silent drop)', () => {
  it('unknown top-level keys and nested arbitrary objects fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const cases: Array<Record<string, unknown>> = [
      { name: 'x', extra_field: 1 },
      { name: 'x', notes_extra: 'x' },
      { name: 'x', meta: { stage: 'PAID' } },
      { name: 'x', nested: { customer_grade: 'A' } },
      { name: 'x', rows: [{ name: 'y' }] },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input,
        scope: {},
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });

  it('wrong primitive types fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const cases: Array<Record<string, unknown>> = [
      { name: 42 },
      { name: 'x', wechat_id: 7 },
      { name: 'x', notes: ['array'] },
      { name: 'x', source: { deep: 'object' } },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input,
        scope: {},
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });
});

/* ================================================================== */
/* T9 — SCOPE NONE                                                     */
/* ================================================================== */

describe('T9 — SCOPE NONE: customer.create executes scope validation with NONE (no customer scope required)', () => {
  it('empty scope passes scope validation and reaches A10 confirmation (never INVALID_SCOPE)', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '无范围客户' },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  });
});

/* ================================================================== */
/* T10 — CUSTOMER SELECTOR SMUGGLING REJECTED                          */
/* ================================================================== */

describe('T10 — CUSTOMER SELECTOR SMUGGLING REJECTED: customer_id / customerId input rejected', () => {
  it('customer_id / customerId in input fail closed (INVALID_INPUT), executor never runs', async () => {
    const harness = makeWriteCountingHarness();
    for (const key of ['customer_id', 'customerId']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input: { name: 'x', [key]: 'some-existing-customer' },
        scope: {},
      });
      expect(outcome.status, key).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, key).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
  });
});

/* ================================================================== */
/* T11 — A10 DECISION                                                  */
/* ================================================================== */

describe('T11 — A10 DECISION: exact REQUIRE_CONFIRMATION + EXPLICIT_CONFIRMATION_REQUIRED', () => {
  it('evaluateAuthorityPolicy produces the frozen decision', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.create', '1.0.0');
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.capability_id).toBe('customer.create');
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
  });
});

/* ================================================================== */
/* T12 — PRE-CONFIRM ZERO BUSINESS WRITES                              */
/* ================================================================== */

describe('T12 — PRE-CONFIRM ZERO BUSINESS WRITES: createCustomer=0, customer UPDATE=0, task create=0 before confirmation', () => {
  it('after unified execution (confirmation required), zero customer rows, zero tasks, zero updates', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    const harness = makeWriteCountingHarness();
    try {
      expect(await countRows(fixture.db, 'customers')).toBe(0);
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input: { name: '确认前客户', intent_level: 'HIGH', wechat_add_status: 'PASSED' },
        scope: {},
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      // 无 INSERT：customers 表仍为空；无任务；无任何客户可 UPDATE
      expect(await countRows(fixture.db, 'customers')).toBe(0);
      expect(await countRows(fixture.db, 'tasks')).toBe(0);
      // 业务执行器（create_customer）调用数 = 0
      expect(harness.callsFor('salesAgentWriteTool:create_customer')).toBe(0);
      // 无规则驱动的 DB 写：确认前没有客户行可被 Rule 2/3 更新
      expect(await countRows(fixture.db, 'customers')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T13 — CONFIRMATION HANDOFF                                          */
/* ================================================================== */

describe('T13 — CONFIRMATION HANDOFF: truthful existing confirmation mechanism receives the proposal', () => {
  it('handoff returns existing mechanism + proposal_id; proposal is in the existing store with whitelisted values and rule disclosure', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '交接客户', rough_visit_time_text: '下周五', intent_level: 'HIGH' },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    if (outcome.status === 'CONFIRMATION_REQUIRED') {
      expect(outcome.confirmation_handoff?.mechanism).toBe(SALES_AGENT_CONFIRMATION_MECHANISM);
      const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
      expect(proposal).not.toBeNull();
      expect(proposal!.tool_id).toBe('create_customer');
      expect(proposal!.operation).toBe('create');
      expect(proposal!.entity_type).toBe('customer');
      expect(proposal!.customer_id).toBeTruthy(); // 交接时生成的新客户身份
      expect(proposal!.proposed_values.name).toBe('交接客户');
      expect(proposal!.proposed_values.intent_level).toBe('HIGH');
      // 副作用如实披露：提案 reason 说明确认后现有产品规则也可能运行
      expect(proposal!.reason).toMatch(/规则/);
      expect(proposal!.status).toBe('awaiting_confirmation');
      expect(proposal!.requires_confirmation).toBe(true);
      // 提案只含 20 个表单字段（无系统字段）
      const keys = Object.keys(proposal!.proposed_values).sort();
      expect(keys).toEqual([
        'address', 'contact_method', 'contact_person', 'email', 'industry',
        'intent_level', 'is_key_decision_maker', 'name', 'notes', 'phone_feedback',
        'phone_number', 'pitch_angle', 'qualification_reason', 'region',
        'rough_visit_time_text', 'source', 'website', 'wechat_add_status', 'wechat_id',
        'wechat_search_status',
      ]);
    }
  });
});

/* ================================================================== */
/* T14 — NO NEW CONFIRMATION SYSTEM                                    */
/* ================================================================== */

describe('T14 — NO NEW CONFIRMATION SYSTEM: existing store/runtime reused', () => {
  it('customer.create handoff reuses the existing canonical-proposal store (sessionWriteStateStore)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/writeAdapters.ts'), 'utf8');
    expect(source).toContain("from '../../salesAgentTools/confirmedWrite'");
    expect(source).toContain("from '../../salesAgentTools/sessionWriteStateStore'");
    expect(source).toContain('registerCanonicalProposal');
    expect(source).toContain('buildWriteProposal');
    // 不创建任何新的确认/提案存储：无 localStorage / IndexedDB / 新 Map 存储 / 新表
    expect(source).not.toMatch(/localStorage|indexedDB|createProposalTable|new Map<string, [^)]*proposal/i);
  });

  it('the handoff artifact is a canonical proposal in the existing store, not a new one', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '复用现有机制的提案' },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    if (outcome.status === 'CONFIRMATION_REQUIRED') {
      const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
      expect(proposal?.proposal_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(proposal?.status).toBe('awaiting_confirmation');
    }
  });
});

/* ================================================================== */
/* T15 — CONFIRMED CREATE REAL DB PATH                                 */
/* ================================================================== */

describe('T15 — CONFIRMED CREATE REAL DB PATH: after isolated human-confirm simulation one customer is actually persisted', () => {
  it('exactly one customer row is created with the generated customer_id as the actual persisted identity', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const { customer_id } = await capabilityCreatePath({
        name: '确认后客户',
        wechat_id: 'wx-confirmed',
        phone_number: '13900002222',
      });
      expect(await countRows(fixture.db, 'customers')).toBe(1);
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row).toBeDefined();
      expect(row!.name).toBe('确认后客户');
      expect(row!.wechat_id).toBe('wx-confirmed');
      expect(row!.phone_number).toBe('13900002222');
      // 生成的 customer_id 即实际持久化身份
      expect(row!.id).toBe(customer_id);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('confirming the same proposal twice is rejected (replay) and does not duplicate the customer', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input: { name: '防重放客户' },
        scope: {},
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      expect(proposal).not.toBeNull();
      await confirmViaExistingFlow(proposal!);
      await expect(confirmViaExistingFlow(proposal!)).rejects.toThrow(/replay/i);
      expect(await countRows(fixture.db, 'customers')).toBe(1);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T16 — PRODUCT DEFAULT PARITY                                        */
/* ================================================================== */

describe('T16 — PRODUCT DEFAULT PARITY: stage/system defaults match human product flow', () => {
  it('new customer row carries the same system defaults as the human create flow', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const { customer_id } = await capabilityCreatePath({ name: '默认字段客户' });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.stage).toBe('NEW_LEAD');
      expect(row!.has_replied).toBe(0);
      expect(row!.can_schedule_visit).toBe(0);
      expect(row!.visit_scheduled_at).toBeNull();
      expect(row!.last_contacted_at).toBeNull();
      expect(row!.last_feedback_type).toBe('UNKNOWN');
      expect(row!.next_action).toBeNull();
      expect(row!.no_show_count).toBe(0);
      expect(row!.lost_reason).toBeNull();
      expect(row!.payment_status).toBe('NOT_STARTED');
      expect(row!.deal_amount).toBeNull();
      expect(row!.paid_at).toBeNull();
      expect(row!.closed_at).toBeNull();
      expect(row!.current_stage_card_id).toBeNull();
      expect(row!.battle_card_status).toBe('NONE');
      expect(row!.last_battle_review_at).toBeNull();
      expect(row!.wechat_add_status).toBe('NOT_ADDED'); // 产品默认
      expect(row!.intent_level).toBe('UNKNOWN'); // 产品默认
      expect(row!.is_key_decision_maker).toBe(0); // 产品默认
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T17 — PRODUCT GRADE PARITY                                          */
/* ================================================================== */

describe('T17 — PRODUCT GRADE PARITY: initial grade matches CustomerForm/product rule truth', () => {
  it('grade equals getDefaultCustomerGrade for the same inputs', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const { customer_id } = await capabilityCreatePath({
        name: '等级对等客户',
        wechat_search_status: 'NOT_FOUND',
        is_key_decision_maker: 1,
      });
      const row = await selectCustomerRow(fixture.db, customer_id);
      const expected = getDefaultCustomerGrade({ wechat_search_status: 'NOT_FOUND', is_key_decision_maker: true });
      expect(expected).toBe('D'); // 搜索异常/找不到 → D（优先于 KP）
      expect(row!.customer_grade).toBe(expected);

      const { customer_id: id2 } = await capabilityCreatePath({
        name: '等级对等客户B',
        wechat_search_status: 'FOUND',
        is_key_decision_maker: 1,
      });
      const row2 = await selectCustomerRow(fixture.db, id2);
      expect(row2!.customer_grade).toBe(getDefaultCustomerGrade({ wechat_search_status: 'FOUND', is_key_decision_maker: true }));
      expect(row2!.customer_grade).toBe('B');

      const { customer_id: id3 } = await capabilityCreatePath({ name: '等级对等客户C' });
      const row3 = await selectCustomerRow(fixture.db, id3);
      expect(row3!.customer_grade).toBe(getDefaultCustomerGrade({}));
      expect(row3!.customer_grade).toBe('C');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T18 — TIME PARSE PARITY                                             */
/* ================================================================== */

describe('T18 — TIME PARSE PARITY: rough_visit_time_text produces the same derived parse fields', () => {
  it('time_parse_status / note match parseRoughTime; parsed_at within the same derivation moment', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const text = '下周二下午';
      const expected = parseRoughTime(text);
      const { customer_id } = await capabilityCreatePath({ name: '时间解析客户', rough_visit_time_text: text });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.time_parse_status).toBe(expected.status);
      expect(row!.time_parse_status).toBe('PARSED');
      expect(row!.time_parse_note).toBe(expected.note);
      // 同一产品函数、同一输入、同一时刻（毫秒级差异容忍）
      expect(Math.abs(Date.parse(String(row!.parsed_visit_reminder_at)) - Date.parse(expected.parsed_at!))).toBeLessThan(60_000);
      expect(row!.rough_visit_time_text).toBe(text);

      // 无法解析的文本 → NEEDS_CONFIRMATION（与产品一致）
      const { customer_id: id2 } = await capabilityCreatePath({ name: '时间解析客户B', rough_visit_time_text: '随意写一段' });
      const row2 = await selectCustomerRow(fixture.db, id2);
      const expected2 = parseRoughTime('随意写一段');
      expect(expected2.status).toBe('NEEDS_CONFIRMATION');
      expect(row2!.time_parse_status).toBe('NEEDS_CONFIRMATION');
      expect(row2!.parsed_visit_reminder_at).toBeNull();

      // 空文本 → NOT_PARSED（与产品一致）
      const { customer_id: id3 } = await capabilityCreatePath({ name: '时间解析客户C', rough_visit_time_text: '' });
      const row3 = await selectCustomerRow(fixture.db, id3);
      expect(row3!.time_parse_status).toBe('NOT_PARSED');
      expect(row3!.parsed_visit_reminder_at).toBeNull();
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T19 — NEXT FOLLOW-UP PARITY                                         */
/* ================================================================== */

describe('T19 — NEXT FOLLOW-UP PARITY: same product calculation as human flow', () => {
  it('next_follow_up_at equals calculateNextFollowUpAt(initial grade) at the same moment', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const { customer_id } = await capabilityCreatePath({ name: '跟进对等客户' });
      const row = await selectCustomerRow(fixture.db, customer_id);
      const expected = calculateNextFollowUpAt(row!.customer_grade as CustomerGrade);
      expect(Math.abs(Date.parse(String(row!.next_follow_up_at)) - Date.parse(expected))).toBeLessThan(60_000);
      // 默认 C 级 → 8 天后的 09:30
      expect(row!.customer_grade).toBe('C');
      const expectedC = calculateNextFollowUpAt('C');
      const dayDiff = (Date.parse(String(row!.next_follow_up_at)) - Date.parse(expectedC)) / 86_400_000;
      expect(Math.abs(dayDiff)).toBeLessThan(0.001);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T20 — POST-CREATE RULE PARITY                                       */
/* ================================================================== */

describe('T20 — POST-CREATE RULE PARITY: where audited inputs trigger actual product post-create rules, Agent path matches human path', () => {
  it('Rule 2 (wechat PASSED): stage → WECHAT_PASSED + one RULE task created (no upgrade)', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const { customer_id } = await capabilityCreatePath({ name: '微信通过客户', wechat_add_status: 'PASSED' });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.stage).toBe('WECHAT_PASSED');
      expect(row!.customer_grade).toBe('C'); // 不升级
      expect(await countRows(fixture.db, 'tasks', customer_id)).toBe(1);
      const task = (await fixture.db.select<{ title: string; source: string; status: string; priority: string }>(
        'SELECT title, source, status, priority FROM tasks WHERE customer_id = ?', [customer_id],
      ))[0];
      expect(task?.source).toBe('RULE');
      expect(task?.status).toBe('OPEN');
      expect(task?.priority).toBe('MEDIUM');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('Rule 3 (intent HIGH / phone CAN_MEET / INTERESTED): grade → A with product stage/next_action semantics', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const { customer_id } = await capabilityCreatePath({ name: '高意向客户', intent_level: 'HIGH' });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.customer_grade).toBe('A');
      expect(row!.stage).toBe('REPLIED');
      expect(row!.next_action).toBe('SCHEDULE_VISIT');
      expect(row!.intent_level).toBe('HIGH');

      const { customer_id: id2 } = await capabilityCreatePath({ name: '可面见客户', phone_feedback: 'CAN_MEET' });
      const row2 = await selectCustomerRow(fixture.db, id2);
      expect(row2!.customer_grade).toBe('A');
      expect(row2!.stage).toBe('VISIT_READY');
      expect(row2!.next_action).toBe('SCHEDULE_VISIT');

      const { customer_id: id3 } = await capabilityCreatePath({ name: '有兴趣客户', phone_feedback: 'INTERESTED' });
      const row3 = await selectCustomerRow(fixture.db, id3);
      expect(row3!.customer_grade).toBe('A');
      expect(row3!.stage).toBe('REPLIED');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('no post-create rules run when no rule triggers (plain NOT_ADDED / UNKNOWN stays untouched)', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const { customer_id } = await capabilityCreatePath({ name: '无规则客户' });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.stage).toBe('NEW_LEAD');
      expect(row!.customer_grade).toBe('C');
      expect(await countRows(fixture.db, 'tasks', customer_id)).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T21 — DUPLICATES NOT INVENTED                                       */
/* ================================================================== */

describe('T21 — DUPLICATES NOT INVENTED: capability does not silently add uniqueness/dedup semantics absent in product', () => {
  it('two confirmed creates with identical name/phone persist two rows (product permits duplicates)', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const input = { name: '同名客户', phone_number: '13000001111' };
      const first = await capabilityCreatePath(input);
      const second = await capabilityCreatePath(input);
      expect(first.customer_id).not.toBe(second.customer_id);
      expect(await countRows(fixture.db, 'customers')).toBe(2);
      const rows = await fixture.db.select<{ id: string; name: string }>('SELECT id, name FROM customers');
      expect(rows.map((r) => r.name)).toEqual(['同名客户', '同名客户']);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T22 — OUTPUT MINIMIZED                                              */
/* ================================================================== */

describe('T22 — OUTPUT MINIMIZED: result is customer_id-level, not a full raw row', () => {
  it('shared product service returns exactly { customer_id }', async () => {
    const { createCustomerWithProductRules } = await import('../lib/customerCreate');
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const result = await createCustomerWithProductRules({ id: 'minimal-output', name: '最小输出客户' });
      expect(Object.keys(result).sort()).toEqual(['customer_id']);
      expect(result.customer_id).toBe('minimal-output');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('confirmed boundary returns entity_id (the customer_id) with bounded field list, not a full row', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input: { name: '最小输出确认客户', notes: '备注字段' },
        scope: {},
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      const result = await confirmViaExistingFlow(proposal!);
      expect(result.entity_id).toBe(proposal!.customer_id);
      // fields = 20 个白名单键（规范化后含产品默认值）——有界、无系统字段、绝非完整行
      expect(result.fields).toHaveLength(20);
      expect(result.fields.sort()).toEqual([
        'address', 'contact_method', 'contact_person', 'email', 'industry',
        'intent_level', 'is_key_decision_maker', 'name', 'notes', 'phone_feedback',
        'phone_number', 'pitch_angle', 'qualification_reason', 'region',
        'rough_visit_time_text', 'source', 'website', 'wechat_add_status', 'wechat_id',
        'wechat_search_status',
      ]);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T23 — OBSERVATION PRE-CONFIRM                                       */
/* ================================================================== */

describe('T23 — OBSERVATION PRE-CONFIRM: STARTED → AUTHORITY_DECIDED → CONFIRMATION_REQUIRED with same invocation_id', () => {
  it('customer.create lifecycle emits the exact three events, same invocation_id, scope NONE', async () => {
    const emitter = createInMemoryObservationEmitter();
    const bridge = createObservationBridge(emitter);
    const engine = createProductionCapabilityExecution(bridge.observer);
    const outcome = await engine.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '观察生命周期客户' },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    expect(events[1].authority_decision).toBe('REQUIRE_CONFIRMATION');
    expect(events[1].authority_reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
    expect(events[2].confirmation_state).toBe('REQUIRED');
    expect(events.every((e) => e.scope_type === 'NONE' && e.scope_id === null)).toBe(true);
    expect(events.every((e) => e.capability_id === 'customer.create')).toBe(true);
    // 无执行事件（确认前业务执行器调用数 = 0）
    expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
  });
});

/* ================================================================== */
/* T24 — RAW PAYLOAD NOT LOGGED                                        */
/* ================================================================== */

describe('T24 — RAW PAYLOAD NOT LOGGED: Observation remains payload-minimal', () => {
  it('events carry no business payload (no name / notes / wechat / secrets)', async () => {
    const emitter = createInMemoryObservationEmitter();
    const bridge = createObservationBridge(emitter);
    const engine = createProductionCapabilityExecution(bridge.observer);
    const secretMarker = '机密备注内容-RAW-PAYLOAD-MARKER';
    await engine.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '载荷最小化客户', notes: secretMarker, wechat_id: 'wx-secret' },
      scope: {},
    });
    const serialized = JSON.stringify(emitter.events());
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain('wx-secret');
    expect(serialized).not.toContain('载荷最小化客户');
    for (const event of emitter.events()) {
      expect(Object.keys(event).sort()).toEqual([
        'authority_decision', 'authority_reason_code', 'capability_id', 'capability_version',
        'confirmation_required', 'confirmation_state', 'error_code', 'event_id', 'event_type',
        'executor_ref', 'invocation_id', 'result_status', 'scope_id', 'scope_type', 'timestamp',
      ]);
    }
  });
});

/* ================================================================== */
/* T25 — REPLAY SEPARATION                                             */
/* ================================================================== */

describe('T25 — REPLAY SEPARATION: nonce / invocation / idempotency remain separate concepts', () => {
  it('definition idempotency = NONE; invocation_id is never the proposal nonce/proposal_id; identical retries create distinct proposals', async () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.create', '1.0.0');
    expect(definition.idempotency).toBe('NONE');
    const first = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '重试分离客户' },
      scope: {},
    });
    const second = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '重试分离客户' },
      scope: {},
    });
    expect(first.status).toBe('CONFIRMATION_REQUIRED');
    expect(second.status).toBe('CONFIRMATION_REQUIRED');
    if (first.status === 'CONFIRMATION_REQUIRED' && second.status === 'CONFIRMATION_REQUIRED') {
      const p1 = getCanonicalProposal(first.confirmation_handoff!.proposal_id);
      const p2 = getCanonicalProposal(second.confirmation_handoff!.proposal_id);
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      // invocation_id 是"一次被尝试的调用"身份：每次调用独立
      expect(first.invocation_id).not.toBe(second.invocation_id);
      // 提案身份（proposal_id / nonce）与 invocation_id 分离
      expect(p1!.proposal_id).not.toBe(first.invocation_id);
      expect(p1!.nonce).not.toBe(first.invocation_id);
      expect(p1!.proposal_id).not.toBe(p2!.proposal_id);
      expect(p1!.nonce).not.toBe(p2!.nonce);
    }
  });

  it('re-confirming a consumed proposal is rejected; business retry via a NEW invocation is a separate operation', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const first = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.create',
        capability_version: '1.0.0',
        input: { name: '重放分离客户' },
        scope: {},
      });
      expect(first.status).toBe('CONFIRMATION_REQUIRED');
      const p1 = getCanonicalProposal((first as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      await confirmViaExistingFlow(p1!);
      // 同一 nonce 重放 → 拒绝（现有 confirmation nonce 保护，与业务幂等分离）
      await expect(confirmViaExistingFlow(p1!)).rejects.toThrow(/replay/i);
      // 新的 invocation（业务重试）→ 新提案 → 确认后创建第二个客户（业务不幂等）
      const second = await capabilityCreatePath({ name: '重放分离客户' });
      expect(second.customer_id).not.toBe(p1!.customer_id);
      expect(await countRows(fixture.db, 'customers')).toBe(2);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T26 — EXISTING 20 REGRESSION                                        */
/* ================================================================== */

describe('T26 — EXISTING 20 REGRESSION: representative current capabilities remain unchanged', () => {
  it('customer.get (READ) / follow_up.global.read (GLOBAL) / import.mapping.validate (ANALYZE) still SUCCESS; task.create still CONFIRMATION_REQUIRED', async () => {
    const snapshot = makeSnapshotFixture();
    const context = makeContextFixture(snapshot);
    const customerGet = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(customerGet.status).toBe('SUCCESS');

    const globalFollowUps = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'follow_up.global.read',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(globalFollowUps.status).toBe('SUCCESS');

    const mapping = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'import.mapping.validate',
      capability_version: '1.0.0',
      input: [{ sourceColumn: '客户名称', crmField: 'name' }],
      scope: {},
    });
    expect(mapping.status).toBe('SUCCESS');

    const taskCreate = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'task.create',
      capability_version: '1.0.0',
      input: { title: '回归任务' },
      scope: { customer_id: 'customer-1' },
    });
    expect(taskCreate.status).toBe('CONFIRMATION_REQUIRED');
  });
});

/* ================================================================== */
/* T27 — NO WAVE-4 LEAKAGE                                             */
/* ================================================================== */

describe('T27 — NO WAVE-4 LEAKAGE: customer.profile.update / customer.delete / visit.create / import.execute remain absent', () => {
  it('none of the other Wave-4 candidate identities are registered', () => {
    const ids = PRODUCTION_CAPABILITY_IDS;
    for (const forbidden of ['customer.profile.update', 'customer.delete', 'visit.create', 'import.execute', 'customer.update']) {
      expect(ids).not.toContain(forbidden);
    }
  });
});

/* ================================================================== */
/* T28 — NO V0.2B / V0.3 LEAKAGE                                       */
/* ================================================================== */

describe('T28 — NO V0.2B / V0.3 LEAKAGE: no Evidence capability; no Agent loop / planner in the create path', () => {
  it('evidence domain still contributes zero capabilities', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    expect(PRODUCTION_CAPABILITY_IDS.some((id) => id.startsWith('evidence'))).toBe(false);
  });

  it('customer.create manifest + shared service contain no planner / Agent-loop / model / provider machinery', () => {
    const files = [
      'src/lib/capabilities/customer/createManifest.ts',
      'src/lib/customerCreate.ts',
    ];
    for (const file of files) {
      const codeOnly = readFileSync(resolve(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(codeOnly, `${file} must not reference V0.3 machinery`).not.toMatch(/\bwhile\s*\(|planner|agentLoop|deepseek|openai|anthropic|model_caller|ProductionModelCaller|\bllm\b/i);
    }
  });
});

/* ================================================================== */
/* §23 — REAL PRODUCT GOLDEN PATH PARITY (A vs B)                      */
/* ================================================================== */

describe('§23 — REAL PRODUCT GOLDEN PATH PARITY: human-product composition (A) vs confirmed customer.create capability path (B) persist equivalent product truth', () => {
  it('user-editable fields, derived grade, time parse fields, next follow-up, stage/defaults, and post-create rule effects match', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      const common = {
        name: '黄金路径客户',
        wechat_id: 'wx-golden',
        phone_number: '13700003333',
        contact_method: 'WECHAT',
        wechat_search_status: 'FOUND',
        is_key_decision_maker: 1,
        wechat_add_status: 'PASSED', // 触发 Rule 2
        intent_level: 'MEDIUM',
        phone_feedback: 'INTERESTED', // 触发 Rule 3
        rough_visit_time_text: '下周二下午',
        notes: '黄金路径备注',
        website: 'https://golden.example.com',
        region: '广州',
        industry: '软件',
        contact_person: '王总',
        email: 'wang@golden.example.com',
        address: '海珠区',
        pitch_angle: '降本增效',
        qualification_reason: '关键决策人',
        source: '线下活动',
      };

      // A：人工产品语义组合（CustomerForm create-mode 原始组合）
      await humanCreatePath({ id: 'golden-human-A', ...common });
      // B：确认后 customer.create 能力路径
      const { customer_id: idB } = await capabilityCreatePath({ ...common });

      const rowA = await selectCustomerRow(fixture.db, 'golden-human-A');
      const rowB = await selectCustomerRow(fixture.db, idB);
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();

      // 用户可编辑字段：完全相等
      for (const field of [
        'name', 'wechat_id', 'phone_number', 'contact_method', 'wechat_search_status',
        'is_key_decision_maker', 'wechat_add_status', 'intent_level', 'phone_feedback',
        'rough_visit_time_text', 'notes', 'website', 'region', 'industry', 'contact_person',
        'email', 'address', 'pitch_angle', 'qualification_reason', 'source',
      ]) {
        expect(rowB![field], `user-editable field ${field} must match`).toEqual(rowA![field]);
      }

      // 派生等级 / 阶段 / 状态 / 规则结果：完全相等
      for (const field of [
        'customer_grade', 'stage', 'has_replied', 'can_schedule_visit', 'visit_scheduled_at',
        'last_contacted_at', 'last_feedback_type', 'next_action', 'no_show_count', 'lost_reason',
        'payment_status', 'deal_amount', 'paid_at', 'closed_at', 'current_stage_card_id',
        'battle_card_status', 'last_battle_review_at', 'time_parse_status', 'time_parse_note',
      ]) {
        expect(rowB![field], `derived field ${field} must match`).toEqual(rowA![field]);
      }

      // 时间派生字段：同一产品函数、同一输入、同一时刻 → 毫秒级差异（允许 60s 容差）
      expect(rowA!.time_parse_status).toBe('PARSED');
      expect(rowB!.time_parse_status).toBe('PARSED');
      expect(Math.abs(Date.parse(String(rowB!.parsed_visit_reminder_at)) - Date.parse(String(rowA!.parsed_visit_reminder_at)))).toBeLessThan(60_000);
      expect(Math.abs(Date.parse(String(rowB!.next_follow_up_at)) - Date.parse(String(rowA!.next_follow_up_at)))).toBeLessThan(60_000);
      expect(Math.abs(Date.parse(String(rowB!.created_at)) - Date.parse(String(rowA!.created_at)))).toBeLessThan(60_000);
      expect(Math.abs(Date.parse(String(rowB!.updated_at)) - Date.parse(String(rowA!.updated_at)))).toBeLessThan(60_000);

      // 后置规则真值：Rule 2 任务（每路径恰好一条 RULE 任务）
      expect(await countRows(fixture.db, 'tasks', 'golden-human-A')).toBe(1);
      expect(await countRows(fixture.db, 'tasks', idB)).toBe(1);
      const taskA = (await fixture.db.select<{ title: string; source: string }>('SELECT title, source FROM tasks WHERE customer_id = ?', ['golden-human-A']))[0];
      const taskB = (await fixture.db.select<{ title: string; source: string }>('SELECT title, source FROM tasks WHERE customer_id = ?', [idB]))[0];
      expect(taskA?.source).toBe('RULE');
      expect(taskB?.source).toBe('RULE');
      expect(taskB?.title).toBe(taskA?.title);

      // 规则组合真值：Rule 2 + Rule 3 同时触发 → 最终 stage=REPLIED / grade=A / next_action=SCHEDULE_VISIT
      expect(rowA!.stage).toBe('REPLIED');
      expect(rowB!.stage).toBe('REPLIED');
      expect(rowA!.customer_grade).toBe('A');
      expect(rowB!.customer_grade).toBe('A');
      expect(rowA!.next_action).toBe('SCHEDULE_VISIT');
      expect(rowB!.next_action).toBe('SCHEDULE_VISIT');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});
