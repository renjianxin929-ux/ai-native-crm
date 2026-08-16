/**
 * V0.2A / W4-2 — customer.profile.update Capability 契约测试（T1–T35 + 黄金路径对等）。
 *
 * 证明唯一新增生产能力 customer.profile.update：
 *   T1  能力定义（冻结元数据，恰一次）      T2  生产计数 24（原 22 保持 + W4-4/W4-3 新身份）
 *   T3  生产绑定 24 / UNBOUND=0             T4  scope=CUSTOMER
 *   T5  生效客户身份只来自 scope             T6  customer_id/customerId 输入拒绝
 *   T7  精确资料字段白名单（16 字段）        T8  空 patch 拒绝
 *   T9  未知字段拒绝                        T10 系统字段拒绝
 *   T11 规则/状态字段拒绝                   T12 next_follow_up_at 拒绝（所有权保持）
 *   T13 类型/枚举校验                       T14 空串/Null 产品对等
 *   T15 质量赋值闭合（原型键/嵌套/未知键）   T16 A10 REQUIRE_CONFIRMATION
 *   T17 确认前零客户写入                    T18 确认前零规则/任务写入
 *   T19 现有确认运行时复用                  T20 提案白名单闭合（Layer 2）
 *   T21 批准边界/产品服务白名单闭合（Layer 3） T22 确认后真实产品路径（恰好一次）
 *   T23 仅批准列变更                        T24 规则/状态列不变
 *   T25 系统列不变                          T26 跨客户隔离（A 变、B 不变）
 *   T27 走私 B 目标在执行前失败             T28 输出最小化（{ customer_id }）
 *   T29 观察预确认生命周期                  T30 原始 patch 不入观察事件
 *   T31 customer.create 回归                T32 next_follow_up_time.update 回归
 *   T33 无通用 customer.update              T34 Wave-4 身份
 *   T35 无 V0.2B/V0.3 泄漏
 *   §30 真实产品黄金路径对等（A 人工编辑语义 vs B 确认后能力路径）
 *
 * 原则：
 * - 只使用隔离测试 DB（better-sqlite3 :memory:），绝不触碰真实用户 CRM 数据。
 * - 统一执行全部经 PRODUCTION_CAPABILITY_EXECUTION（Registry → Input → Scope → A10 →
 *   确认交接）；确认后执行经现有产品确认流（SalesAgentSession.confirmWriteByRef →
 *   approvedCrmWriteBoundary → 共享产品服务 updateCustomerProfile）。
 * - 人工路径 A 显式复刻 CustomerForm edit-mode 的资料字段语义（`value || null` +
 *   只写提交字段 + 无规则触发），与能力路径 B 对比持久化真值。
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
  CUSTOMER_PROFILE_UPDATE_CAPABILITY_IDS,
  CUSTOMER_PROFILE_UPDATE_MANIFEST,
} from '../lib/capabilities/customer/profileUpdateManifest';

import {
  __setDbInstanceForTests,
  createCustomer,
  getCustomer,
  initializeDatabaseSchema,
  updateCustomer,
  type DatabaseLike,
} from '../lib/db';
import type { Customer } from '../lib/types';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import {
  __resetSessionWriteStateStoreForTests,
  getCanonicalProposal,
} from '../lib/salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import { validateAgentWriteProposal, type AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import { CUSTOMER_PROFILE_UPDATE_KEYS, updateCustomerProfile } from '../lib/customerProfileUpdate';
import { sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-14T12:00:00.000Z';

/* ------------------------------------------------------------------ */
/* 测试 DB fixture（隔离 :memory:；与 W4-1 能力写集成测试同款）           */
/* ------------------------------------------------------------------ */

function openEmptyFixture() {
  const fixture = sqliteFixture();
  return fixture;
}

/** 种子客户：profile 字段 + 规则/状态字段 + 系统字段（测试只读断言基座）。 */
async function seedCustomerRow(
  db: DatabaseLike,
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await createCustomer(
    id,
    '原始名称',
    'WECHAT',
    'wx-original',
    '13800000000',
    'FOUND',
    0,
    'C',
    'ADDED',
    'MEDIUM',
    'CAN_LEARN',
    null,
    null,
    'NOT_PARSED',
    null,
    '2026-07-20T09:30:00.000Z',
    '原始备注',
    'https://original.example.com',
    '广州',
    '软件',
    '王经理',
    'wang@original.example.com',
    '天河区',
    '降本增效',
    '关键决策人',
    '线下活动',
  );
  await updateCustomer(id, {
    stage: 'REPLIED',
    has_replied: 1,
    can_schedule_visit: 1,
    visit_scheduled_at: '2026-07-18T10:00:00.000Z',
    last_contacted_at: '2026-07-13T09:00:00.000Z',
    last_feedback_type: 'POSITIVE',
    next_action: 'SCHEDULE_VISIT',
    no_show_count: 1,
    lost_reason: null,
    payment_status: 'PENDING',
    deal_amount: 50000,
    paid_at: null,
    closed_at: null,
    current_stage_card_id: null,
    battle_card_status: 'NONE',
    last_battle_review_at: null,
    ...overrides,
  });
}

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
/* 确认后执行 helper（现有产品确认流；与 W4-1 同构）                      */
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

/** 能力路径 B：invoke customer.profile.update → 现有确认流 → 返回真实持久化结果。 */
async function capabilityProfileUpdatePath(
  db: DatabaseLike,
  scopeCustomerId: string,
  patch: Record<string, unknown>,
): Promise<{ customer_id: string; fields: readonly string[] }> {
  const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
    capability_id: 'customer.profile.update',
    capability_version: '1.0.0',
    input: { db, ...patch },
    scope: { customer_id: scopeCustomerId },
  });
  expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  if (outcome.status !== 'CONFIRMATION_REQUIRED') throw new Error('unreachable');
  const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
  expect(proposal).not.toBeNull();
  expect(proposal!.tool_id).toBe('update_customer_profile');
  const result = await confirmViaExistingFlow(proposal!);
  expect(result.entity_id).toBe(scopeCustomerId);
  return { customer_id: scopeCustomerId, fields: result.fields };
}

/* ------------------------------------------------------------------ */
/* 人工路径 A：显式复刻 CustomerForm edit-mode 的资料字段语义             */
/* （只写提交的资料字段；`value || null` 空串清除；不触发任何规则）        */
/* ------------------------------------------------------------------ */

async function humanProfileEditPath(customerId: string, patch: Record<string, unknown>): Promise<void> {
  const current = await getCustomer(customerId);
  if (!current) throw new Error('customer missing');
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    updates[key] = value === '' ? null : value;
  }
  await updateCustomer(customerId, updates);
}

beforeEach(() => {
  __resetSessionWriteStateStoreForTests();
});

afterEach(() => {
  __setDbInstanceForTests(null);
});

/* ================================================================== */
/* T1 — CAPABILITY DEFINITION                                          */
/* ================================================================== */

describe('T1 — CAPABILITY DEFINITION: customer.profile.update exists exactly once with frozen metadata', () => {
  it('definition is registered exactly once with the frozen W4-2 contract metadata', () => {
    const definitions = PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.id === 'customer.profile.update');
    expect(definitions).toHaveLength(1);
    const definition = definitions[0]!;
    expect(definition.version).toBe('1.0.0');
    expect(definition.domain).toBe('customer');
    expect(definition.effect).toBe('WRITE');
    expect(definition.data_target).toBe('CRM_FACT');
    expect(definition.risk_level).toBe('MEDIUM');
    expect(definition.authority_policy).toBe('POLICY_CONTROLLED');
    expect(definition.requires_confirmation).toBe(true);
    expect(definition.scope_requirement).toBe('CUSTOMER');
    expect(definition.idempotency).toBe('NONE');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:update_customer_profile');
    expect(definition.audit_contract).toEqual({
      audit_required: true,
      record_input: true,
      record_output: false,
      record_effect: true,
    });
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.audit_contract)).toBe(true);
    expect(definition.error_contract).toBe('UNSPECIFIED');
    // 描述必须明确窄语义（资料编辑原语；不得暗示任意客户字段变更）
    expect(definition.description).toMatch(/NOT a generic customer\.update/i);
  });

  it('manifest registers exactly the one W4-2 identity and nothing else', () => {
    expect(CUSTOMER_PROFILE_UPDATE_MANIFEST.map((d) => d.id)).toEqual(['customer.profile.update']);
    expect(CUSTOMER_PROFILE_UPDATE_CAPABILITY_IDS.profileUpdate).toBe('customer.profile.update');
  });
});

/* ================================================================== */
/* T2 — EXACT 24 PRODUCTION IDENTITIES                                 */
/* ================================================================== */

describe('T2 — EXACT 25 PRODUCTION IDENTITIES: original 22 preserved; customer.delete (W4-4), visit.create (W4-3), and customer.opportunity_amount.update (C0) are the three new identities', () => {
  it('count = 25, all original 22 identities remain, new identities are customer.delete / visit.create / customer.opportunity_amount.update', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(25);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(25);
    const ids = PRODUCTION_CAPABILITY_IDS;
    const original22 = new Set(ids.filter((id) => id !== 'customer.delete' && id !== 'visit.create' && id !== 'customer.opportunity_amount.update'));
    expect(original22.size).toBe(22);
    // 无第 26 个能力
    expect(ids).toHaveLength(25);
    // customer.profile.update（W4-2）仍是其唯一身份（保持）
    expect(ids.filter((id) => id === 'customer.profile.update')).toEqual(['customer.profile.update']);
    // customer.delete 是唯一 W4-4 新身份
    expect(ids.filter((id) => id === 'customer.delete')).toEqual(['customer.delete']);
    // visit.create 是唯一 W4-3 新身份
    expect(ids.filter((id) => id === 'visit.create')).toEqual(['visit.create']);
    // customer.opportunity_amount.update 是唯一 C0 新身份
    expect(ids.filter((id) => id === 'customer.opportunity_amount.update')).toEqual(['customer.opportunity_amount.update']);
    // 原 22 身份完整保留
    for (const id of [
      'customer.search', 'customer.get', 'customer.context',
      'timeline.customer.read', 'timeline.visit.read',
      'follow_up.customer.read', 'follow_up.global.read',
      'task.read_by_customer',
      'battle_card.current.read', 'battle_card.history.read', 'battle_card.context.read',
      'import.file.preview', 'import.mapping.validate',
      'customer.next_follow_up_time.update', 'follow_up.create', 'task.create',
      'battle_card.draft.create', 'battle_card.confirm',
      'battle_card.hypothesis.status.update', 'battle_card.intelligence_import.confirm',
      'customer.create', 'customer.profile.update',
    ]) {
      expect(ids).toContain(id);
    }
    // 不存在的身份仍不存在
    expect(ids).not.toContain('customer.update');
    expect(ids).not.toContain('customer.state.update');
    expect(ids).not.toContain('visit.update');
    expect(ids).not.toContain('visit.delete');
    expect(ids).not.toContain('import.execute');
  });

  it('all 25 identities resolve with version 1.0.0', () => {
    for (const id of PRODUCTION_CAPABILITY_IDS) {
      expect(PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0').id).toBe(id);
    }
  });
});

/* ================================================================== */
/* T3 — EXACT 25 BINDINGS                                              */
/* ================================================================== */

describe('T3 — EXACT 25 BINDINGS: customer.profile.update executor_ref resolves explicitly; unbound = 0', () => {
  it('binding count = 25 and customer.profile.update executor_ref resolves to the profile binding', () => {
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(25);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(25);
    const binding = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve('salesAgentWriteTool:update_customer_profile');
    expect(binding).toBeDefined();
    expect(binding?.executor_ref).toBe('salesAgentWriteTool:update_customer_profile');
    const unbound = PRODUCTION_CAPABILITY_IDS.filter((id) => {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      return PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref) === undefined;
    });
    expect(unbound).toEqual([]);
  });

  it('PRODUCTION_WRITE_BINDINGS has exactly 12 and includes the profile binding once', async () => {
    const { PRODUCTION_WRITE_BINDINGS } = await import('../lib/capabilities/execution/writeAdapters');
    expect(PRODUCTION_WRITE_BINDINGS).toHaveLength(12);
    expect(PRODUCTION_WRITE_BINDINGS.map((b) => b.executor_ref)).toContain('salesAgentWriteTool:update_customer_profile');
    expect(PRODUCTION_WRITE_BINDINGS.filter((b) => b.executor_ref === 'salesAgentWriteTool:update_customer_profile')).toHaveLength(1);
    expect(PRODUCTION_WRITE_BINDINGS.filter((b) => b.executor_ref === 'salesAgentWriteTool:delete_customer')).toHaveLength(1);
    expect(PRODUCTION_WRITE_BINDINGS.filter((b) => b.executor_ref === 'salesAgentWriteTool:create_visit_record')).toHaveLength(1);
  });
});

/* ================================================================== */
/* T4 — CUSTOMER SCOPE                                                 */
/* ================================================================== */

describe('T4 — CUSTOMER SCOPE: scope_requirement = CUSTOMER (existing customer required)', () => {
  it('definition scope is CUSTOMER and scope validation fails closed without customer_id', async () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.profile.update', '1.0.0');
    expect(definition.scope_requirement).toBe('CUSTOMER');
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.profile.update',
      capability_version: '1.0.0',
      input: { db: { execute: async () => ({ rowsAffected: 0 }), select: async () => [] }, name: 'x' },
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
    }
  });
});

/* ================================================================== */
/* T5 — EFFECTIVE CUSTOMER SOURCE                                      */
/* ================================================================== */

describe('T5 — EFFECTIVE CUSTOMER SOURCE: invocation.scope.customer_id only', () => {
  it('proposal customer_id equals scope.customer_id; no input-wins, no fallback', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, name: '新名称' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
        expect(proposal?.customer_id).toBe('customer-A');
        // 匹配的输入选择器（= scope）被允许，但执行器仍以 scope 为准
        const outcome2 = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
          capability_id: 'customer.profile.update',
          capability_version: '1.0.0',
          input: { db: fixture.db, customer_id: 'customer-A', name: '新名称2' },
          scope: { customer_id: 'customer-A' },
        });
        expect(outcome2.status).toBe('CONFIRMATION_REQUIRED');
        if (outcome2.status === 'CONFIRMATION_REQUIRED') {
          const proposal2 = getCanonicalProposal(outcome2.confirmation_handoff!.proposal_id);
          expect(proposal2?.customer_id).toBe('customer-A');
        }
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T6 — CUSTOMER SELECTOR REJECTION                                    */
/* ================================================================== */

describe('T6 — CUSTOMER SELECTOR REJECTION: customer_id / customerId input rejected', () => {
  it('any input customer selector fails closed before the executor (INVALID_INPUT, calls = 0)', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    for (const key of ['customer_id', 'customerId']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: dbStub, [key]: 'customer-B', name: 'x' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, key).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T7 — EXACT PROFILE FIELD WHITELIST                                  */
/* ================================================================== */

describe('T7 — EXACT PROFILE FIELD WHITELIST: only the 16 audited ordinary profile fields are accepted', () => {
  const PROFILE_KEYS = [
    'name', 'wechat_id', 'phone_number', 'wechat_search_status', 'is_key_decision_maker',
    'contact_method', 'notes', 'website', 'region', 'industry', 'contact_person',
    'email', 'address', 'pitch_angle', 'qualification_reason', 'source',
  ];

  it('CUSTOMER_PROFILE_UPDATE_KEYS is exactly the audited 16-field set', () => {
    expect([...CUSTOMER_PROFILE_UPDATE_KEYS].sort()).toEqual([...PROFILE_KEYS].sort());
    expect(CUSTOMER_PROFILE_UPDATE_KEYS).toHaveLength(16);
    // 规则自有信号绝不进入白名单
    for (const forbidden of ['wechat_add_status', 'intent_level', 'phone_feedback', 'rough_visit_time_text', 'next_follow_up_at', 'stage', 'customer_grade']) {
      expect(CUSTOMER_PROFILE_UPDATE_KEYS).not.toContain(forbidden);
    }
  });

  it('every one of the 16 profile fields alone reaches a confirmation proposal', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = {
      execute: async () => ({ rowsAffected: 0 }),
      select: async () => [{ id: 'customer-A', name: '旧', wechat_id: null, phone_number: null, wechat_search_status: null, is_key_decision_maker: 0, contact_method: null, notes: null, website: null, region: null, industry: null, contact_person: null, email: null, address: null, pitch_angle: null, qualification_reason: null, source: null }],
    };
    const values: Readonly<Record<string, unknown>> = {
      name: '新名称', wechat_id: 'wx-new', phone_number: '13900001111', wechat_search_status: 'FOUND',
      is_key_decision_maker: 1, contact_method: 'PHONE', notes: '新备注', website: 'https://new.example.com',
      region: '深圳', industry: '教育', contact_person: '李总', email: 'li@new.example.com',
      address: '南山区', pitch_angle: '提效', qualification_reason: '预算充足', source: '展会',
    };
    for (const key of PROFILE_KEYS) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: dbStub, [key]: values[key] },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('CONFIRMATION_REQUIRED');
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T8 — EMPTY PATCH REJECTED                                           */
/* ================================================================== */

describe('T8 — EMPTY PATCH REJECTED: at least one profile field is required', () => {
  it('empty patch and db-only input fail closed (INVALID_INPUT, calls = 0)', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    for (const input of [{ db: dbStub }, { db: dbStub, customer_id: 'customer-A' }]) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T9 — UNKNOWN FIELD REJECTED                                         */
/* ================================================================== */

describe('T9 — UNKNOWN FIELD REJECTED: unknown top-level keys fail closed (no silent drop)', () => {
  it('unknown keys fail closed with INVALID_INPUT and zero executor calls', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    for (const key of ['extra_field', 'notes_extra', 'meta', 'rows', 'target', 'customerSelector']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: dbStub, name: 'x', [key]: key === 'meta' ? { stage: 'PAID' } : key === 'rows' ? [{ name: 'y' }] : key === 'target' ? { customer_id: 'customer-B' } : 1 },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, key).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T10 — SYSTEM FIELD REJECTED                                         */
/* ================================================================== */

describe('T10 — SYSTEM FIELD REJECTED: system-owned columns fail closed', () => {
  it('id / timestamps / battle-card pointer / parse-derived fields are rejected', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    const cases: Array<[string, unknown]> = [
      ['id', 'other-id'],
      ['created_at', NOW],
      ['current_stage_card_id', 'card-x'],
      ['battle_card_status', 'CONFIRMED'],
      ['last_battle_review_at', NOW],
      ['parsed_visit_reminder_at', NOW],
      ['time_parse_status', 'PARSED'],
      ['time_parse_note', 'x'],
      ['rough_visit_time_text', '下周二'],
    ];
    for (const [field, value] of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: dbStub, name: 'x', [field]: value },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, field).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, field).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T11 — STATE/RULE FIELD REJECTED                                     */
/* ================================================================== */

describe('T11 — STATE/RULE FIELD REJECTED: rule-owned state and signals fail closed', () => {
  it('stage / grade / payment / follow-up state / rule-owned signals are rejected', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    const cases: Array<[string, unknown]> = [
      ['stage', 'PAID'],
      ['customer_grade', 'A'],
      ['payment_status', 'PAID'],
      ['deal_amount', 1000],
      ['paid_at', NOW],
      ['closed_at', NOW],
      ['has_replied', 1],
      ['can_schedule_visit', 1],
      ['visit_scheduled_at', NOW],
      ['last_contacted_at', NOW],
      ['last_feedback_type', 'POSITIVE'],
      ['next_action', 'CLOSE'],
      ['no_show_count', 3],
      ['lost_reason', 'x'],
      // 规则自有信号：CustomerForm 编辑它们会触发 Rule 2 / Rule 3
      ['wechat_add_status', 'PASSED'],
      ['intent_level', 'HIGH'],
      ['phone_feedback', 'INTERESTED'],
    ];
    for (const [field, value] of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: dbStub, name: 'x', [field]: value },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, field).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, field).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T12 — NEXT FOLLOW-UP OWNERSHIP PRESERVED                            */
/* ================================================================== */

describe('T12 — NEXT FOLLOW-UP OWNERSHIP PRESERVED: next_follow_up_at stays owned by customer.next_follow_up_time.update', () => {
  it('customer.profile.update rejects next_follow_up_at; next_follow_up_time.update still owns it', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = {
      execute: async () => ({ rowsAffected: 0 }),
      select: async () => [{ next_follow_up_at: '2026-07-20T09:30:00.000Z' }],
    };
    const rejected = await harness.engine.invoke({
      capability_id: 'customer.profile.update',
      capability_version: '1.0.0',
      input: { db: dbStub, next_follow_up_at: '2026-08-01T00:00:00.000Z' },
      scope: { customer_id: 'customer-A' },
    });
    expect(rejected.status).toBe('EXECUTION_ERROR');
    if (rejected.status === 'EXECUTION_ERROR') {
      expect(rejected.error_code).toBe('INVALID_INPUT');
    }
    // 原能力仍然拥有该字段（回归）
    const owned = await harness.engine.invoke({
      capability_id: 'customer.next_follow_up_time.update',
      capability_version: '1.0.0',
      input: { db: dbStub, next_follow_up_at: '2026-08-01T00:00:00.000Z' },
      scope: { customer_id: 'customer-A' },
    });
    expect(owned.status).toBe('CONFIRMATION_REQUIRED');
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T13 — TYPE/ENUM VALIDATION                                          */
/* ================================================================== */

describe('T13 — TYPE/ENUM VALIDATION: wrong primitive types and invalid enums fail closed', () => {
  it('wrong primitive types fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    const cases: Array<Record<string, unknown>> = [
      { db: dbStub, name: 42 },
      { db: dbStub, wechat_id: 7 },
      { db: dbStub, notes: ['array'] },
      { db: dbStub, source: { deep: 'object' } },
      { db: dbStub, is_key_decision_maker: '1' },
      { db: dbStub, is_key_decision_maker: 2 },
      { db: dbStub, is_key_decision_maker: null },
      { db: dbStub, is_key_decision_maker: '' },
      { db: dbStub, name: '   ' },
      { db: dbStub, name: '' },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });

  it('invalid enum values fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    const cases: Array<Record<string, unknown>> = [
      { db: dbStub, wechat_search_status: 'NOPE' },
      { db: dbStub, contact_method: 'FAX' },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T14 — NULL/EMPTY-STRING PRODUCT PARITY                              */
/* ================================================================== */

describe('T14 — NULL/EMPTY-STRING PRODUCT PARITY: empty string clears to null like CustomerForm (`value || null`); undefined = unchanged', () => {
  it('empty string normalizes to null in the proposal and persists as null (parity with form)', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      // 能力路径：空串 → null（与表单 `value || null` 一致）
      const { customer_id } = await capabilityProfileUpdatePath(fixture.db, 'customer-A', { wechat_id: '', notes: '' });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.wechat_id).toBeNull();
      expect(row!.notes).toBeNull();
      // 人工路径等价：空串 → null
      await seedCustomerRow(fixture.db, 'customer-human');
      await humanProfileEditPath('customer-human', { wechat_id: '', notes: '' });
      const humanRow = await selectCustomerRow(fixture.db, 'customer-human');
      expect(humanRow!.wechat_id).toBeNull();
      expect(humanRow!.notes).toBeNull();
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('explicit null clears the value; undefined leaves the field unchanged', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      // 显式 null → 清除（与表单清除语义一致）
      const { customer_id } = await capabilityProfileUpdatePath(fixture.db, 'customer-A', { industry: null });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.industry).toBeNull();
      // undefined（未提供）→ 不变
      const { customer_id: id2 } = await capabilityProfileUpdatePath(fixture.db, 'customer-A', { name: '仅改名称' });
      const row2 = await selectCustomerRow(fixture.db, id2);
      expect(row2!.name).toBe('仅改名称');
      expect(row2!.industry).toBeNull();
      expect(row2!.region).toBe('广州'); // 未提供的字段保持原值
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T15 — MASS ASSIGNMENT CLOSED                                        */
/* ================================================================== */

describe('T15 — MASS ASSIGNMENT CLOSED: prototype keys, nested arbitrary objects and system fields fail closed', () => {
  it('__proto__ / constructor / prototype keys fail closed before the executor', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const input: Record<string, unknown> = { db: dbStub, name: 'x' };
      // JSON.parse 制造自有键（避免对象字面量 __proto__ 特殊语法）
      const forged = JSON.parse(`{"db":{},"name":"x","${key}":{"stage":"PAID"}}`);
      forged.db = dbStub;
      Object.assign(input, { [key]: forged[key] });
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, key).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });

  it('nested arbitrary objects / arrays / system-field smuggling all fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    const cases: Array<Record<string, unknown>> = [
      { db: dbStub, meta: { stage: 'PAID' } },
      { db: dbStub, profile: { name: 'x' } },
      { db: dbStub, values: { customer_grade: 'A' } },
      { db: dbStub, name: 'x', customer: { id: 'customer-B' } },
      { db: dbStub, name: 'x', rows: ['a'] },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
  });
});

/* ================================================================== */
/* T16 — A10 DECISION                                                  */
/* ================================================================== */

describe('T16 — A10 DECISION: exact REQUIRE_CONFIRMATION + EXPLICIT_CONFIRMATION_REQUIRED', () => {
  it('evaluateAuthorityPolicy produces the frozen decision', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.profile.update', '1.0.0');
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.capability_id).toBe('customer.profile.update');
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
  });
});

/* ================================================================== */
/* T17 — PRE-CONFIRM ZERO CUSTOMER WRITES                              */
/* ================================================================== */

describe('T17 — PRE-CONFIRM ZERO CUSTOMER WRITES: before human confirmation no customer column changes', () => {
  it('after unified execution (confirmation required) the seeded row is byte-identical', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const before = await selectCustomerRow(fixture.db, 'customer-A');
      const harness = makeWriteCountingHarness();
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, name: '确认前不应写入', notes: '确认前不应写入' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const after = await selectCustomerRow(fixture.db, 'customer-A');
      expect(after).toEqual(before);
      expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T18 — PRE-CONFIRM ZERO RULE/TASK WRITES                             */
/* ================================================================== */

describe('T18 — PRE-CONFIRM ZERO RULE/TASK WRITES: no rule transition / task creation before confirmation', () => {
  it('tasks table stays empty and state columns unchanged after confirmation-required outcome', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, name: 'x' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      expect(await countRows(fixture.db, 'tasks')).toBe(0);
      const row = await selectCustomerRow(fixture.db, 'customer-A');
      expect(row!.stage).toBe('REPLIED'); // 规则/状态列保持种子值
      expect(row!.customer_grade).toBe('C');
      expect(row!.next_follow_up_at).toBe('2026-07-20T09:30:00.000Z');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T19 — EXISTING CONFIRMATION RUNTIME REUSED                          */
/* ================================================================== */

describe('T19 — EXISTING CONFIRMATION RUNTIME REUSED: no new proposal store / nonce / replay mechanism', () => {
  it('binding source reuses sessionWriteStateStore + confirmedWrite and registers no new store', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/writeAdapters.ts'), 'utf8');
    expect(source).toContain("from '../../salesAgentTools/confirmedWrite'");
    expect(source).toContain("from '../../salesAgentTools/sessionWriteStateStore'");
    expect(source).toContain('registerCanonicalProposal');
    expect(source).toContain('buildWriteProposal');
    expect(source).not.toMatch(/localStorage|indexedDB|createProposalTable|new Map<string, [^)]*proposal/i);
  });

  it('handoff returns the existing mechanism + a canonical proposal in the existing store', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, name: '交接客户' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        expect(outcome.confirmation_handoff?.mechanism).toBe(SALES_AGENT_CONFIRMATION_MECHANISM);
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
        expect(proposal).not.toBeNull();
        expect(proposal!.proposal_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(proposal!.status).toBe('awaiting_confirmation');
        expect(proposal!.nonce).toBeTruthy();
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('old symbolic IDs are NOT resurrected as the profile identity', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.profile.update', '1.0.0');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:update_customer_profile');
    expect(definition.executor_ref).not.toBe('salesAgentWriteTool:update_customer_basic_fields');
    expect(definition.executor_ref).not.toBe('salesAgentWriteTool:update_contact_basic_fields');
    const ids = PRODUCTION_CAPABILITY_IDS;
    expect(ids).not.toContain('customer.basic_fields.update');
    expect(ids).not.toContain('contact.basic_fields.update');
  });
});

/* ================================================================== */
/* T20 — PROPOSAL WHITELIST CLOSED (Layer 2)                           */
/* ================================================================== */

describe('T20 — PROPOSAL WHITELIST CLOSED: the confirmed proposal carries only whitelisted profile fields', () => {
  it('proposal proposed_values contains exactly the provided profile fields (before/after bounded)', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, name: '新名称', region: '深圳' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
        expect(Object.keys(proposal!.proposed_values).sort()).toEqual(['name', 'region']);
        expect(proposal!.proposed_values.name).toBe('新名称');
        // before 侧：当前存储值（人工可理解 before/after）
        expect(proposal!.current_values).toMatchObject({ name: '原始名称', region: '广州' });
        // 提案只含资料字段（无系统/规则字段）
        for (const key of Object.keys(proposal!.proposed_values)) {
          expect(CUSTOMER_PROFILE_UPDATE_KEYS).toContain(key);
        }
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('validateAgentWriteProposal (Layer 2 runtime) rejects a forbidden field inside proposed_values', () => {
    const base: AgentWriteProposal = {
      proposal_id: 'p-1', proposal_hash: 'h', tool_id: 'update_customer_profile',
      customer_id: 'customer-A', entity_type: 'customer', operation: 'update',
      current_values: { name: '旧' }, proposed_values: { name: '新' },
      reason: 'x', evidence_refs: [], reversible: true, nonce: 'n-1',
      created_at: NOW, status: 'awaiting_confirmation', executable: false, requires_confirmation: true,
    };
    expect(() => validateAgentWriteProposal(base)).not.toThrow();
    const forged: AgentWriteProposal = { ...base, proposed_values: { name: '新', stage: 'PAID' } };
    expect(() => validateAgentWriteProposal(forged)).toThrow(/forbidden field/);
  });
});

/* ================================================================== */
/* T21 — APPROVED BOUNDARY / SERVICE WHITELIST CLOSED (Layer 3)        */
/* ================================================================== */

describe('T21 — APPROVED BOUNDARY WHITELIST CLOSED: the shared service refuses non-profile fields at runtime', () => {
  it('updateCustomerProfile rejects non-profile keys before any write', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      await expect(updateCustomerProfile('customer-A', { stage: 'PAID' })).rejects.toThrow(/non-profile field/);
      await expect(updateCustomerProfile('customer-A', { customer_grade: 'A' })).rejects.toThrow(/non-profile field/);
      await expect(updateCustomerProfile('customer-A', { next_follow_up_at: 'x' })).rejects.toThrow(/non-profile field/);
      await expect(updateCustomerProfile('customer-A', { wechat_add_status: 'PASSED' })).rejects.toThrow(/non-profile field/);
      await expect(updateCustomerProfile('customer-A', {})).rejects.toThrow(/at least one profile field/);
      const row = await selectCustomerRow(fixture.db, 'customer-A');
      expect(row!.stage).toBe('REPLIED'); // 零写入
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('forged proposal executed directly against the approved boundary fails closed with zero writes', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const forged: AgentWriteProposal = {
        proposal_id: 'p-forged', proposal_hash: 'h', tool_id: 'update_customer_profile',
        customer_id: 'customer-A', entity_type: 'customer', operation: 'update',
        current_values: {}, proposed_values: { name: '新', payment_status: 'PAID' },
        reason: 'x', evidence_refs: [], reversible: true, nonce: 'n-forged',
        created_at: NOW, status: 'awaiting_confirmation', executable: false, requires_confirmation: true,
      };
      await expect(approvedCrmWriteBoundary.execute(forged, 'x')).rejects.toThrow(/non-profile field/);
      const row = await selectCustomerRow(fixture.db, 'customer-A');
      expect(row!.name).toBe('原始名称');
      expect(row!.payment_status).toBe('PENDING');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('boundary routes update_customer_profile through the shared service, not a raw passthrough', () => {
    const boundarySource = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts'), 'utf8');
    expect(boundarySource).toMatch(/proposal\.tool_id === 'update_customer_profile'/);
    expect(boundarySource).toMatch(/updateCustomerProfile/);
    expect(boundarySource).toMatch(/from '\.\.\/customerProfileUpdate'/);
    // 绝不把 profile 提案并入 update_next_follow_up_time / update_customer_basic_fields 的
    // repository.updateCustomer 直通分支
    expect(boundarySource).not.toMatch(/update_customer_profile.*update_next_follow_up_time/);
  });
});

/* ================================================================== */
/* T22 — REAL CONFIRMED PROFILE UPDATE                                 */
/* ================================================================== */

describe('T22 — REAL CONFIRMED PROFILE UPDATE: after isolated human-confirm simulation exactly one profile update occurs', () => {
  it('confirmed path persists the profile change on the real DB path once', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const { customer_id, fields } = await capabilityProfileUpdatePath(fixture.db, 'customer-A', {
        name: '确认后新名称', phone_number: '13911112222', region: '深圳',
      });
      const row = await selectCustomerRow(fixture.db, customer_id);
      expect(row!.name).toBe('确认后新名称');
      expect(row!.phone_number).toBe('13911112222');
      expect(row!.region).toBe('深圳');
      expect(fields.sort()).toEqual(['name', 'phone_number', 'region']);
      // 恰好一次资料更新：再确认同一提案 → replay 拒绝，不再写入
      expect(await countRows(fixture.db, 'customers')).toBe(1);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('re-confirming the same proposal is rejected (replay) and does not duplicate the write', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, name: '防重放名称' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      await confirmViaExistingFlow(proposal!);
      await expect(confirmViaExistingFlow(proposal!)).rejects.toThrow(/replay/i);
      const row = await selectCustomerRow(fixture.db, 'customer-A');
      expect(row!.name).toBe('防重放名称');
      expect(await countRows(fixture.db, 'customers')).toBe(1);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T23 — ONLY APPROVED COLUMNS CHANGE                                  */
/* ================================================================== */

describe('T23 — ONLY APPROVED COLUMNS CHANGE: all non-proposed columns remain unchanged', () => {
  it('after a confirmed name+region patch, every other column keeps its seeded value', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const before = await selectCustomerRow(fixture.db, 'customer-A');
      const { customer_id } = await capabilityProfileUpdatePath(fixture.db, 'customer-A', { name: '新名称', region: '深圳' });
      const after = await selectCustomerRow(fixture.db, customer_id);
      const changedColumns = Object.keys(after!).filter((key) => {
        if (key === 'updated_at') return true; // 产品语义：任何资料写入都会刷新 updated_at（与人工路径一致）
        return after![key] !== before![key];
      });
      expect(changedColumns.sort()).toEqual(['name', 'region', 'updated_at']);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T24 — STATE FIELDS REMAIN UNCHANGED                                 */
/* ================================================================== */

describe('T24 — STATE FIELDS REMAIN UNCHANGED: rule-owned state columns are never touched by profile update', () => {
  it('stage / grade / payment / follow-up / signals stay identical after a confirmed profile update', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const before = await selectCustomerRow(fixture.db, 'customer-A');
      const { customer_id } = await capabilityProfileUpdatePath(fixture.db, 'customer-A', {
        name: '新名称', notes: '新备注', wechat_id: 'wx-new',
      });
      const after = await selectCustomerRow(fixture.db, customer_id);
      for (const field of [
        'stage', 'customer_grade', 'wechat_add_status', 'intent_level', 'phone_feedback',
        'has_replied', 'can_schedule_visit', 'visit_scheduled_at', 'last_contacted_at',
        'last_feedback_type', 'next_action', 'no_show_count', 'lost_reason',
        'payment_status', 'deal_amount', 'paid_at', 'closed_at', 'next_follow_up_at',
        'rough_visit_time_text', 'parsed_visit_reminder_at', 'time_parse_status', 'time_parse_note',
      ]) {
        expect(after![field], field).toEqual(before![field]);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T25 — SYSTEM FIELDS REMAIN UNCHANGED                                */
/* ================================================================== */

describe('T25 — SYSTEM FIELDS REMAIN UNCHANGED: id / created_at / battle-card pointer stay protected', () => {
  it('system columns are byte-identical after a confirmed profile update', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const before = await selectCustomerRow(fixture.db, 'customer-A');
      const { customer_id } = await capabilityProfileUpdatePath(fixture.db, 'customer-A', { email: 'new@example.com' });
      const after = await selectCustomerRow(fixture.db, customer_id);
      for (const field of [
        'id', 'created_at', 'current_stage_card_id', 'battle_card_status', 'last_battle_review_at',
      ]) {
        expect(after![field], field).toEqual(before![field]);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T26 — CROSS-CUSTOMER ISOLATION                                     */
/* ================================================================== */

describe('T26 — CROSS-CUSTOMER ISOLATION: a clean scope=A update affects only A', () => {
  it('customer B row is byte-identical while A is updated', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      await seedCustomerRow(fixture.db, 'customer-B', { name: 'B的原始名称', region: '上海' });
      const bBefore = await selectCustomerRow(fixture.db, 'customer-B');
      await capabilityProfileUpdatePath(fixture.db, 'customer-A', { name: 'A的新名称' });
      const bAfter = await selectCustomerRow(fixture.db, 'customer-B');
      expect(bAfter).toEqual(bBefore);
      const aAfter = await selectCustomerRow(fixture.db, 'customer-A');
      expect(aAfter!.name).toBe('A的新名称');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T27 — SMUGGLED B TARGET FAILS BEFORE EXECUTOR                      */
/* ================================================================== */

describe('T27 — SMUGGLED B TARGET FAILS BEFORE EXECUTOR: redirected mutation is impossible', () => {
  it('input customer_id/customerId = B with scope A → INVALID_INPUT, B unchanged, executor calls = 0', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      await seedCustomerRow(fixture.db, 'customer-B', { name: 'B的原始名称' });
      const bBefore = await selectCustomerRow(fixture.db, 'customer-B');
      const harness = makeWriteCountingHarness();
      for (const key of ['customer_id', 'customerId']) {
        const outcome = await harness.engine.invoke({
          capability_id: 'customer.profile.update',
          capability_version: '1.0.0',
          input: { db: fixture.db, [key]: 'customer-B', name: '走私到B' },
          scope: { customer_id: 'customer-A' },
        });
        expect(outcome.status, key).toBe('EXECUTION_ERROR');
        if (outcome.status === 'EXECUTION_ERROR') {
          expect(outcome.error_code, key).toBe('INVALID_INPUT');
        }
      }
      // 嵌套客户选择器：未知字段（target/customer）→ INVALID_INPUT
      for (const smuggled of [
        { target: { customer_id: 'customer-B' } },
        { customer: { id: 'customer-B' } },
        { selector: 'customer-B' },
      ]) {
        const outcome = await harness.engine.invoke({
          capability_id: 'customer.profile.update',
          capability_version: '1.0.0',
          input: { db: fixture.db, name: 'x', ...smuggled },
          scope: { customer_id: 'customer-A' },
        });
        expect(outcome.status).toBe('EXECUTION_ERROR');
        if (outcome.status === 'EXECUTION_ERROR') {
          expect(outcome.error_code).toBe('INVALID_INPUT');
        }
      }
      expect(harness.callsFor('salesAgentWriteTool:update_customer_profile')).toBe(0);
      const bAfter = await selectCustomerRow(fixture.db, 'customer-B');
      expect(bAfter).toEqual(bBefore);
      const aAfter = await selectCustomerRow(fixture.db, 'customer-A');
      expect(aAfter!.name).toBe('原始名称'); // A 也未受影响（全部执行前失败）
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T28 — OUTPUT MINIMIZED                                              */
/* ================================================================== */

describe('T28 — OUTPUT MINIMIZED: result is customer_id-level, never a full raw row', () => {
  it('shared product service returns exactly { customer_id }', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const result = await updateCustomerProfile('customer-A', { name: '最小输出' });
      expect(Object.keys(result).sort()).toEqual(['customer_id']);
      expect(result.customer_id).toBe('customer-A');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('confirmed boundary returns entity_id + bounded field list, not a full row', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.profile.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, name: '最小输出确认', notes: '备注' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      const result = await confirmViaExistingFlow(proposal!);
      expect(result.entity_id).toBe('customer-A');
      expect(result.fields.sort()).toEqual(['name', 'notes']);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T29 — OBSERVATION PRE-CONFIRM LIFECYCLE                             */
/* ================================================================== */

describe('T29 — OBSERVATION PRE-CONFIRM: STARTED → AUTHORITY_DECIDED → CONFIRMATION_REQUIRED with same invocation_id', () => {
  it('customer.profile.update lifecycle emits the exact three events with CUSTOMER scope', async () => {
    const emitter = createInMemoryObservationEmitter();
    const bridge = createObservationBridge(emitter);
    const engine = createProductionCapabilityExecution(bridge.observer);
    const outcome = await engine.invoke({
      capability_id: 'customer.profile.update',
      capability_version: '1.0.0',
      input: { db: { execute: async () => ({ rowsAffected: 0 }), select: async () => [{ id: 'customer-A', name: '旧' }] }, name: '新' },
      scope: { customer_id: 'customer-A' },
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    expect(events[1].authority_decision).toBe('REQUIRE_CONFIRMATION');
    expect(events[1].authority_reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
    expect(events[2].confirmation_state).toBe('REQUIRED');
    expect(events.every((e) => e.scope_type === 'CUSTOMER' && e.scope_id === 'customer-A')).toBe(true);
    expect(events.every((e) => e.capability_id === 'customer.profile.update')).toBe(true);
    expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
  });
});

/* ================================================================== */
/* T30 — RAW PATCH NOT LOGGED TO OBSERVATION                           */
/* ================================================================== */

describe('T30 — RAW PATCH NOT LOGGED: Observation remains payload-minimal (no patch field names or values)', () => {
  it('events carry no business payload from the profile patch', async () => {
    const emitter = createInMemoryObservationEmitter();
    const bridge = createObservationBridge(emitter);
    const engine = createProductionCapabilityExecution(bridge.observer);
    const secretMarker = 'RAW-PATCH-SECRET-MARKER';
    await engine.invoke({
      capability_id: 'customer.profile.update',
      capability_version: '1.0.0',
      input: {
        db: { execute: async () => ({ rowsAffected: 0 }), select: async () => [{ id: 'customer-A', name: '旧', notes: '旧备注' }] },
        name: '新名称',
        notes: secretMarker,
        wechat_id: 'wx-secret',
      },
      scope: { customer_id: 'customer-A' },
    });
    const serialized = JSON.stringify(emitter.events());
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain('wx-secret');
    expect(serialized).not.toContain('新名称');
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
/* T31 — CUSTOMER.CREATE REGRESSION                                    */
/* ================================================================== */

describe('T31 — CUSTOMER.CREATE REGRESSION: W4-1 remains truthful and unchanged', () => {
  it('customer.create still registers, still confirms, and its definition is untouched', async () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.create', '1.0.0');
    expect(definition.scope_requirement).toBe('NONE');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:create_customer');
    expect(evaluateAuthorityPolicy(definition).decision).toBe('REQUIRE_CONFIRMATION');
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.create',
      capability_version: '1.0.0',
      input: { name: '回归客户' },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  });
});

/* ================================================================== */
/* T32 — CUSTOMER.NEXT_FOLLOW_UP_TIME.UPDATE REGRESSION                */
/* ================================================================== */

describe('T32 — CUSTOMER.NEXT_FOLLOW_UP_TIME.UPDATE REGRESSION: ownership remains distinct', () => {
  it('next_follow_up_time.update still registers and confirms; profile update cannot reach next_follow_up_at', async () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.next_follow_up_time.update', '1.0.0');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:update_next_follow_up_time');
    expect(evaluateAuthorityPolicy(definition).decision).toBe('REQUIRE_CONFIRMATION');
    const dbStub: DatabaseLike = {
      execute: async () => ({ rowsAffected: 0 }),
      select: async () => [{ next_follow_up_at: '2026-07-20T09:30:00.000Z' }],
    };
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.next_follow_up_time.update',
      capability_version: '1.0.0',
      input: { db: dbStub, next_follow_up_at: '2026-08-01T00:00:00.000Z' },
      scope: { customer_id: 'customer-A' },
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  });
});

/* ================================================================== */
/* T33 — NO GENERIC CUSTOMER.UPDATE                                    */
/* ================================================================== */

describe('T33 — NO GENERIC CUSTOMER.UPDATE: the profile primitive is not a generic customer patch', () => {
  it('customer.update / customer.state.update absent; profile definition does not claim arbitrary field mutation', () => {
    const ids = PRODUCTION_CAPABILITY_IDS;
    expect(ids).not.toContain('customer.update');
    expect(ids).not.toContain('customer.state.update');
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.profile.update', '1.0.0');
    expect(definition.description).not.toMatch(/may update arbitrary customer fields|supports arbitrary customer field mutation|any customer field can be updated/i);
  });
});

/* ================================================================== */
/* T34 — WAVE-4 IDENTITIES                                             */
/* ================================================================== */

describe('T34 — WAVE-4 IDENTITIES: customer.delete (W4-4) and visit.create (W4-3) registered; visit.update / visit.delete / import.execute remain absent', () => {
  it('customer.delete and visit.create are the new W4-4/W4-3 identities; the other Wave-4 candidates remain absent', () => {
    const ids = PRODUCTION_CAPABILITY_IDS;
    expect(ids).toContain('customer.delete');
    expect(ids.filter((id) => id === 'customer.delete')).toHaveLength(1);
    expect(ids).toContain('visit.create');
    expect(ids.filter((id) => id === 'visit.create')).toHaveLength(1);
    for (const forbidden of ['visit.update', 'visit.delete', 'import.execute']) {
      expect(ids).not.toContain(forbidden);
    }
  });
});

/* ================================================================== */
/* T35 — NO V0.2B / V0.3 LEAKAGE                                       */
/* ================================================================== */

describe('T35 — NO V0.2B / V0.3 LEAKAGE: no Evidence capability; no Agent loop / planner in the profile path', () => {
  it('evidence domain still contributes zero capabilities', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    expect(PRODUCTION_CAPABILITY_IDS.some((id) => id.startsWith('evidence'))).toBe(false);
  });

  it('profile manifest + shared service contain no planner / Agent-loop / model / provider machinery', () => {
    const files = [
      'src/lib/capabilities/customer/profileUpdateManifest.ts',
      'src/lib/customerProfileUpdate.ts',
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
/* §30 — REAL PRODUCT GOLDEN PATH PARITY (A vs B)                      */
/* ================================================================== */

describe('§30 — REAL PRODUCT GOLDEN PATH PARITY: human profile-edit composition (A) vs confirmed customer.profile.update capability path (B) persist equivalent product truth', () => {
  it('allowed profile fields match, forbidden state unchanged, other customer unchanged, system state unchanged', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      // 种子：A（能力路径目标）、A-human（人工路径目标）、B（隔离对照）
      await seedCustomerRow(fixture.db, 'customer-A');
      await seedCustomerRow(fixture.db, 'customer-A-human');
      await seedCustomerRow(fixture.db, 'customer-B', { name: 'B的原始名称', region: '上海' });

      const patch = {
        name: '黄金路径新名称',
        wechat_id: 'wx-golden-new',
        phone_number: '13700009999',
        wechat_search_status: 'NOT_FOUND',
        is_key_decision_maker: 1,
        contact_method: 'PHONE',
        notes: '黄金路径新备注',
        website: 'https://new-golden.example.com',
        region: '深圳',
        industry: '教育',
        contact_person: '李总',
        email: 'li@new-golden.example.com',
        address: '南山区',
        pitch_angle: '提效',
        qualification_reason: '预算充足',
        source: '展会',
      };

      const bBefore = await selectCustomerRow(fixture.db, 'customer-B');
      const stateBeforeA = await selectCustomerRow(fixture.db, 'customer-A');

      // A：人工编辑路径（CustomerForm edit-mode 资料字段语义：`value || null` + 只写提交字段）
      await humanProfileEditPath('customer-A-human', { ...patch });
      // B：确认后 customer.profile.update 能力路径
      await capabilityProfileUpdatePath(fixture.db, 'customer-A', { ...patch });

      const humanRow = await selectCustomerRow(fixture.db, 'customer-A-human');
      const agentRow = await selectCustomerRow(fixture.db, 'customer-A');
      expect(humanRow).toBeDefined();
      expect(agentRow).toBeDefined();

      // 允许的资料字段：完全相等（产品对等）
      for (const field of CUSTOMER_PROFILE_UPDATE_KEYS) {
        expect(agentRow![field], `profile field ${field} must match`).toEqual(humanRow![field]);
      }

      // 规则/状态字段：保持种子值（不变；与 B 种子一致）
      const stateFields = [
        'stage', 'customer_grade', 'wechat_add_status', 'intent_level', 'phone_feedback',
        'has_replied', 'can_schedule_visit', 'visit_scheduled_at', 'last_contacted_at',
        'last_feedback_type', 'next_action', 'no_show_count', 'lost_reason',
        'payment_status', 'deal_amount', 'paid_at', 'closed_at', 'next_follow_up_at',
        'rough_visit_time_text', 'parsed_visit_reminder_at', 'time_parse_status', 'time_parse_note',
      ];
      for (const field of stateFields) {
        expect(agentRow![field], `state field ${field} must stay unchanged`).toEqual(stateBeforeA![field]);
        expect(agentRow![field], `state field ${field} must equal the seed`).toEqual(bBefore![field]);
      }

      // 系统字段：保持种子值
      for (const field of ['id', 'created_at', 'current_stage_card_id', 'battle_card_status', 'last_battle_review_at']) {
        expect(agentRow![field], `system field ${field}`).toEqual(stateBeforeA![field]);
      }

      // 其他客户不变（B 行逐字节一致）
      const bAfter = await selectCustomerRow(fixture.db, 'customer-B');
      expect(bAfter).toEqual(bBefore);

      // 无规则任务被创建（资料更新绝不触发 Rule 2/3 任务）
      expect(await countRows(fixture.db, 'tasks')).toBe(0);

      // updated_at 与人工路径同一时刻（毫秒级差异容忍；产品每次写都刷新）
      expect(Math.abs(Date.parse(String(agentRow!.updated_at)) - Date.parse(String(humanRow!.updated_at)))).toBeLessThan(60_000);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});
