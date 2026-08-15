/**
 * V0.2A / W4-3 — visit.create Capability 契约测试（T1–T30 + 黄金路径对等）。
 *
 * 证明唯一新增生产能力 visit.create：
 *   T1  能力定义（冻结元数据，恰一次）      T2  生产计数 24（原 22 保持 + visit/delete 新身份）
 *   T3  生产绑定 24 / UNBOUND=0             T4  scope=CUSTOMER
 *   T5  生效客户身份只来自 scope             T6  customer_id/customerId 输入拒绝
 *   T7  精确面访字段白名单（7 字段）         T8  未知/系统字段拒绝
 *   T9  必填字段校验（title）                T10 类型/枚举/日期校验
 *   T11 未知客户 fail closed                 T12 A10 REQUIRE_CONFIRMATION
 *   T13 确认前面访写入=0                     T14 确认前客户/规则/任务写入=0
 *   T15 现有确认运行时复用                   T16 批准边界窄（Layer 3 白名单闭合）
 *   T17 确认后真实产品面访路径（恰好一次）    T18 与人工 VisitForm 产品对等
 *   T19 仅 scope 客户的面访被创建             T20 跨客户对抗用例
 *   T21 无死符号执行器绑定（create_visit_record 已可执行） T22 结果最小化 { visit_id }
 *   T23 Observation 预确认生命周期            T24 原始 payload 不入观察事件
 *   T25 重放/幂等分离                          T26 W4-1 customer.create 回归
 *   T27 W4-2 customer.profile.update 回归     T28 follow_up.create 保持独立
 *   T29 visit.update/visit.delete/import.execute 缺席  T30 无 V0.3 泄漏
 *   §13 真实产品黄金路径对等（A 人工 VisitForm 语义 vs B 确认后能力路径）
 *
 * 原则：
 * - 只使用隔离测试 DB（better-sqlite3 :memory:），绝不触碰真实用户 CRM 数据。
 * - 统一执行全部经 PRODUCTION_CAPABILITY_EXECUTION（Registry → Input → Scope → A10 →
 *   确认交接）；确认后执行经现有产品确认流（SalesAgentSession.confirmWriteByRef →
 *   approvedCrmWriteBoundary → 共享产品服务 createVisitWithProductRules）。
 * - 人工路径 A 显式复刻 VisitForm + CustomerDetail.handleVisitSaved 语义
 *   （title 必填、`value || null` 空串清除、visited_at/created_at/updated_at 系统派生、
 *   若 visit_outcome 非空 applyVisitOutcome 后只 updateCustomer 并丢弃 tasks），
 *   与能力路径 B 对比持久化真值。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

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
  type CapabilityInvocationScope,
} from '../lib/capabilities/execution';
import { SALES_AGENT_CONFIRMATION_MECHANISM } from '../lib/capabilities/execution/writeAdapters';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/evidence/manifest';
import { createInMemoryObservationEmitter } from '../lib/capabilities/observation';
import {
  VISIT_CREATE_CAPABILITY_IDS,
  VISIT_CREATE_MANIFEST,
} from '../lib/capabilities/visit/createManifest';

import {
  __setDbInstanceForTests,
  createCustomer,
  getCustomer,
  initializeDatabaseSchema,
  updateCustomer,
  type DatabaseLike,
} from '../lib/db';
import type { Customer, VisitOutcome } from '../lib/types';
import { applyVisitOutcome } from '../lib/rules';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import {
  __resetSessionWriteStateStoreForTests,
  getCanonicalProposal,
} from '../lib/salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import { validateAgentWriteProposal, type AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import {
  VISIT_CREATE_INPUT_KEYS,
  VISIT_NEXT_ACTIONS,
  VISIT_OUTCOMES,
  createVisitWithProductRules,
  type VisitCreateInput,
} from '../lib/visitCreate';
import { sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-14T12:00:00.000Z';

/* ------------------------------------------------------------------ */
/* 测试 DB fixture（隔离 :memory:；与 W4-2 能力写集成测试同款）           */
/* ------------------------------------------------------------------ */

function openEmptyFixture() {
  return sqliteFixture();
}

/** 种子客户：与 W4-2 同款基座（面访规则可读 no_show_count / grade / stage / next_follow_up_at）。 */
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
    no_show_count: 0,
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

type Row = Record<string, unknown>;

async function selectCustomerRow(db: DatabaseLike, id: string): Promise<Row | undefined> {
  const rows = await db.select<Row>('SELECT * FROM customers WHERE id = ?', [id]);
  return rows[0];
}

async function selectVisitRow(db: DatabaseLike, id: string): Promise<Row | undefined> {
  const rows = await db.select<Row>('SELECT * FROM visit_records WHERE id = ?', [id]);
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

/** db stub：select 恒返回 scope 客户存在的证据（供交接前存在性校验）。 */
const dbStubWithCustomerA: DatabaseLike = {
  execute: async () => ({ rowsAffected: 0 }),
  select: async () => [{ id: 'customer-A' }],
};

/** db stub：select 恒返回空（无客户；供类型/枚举校验隔离，不触及存在性）。 */
const emptyDbStub: DatabaseLike = {
  execute: async () => ({ rowsAffected: 0 }),
  select: async () => [],
};

/* ------------------------------------------------------------------ */
/* 确认后执行 helper（现有产品确认流；与 W4-1/W4-2 同构）                 */
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

/** 能力路径 B：invoke visit.create → 现有确认流 → 返回真实持久化结果。 */
async function capabilityVisitCreatePath(
  db: DatabaseLike,
  scopeCustomerId: string,
  fields: Record<string, unknown>,
): Promise<{ visit_id: string; fields: readonly string[] }> {
  const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
    capability_id: 'visit.create',
    capability_version: '1.0.0',
    input: { db, ...fields },
    scope: { customer_id: scopeCustomerId },
  });
  expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  if (outcome.status !== 'CONFIRMATION_REQUIRED') throw new Error('unreachable');
  const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
  expect(proposal).not.toBeNull();
  expect(proposal!.tool_id).toBe('create_visit_record');
  const result = await confirmViaExistingFlow(proposal!);
  return { visit_id: result.entity_id, fields: result.fields };
}

/* ------------------------------------------------------------------ */
/* 人工路径 A：显式复刻 VisitForm + CustomerDetail.handleVisitSaved 语义  */
/* ------------------------------------------------------------------ */

async function humanVisitCreatePath(
  customerId: string,
  fields: {
    title: string;
    visit_notes?: string | null;
    customer_concerns?: string | null;
    intent_after_visit?: string | null;
    visit_outcome?: VisitOutcome | null;
    next_action?: string | null;
    expected_contract_at?: string | null;
  },
): Promise<{ visit_id: string }> {
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error('customer missing');
  const now = new Date().toISOString();
  const id = uuidv4();
  const record = {
    id,
    customer_id: customerId,
    title: fields.title,
    visited_at: now,
    visit_notes: fields.visit_notes ?? null,
    customer_concerns: fields.customer_concerns ?? null,
    intent_after_visit: fields.intent_after_visit ?? null,
    visit_outcome: fields.visit_outcome ?? null,
    next_action: fields.next_action ?? null,
    expected_contract_at: fields.expected_contract_at ?? null,
    created_at: now,
    updated_at: now,
  };
  if (record.visit_outcome) {
    const { customer: updated } = applyVisitOutcome(customer, record.visit_outcome);
    await updateCustomer(customerId, updated);
  }
  const { createVisit } = await import('../lib/db');
  await createVisit(record as unknown as Parameters<typeof createVisit>[0]);
  return { visit_id: id };
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

describe('T1 — CAPABILITY DEFINITION: visit.create exists exactly once with frozen metadata', () => {
  it('definition is registered exactly once with the frozen W4-3 contract metadata', () => {
    const definitions = PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.id === 'visit.create');
    expect(definitions).toHaveLength(1);
    const definition = definitions[0]!;
    expect(definition.version).toBe('1.0.0');
    expect(definition.domain).toBe('visit');
    expect(definition.effect).toBe('WRITE');
    expect(definition.data_target).toBe('CRM_FACT');
    expect(definition.risk_level).toBe('MEDIUM');
    expect(definition.authority_policy).toBe('POLICY_CONTROLLED');
    expect(definition.requires_confirmation).toBe(true);
    expect(definition.scope_requirement).toBe('CUSTOMER');
    expect(definition.idempotency).toBe('NONE');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:create_visit_record');
    expect(definition.audit_contract).toEqual({
      audit_required: true,
      record_input: true,
      record_output: false,
      record_effect: true,
    });
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.audit_contract)).toBe(true);
    expect(definition.error_contract).toBe('UNSPECIFIED');
    expect(definition.description).toMatch(/NOT a generic visit\.update\/delete/i);
  });

  it('manifest registers exactly the one W4-3 identity and nothing else', () => {
    expect(VISIT_CREATE_MANIFEST.map((d) => d.id)).toEqual(['visit.create']);
    expect(VISIT_CREATE_CAPABILITY_IDS.create).toBe('visit.create');
  });
});

/* ================================================================== */
/* T2 — EXACT 24 PRODUCTION IDENTITIES                                 */
/* ================================================================== */

describe('T2 — EXACT 24 PRODUCTION IDENTITIES: original 22 preserved; visit.create (W4-3) and customer.delete (W4-4) are the new identities', () => {
  it('count = 24, all original 22 identities remain, new identities are visit.create and customer.delete', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(24);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(24);
    const ids = PRODUCTION_CAPABILITY_IDS;
    const original22 = new Set(ids.filter((id) => id !== 'visit.create' && id !== 'customer.delete'));
    expect(original22.size).toBe(22);
    expect(ids).toHaveLength(24);
    expect(ids.filter((id) => id === 'visit.create')).toEqual(['visit.create']);
    expect(ids.filter((id) => id === 'customer.delete')).toEqual(['customer.delete']);
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
    expect(ids).not.toContain('visit.update');
    expect(ids).not.toContain('visit.delete');
    expect(ids).not.toContain('import.execute');
  });

  it('all 24 identities resolve with version 1.0.0', () => {
    for (const id of PRODUCTION_CAPABILITY_IDS) {
      expect(PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0').id).toBe(id);
    }
  });
});

/* ================================================================== */
/* T3 — EXACT 24 BINDINGS                                              */
/* ================================================================== */

describe('T3 — EXACT 24 BINDINGS: visit.create executor_ref resolves explicitly; unbound = 0', () => {
  it('binding count = 24 and visit.create executor_ref resolves to the visit binding', () => {
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(24);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(24);
    const binding = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve('salesAgentWriteTool:create_visit_record');
    expect(binding).toBeDefined();
    expect(binding?.executor_ref).toBe('salesAgentWriteTool:create_visit_record');
    const unbound = PRODUCTION_CAPABILITY_IDS.filter((id) => {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      return PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref) === undefined;
    });
    expect(unbound).toEqual([]);
  });

  it('PRODUCTION_WRITE_BINDINGS has exactly 11 and includes the visit binding once', async () => {
    const { PRODUCTION_WRITE_BINDINGS } = await import('../lib/capabilities/execution/writeAdapters');
    expect(PRODUCTION_WRITE_BINDINGS).toHaveLength(11);
    expect(PRODUCTION_WRITE_BINDINGS.map((b) => b.executor_ref)).toContain('salesAgentWriteTool:create_visit_record');
    expect(PRODUCTION_WRITE_BINDINGS.filter((b) => b.executor_ref === 'salesAgentWriteTool:create_visit_record')).toHaveLength(1);
  });
});

/* ================================================================== */
/* T4 — CUSTOMER SCOPE                                                 */
/* ================================================================== */

describe('T4 — CUSTOMER SCOPE: scope_requirement = CUSTOMER (existing customer required)', () => {
  it('definition scope is CUSTOMER and scope validation fails closed without customer_id', async () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('visit.create', '1.0.0');
    expect(definition.scope_requirement).toBe('CUSTOMER');
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'visit.create',
      capability_version: '1.0.0',
      input: { db: emptyDbStub, title: 'x' },
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
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: fixture.db, title: '面访' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
        expect(proposal?.customer_id).toBe('customer-A');
        // 匹配的输入选择器（= scope）被允许，但执行器仍以 scope 为准
        const outcome2 = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
          capability_id: 'visit.create',
          capability_version: '1.0.0',
          input: { db: fixture.db, customer_id: 'customer-A', title: '面访2' },
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
    for (const key of ['customer_id', 'customerId']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { [key]: 'customer-B', title: 'x' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, key).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });
});

/* ================================================================== */
/* T7 — EXACT VISIT FIELD WHITELIST                                    */
/* ================================================================== */

describe('T7 — EXACT VISIT FIELD WHITELIST: only the 7 audited visit form fields are accepted', () => {
  const VISIT_KEYS = [
    'title', 'visit_notes', 'customer_concerns', 'intent_after_visit',
    'visit_outcome', 'next_action', 'expected_contract_at',
  ];

  it('VISIT_CREATE_INPUT_KEYS is exactly the audited 7-field set', () => {
    expect([...VISIT_CREATE_INPUT_KEYS].sort()).toEqual([...VISIT_KEYS].sort());
    expect(VISIT_CREATE_INPUT_KEYS).toHaveLength(7);
    for (const forbidden of ['id', 'created_at', 'updated_at', 'visited_at', 'customer_id', 'customerId']) {
      expect(VISIT_CREATE_INPUT_KEYS).not.toContain(forbidden);
    }
  });

  it('every one of the 7 visit fields (title + optional fields) reaches a confirmation proposal', async () => {
    const harness = makeWriteCountingHarness();
    const values: Readonly<Record<string, unknown>> = {
      title: '初次面访',
      visit_notes: '面谈顺利',
      customer_concerns: '价格',
      intent_after_visit: 'HIGH',
      visit_outcome: 'READY_TO_SIGN',
      next_action: 'SEND_CONTRACT',
      expected_contract_at: '2026-08-01',
    };
    for (const key of VISIT_KEYS) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: key === 'title' ? { db: dbStubWithCustomerA, title: values[key] } : { db: dbStubWithCustomerA, title: '标题', [key]: values[key] },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('CONFIRMATION_REQUIRED');
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });
});

/* ================================================================== */
/* T8 — UNKNOWN/SYSTEM KEYS REJECTED                                   */
/* ================================================================== */

describe('T8 — UNKNOWN/SYSTEM KEYS REJECTED: unknown and system-owned fields fail closed', () => {
  it('unknown top-level keys fail closed with INVALID_INPUT and zero executor calls', async () => {
    const harness = makeWriteCountingHarness();
    for (const key of ['extra_field', 'meta', 'rows', 'target', 'notes', 'customerSelector']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { title: 'x', [key]: key === 'meta' ? { stage: 'PAID' } : key === 'rows' ? [{ title: 'y' }] : key === 'target' ? { customer_id: 'customer-B' } : 1 },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, key).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });

  it('system-owned visit fields (id / visited_at / created_at / updated_at) are rejected', async () => {
    const harness = makeWriteCountingHarness();
    for (const field of ['id', 'visited_at', 'created_at', 'updated_at']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { title: 'x', [field]: field === 'visited_at' ? NOW : 'other' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, field).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, field).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });
});

/* ================================================================== */
/* T9 — REQUIRED-FIELD VALIDATION                                      */
/* ================================================================== */

describe('T9 — REQUIRED-FIELD VALIDATION: title is required and must be non-empty', () => {
  it('missing / blank / non-string title fails closed', async () => {
    const harness = makeWriteCountingHarness();
    const cases: Array<Record<string, unknown>> = [
      { db: dbStubWithCustomerA },
      { db: dbStubWithCustomerA, title: '' },
      { db: dbStubWithCustomerA, title: '   ' },
      { db: dbStubWithCustomerA, title: 42 },
      { db: dbStubWithCustomerA, title: null },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });
});

/* ================================================================== */
/* T10 — TYPE/ENUM/DATE VALIDATION                                     */
/* ================================================================== */

describe('T10 — TYPE/ENUM/DATE VALIDATION: wrong types, invalid enums, invalid dates fail closed', () => {
  it('wrong primitive types fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const cases: Array<Record<string, unknown>> = [
      { db: dbStubWithCustomerA, title: 'x', visit_notes: 42 },
      { db: dbStubWithCustomerA, title: 'x', customer_concerns: ['array'] },
      { db: dbStubWithCustomerA, title: 'x', intent_after_visit: 7 },
      { db: dbStubWithCustomerA, title: 'x', visit_outcome: { deep: 'object' } },
      { db: dbStubWithCustomerA, title: 'x', next_action: 5 },
      { db: dbStubWithCustomerA, title: 'x', expected_contract_at: 20260801 },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });

  it('invalid enum values fail closed', async () => {
    const harness = makeWriteCountingHarness();
    const cases: Array<Record<string, unknown>> = [
      { db: dbStubWithCustomerA, title: 'x', intent_after_visit: 'NOPE' },
      { db: dbStubWithCustomerA, title: 'x', visit_outcome: 'WON' },
      { db: dbStubWithCustomerA, title: 'x', next_action: 'VISIT' }, // 完整 NextAction 的 VISIT 不在面访表单 6 项内
      { db: dbStubWithCustomerA, title: 'x', next_action: 'CONFIRM_PAYMENT' },
    ];
    for (const input of cases) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input,
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });

  it('invalid expected_contract_at date strings fail closed', async () => {
    const harness = makeWriteCountingHarness();
    for (const bad of ['2026/08/01', 'not-a-date', '2026-13-40', '2026-02-30']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: dbStubWithCustomerA, title: 'x', expected_contract_at: bad },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, bad).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, bad).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
  });
});

/* ================================================================== */
/* T11 — UNKNOWN CUSTOMER FAIL CLOSED                                  */
/* ================================================================== */

describe('T11 — UNKNOWN CUSTOMER FAIL CLOSED: unknown scope customer fails before mutation, never upsert/create', () => {
  it('handoff fails (INVALID_INPUT) for an unknown scope customer with zero writes', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      // 不 seed 任何客户
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: fixture.db, title: '面访' },
        scope: { customer_id: 'missing-customer' },
      });
      // 引擎 scope 校验通过；交接层读取不到目标客户 → 交接失败 → INVALID_INPUT
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
      expect(await countRows(fixture.db, 'visit_records')).toBe(0);
      expect(await countRows(fixture.db, 'customers')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T12 — A10 DECISION                                                  */
/* ================================================================== */

describe('T12 — A10 DECISION: exact REQUIRE_CONFIRMATION + EXPLICIT_CONFIRMATION_REQUIRED', () => {
  it('evaluateAuthorityPolicy produces the frozen decision', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('visit.create', '1.0.0');
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.capability_id).toBe('visit.create');
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
  });
});

/* ================================================================== */
/* T13 — PRE-CONFIRM VISIT WRITES = 0                                  */
/* ================================================================== */

describe('T13 — PRE-CONFIRM VISIT WRITES = 0: before human confirmation no visit row is created', () => {
  it('after unified execution (confirmation required) visit_records stays empty', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: fixture.db, title: '确认前不应写入' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      expect(await countRows(fixture.db, 'visit_records')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T14 — PRE-CONFIRM CUSTOMER/RULE/TASK WRITES = 0                     */
/* ================================================================== */

describe('T14 — PRE-CONFIRM CUSTOMER/RULE/TASK WRITES = 0: no rule transition / task creation before confirmation', () => {
  it('customer state unchanged and tasks table empty after confirmation-required outcome (even with visit_outcome)', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const before = await selectCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: fixture.db, title: '面访', visit_outcome: 'READY_TO_SIGN' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      expect(await countRows(fixture.db, 'tasks')).toBe(0);
      expect(await countRows(fixture.db, 'visit_records')).toBe(0);
      const after = await selectCustomerRow(fixture.db, 'customer-A');
      expect(after).toEqual(before);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T15 — EXISTING CONFIRMATION RUNTIME REUSED                          */
/* ================================================================== */

describe('T15 — EXISTING CONFIRMATION RUNTIME REUSED: no new proposal store / nonce / replay mechanism', () => {
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
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: fixture.db, title: '交接面访', visit_outcome: 'CONSIDERING' },
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
        expect(proposal!.entity_type).toBe('visit');
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T16 — APPROVED BOUNDARY IS NARROW                                   */
/* ================================================================== */

describe('T16 — APPROVED BOUNDARY IS NARROW: Layer 3 whitelist closure in the shared service + narrow boundary branch', () => {
  it('createVisitWithProductRules rejects non-visit fields before any write', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      await expect(createVisitWithProductRules({ id: uuidv4(), customer_id: 'customer-A', title: 'x', visited_at: NOW } as unknown as VisitCreateInput)).rejects.toThrow();
      await expect(createVisitWithProductRules({ id: uuidv4(), customer_id: 'customer-A', title: 'x', visit_outcome: 'WON' } as unknown as VisitCreateInput)).rejects.toThrow(/visit_outcome/);
      await expect(createVisitWithProductRules({ id: uuidv4(), customer_id: 'customer-A', title: '' } as unknown as VisitCreateInput)).rejects.toThrow(/title/);
      await expect(createVisitWithProductRules({ id: uuidv4(), customer_id: 'customer-A', title: 'x', next_action: 'VISIT' } as unknown as VisitCreateInput)).rejects.toThrow(/next_action/);
      expect(await countRows(fixture.db, 'visit_records')).toBe(0);
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
        proposal_id: 'p-forged', proposal_hash: 'h', tool_id: 'create_visit_record',
        customer_id: 'customer-A', entity_type: 'visit', operation: 'create',
        current_values: {}, proposed_values: { title: '新', visited_at: NOW },
        reason: 'x', evidence_refs: [], reversible: true, nonce: 'n-forged',
        created_at: NOW, status: 'awaiting_confirmation', executable: false, requires_confirmation: true,
      };
      await expect(approvedCrmWriteBoundary.execute(forged, 'x')).rejects.toThrow();
      expect(await countRows(fixture.db, 'visit_records')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('boundary routes create_visit_record through the shared service, not a raw db.createVisit passthrough', () => {
    const boundarySource = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts'), 'utf8');
    expect(boundarySource).toMatch(/proposal\.tool_id === 'create_visit_record'/);
    expect(boundarySource).toMatch(/createVisitWithProductRules/);
    expect(boundarySource).toMatch(/from '\.\.\/visitCreate'/);
  });
});

/* ================================================================== */
/* T17 — REAL CONFIRMED VISIT PATH                                     */
/* ================================================================== */

describe('T17 — REAL CONFIRMED VISIT PATH: after isolated human-confirm simulation exactly one visit is persisted', () => {
  it('confirmed path persists the visit on the real DB path once with all fields', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const { visit_id, fields } = await capabilityVisitCreatePath(fixture.db, 'customer-A', {
        title: '初次面访',
        visit_notes: '面谈顺利',
        customer_concerns: '价格顾虑',
        intent_after_visit: 'HIGH',
        visit_outcome: 'READY_TO_SIGN',
        next_action: 'SEND_CONTRACT',
        expected_contract_at: '2026-08-01',
      });
      const row = await selectVisitRow(fixture.db, visit_id);
      expect(row).toBeDefined();
      expect(row!.title).toBe('初次面访');
      expect(row!.visit_notes).toBe('面谈顺利');
      expect(row!.customer_concerns).toBe('价格顾虑');
      expect(row!.intent_after_visit).toBe('HIGH');
      expect(row!.visit_outcome).toBe('READY_TO_SIGN');
      expect(row!.next_action).toBe('SEND_CONTRACT');
      expect(row!.expected_contract_at).toBe('2026-08-01');
      expect(row!.customer_id).toBe('customer-A');
      // visited_at / created_at / updated_at 系统派生（ISO 时间戳）
      expect(typeof row!.visited_at).toBe('string');
      expect(typeof row!.created_at).toBe('string');
      expect(typeof row!.updated_at).toBe('string');
      expect(fields.sort()).toEqual(VISIT_CREATE_INPUT_KEYS.slice().sort());
      expect(await countRows(fixture.db, 'visit_records')).toBe(1);
      // 恰好一次：再确认同一提案 → replay 拒绝，不再写入
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: fixture.db, title: 'another' },
        scope: { customer_id: 'customer-A' },
      });
      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      await confirmViaExistingFlow(proposal!);
      await expect(confirmViaExistingFlow(proposal!)).rejects.toThrow(/replay/i);
      expect(await countRows(fixture.db, 'visit_records')).toBe(2);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T18 — PRODUCT PARITY WITH HUMAN VISITFORM                           */
/* ================================================================== */

describe('T18 — PRODUCT PARITY WITH HUMAN VISITFORM: visit_outcome rule updates customer state (no tasks)', () => {
  it('READY_TO_SIGN outcome updates customer state (grade/stage/next_action/next_follow_up_at) and creates no task', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const before = await selectCustomerRow(fixture.db, 'customer-A');
      const { visit_id } = await capabilityVisitCreatePath(fixture.db, 'customer-A', {
        title: '签单面访',
        visit_outcome: 'READY_TO_SIGN',
      });
      expect(visit_id).toBeTruthy();
      const after = await selectCustomerRow(fixture.db, 'customer-A');
      expect(after!.customer_grade).toBe('A');
      expect(after!.stage).toBe('CONTRACTING');
      expect(after!.next_action).toBe('SEND_CONTRACT');
      expect(after!.next_follow_up_at).not.toBe(before!.next_follow_up_at);
      // 人工路径丢弃 applyVisitOutcome 返回的 tasks：确认后也不创建任务
      expect(await countRows(fixture.db, 'tasks')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('without visit_outcome the customer row is unchanged (only updated_at timing tolerance) and no task', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const before = await selectCustomerRow(fixture.db, 'customer-A');
      const { visit_id } = await capabilityVisitCreatePath(fixture.db, 'customer-A', { title: '纯记录面访' });
      expect(visit_id).toBeTruthy();
      const after = await selectCustomerRow(fixture.db, 'customer-A');
      for (const field of ['customer_grade', 'stage', 'next_action', 'next_follow_up_at', 'no_show_count', 'lost_reason']) {
        expect(after![field], field).toEqual(before![field]);
      }
      expect(await countRows(fixture.db, 'tasks')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T19 — ONLY SCOPED CUSTOMER'S VISIT CREATED                          */
/* ================================================================== */

describe('T19 — ONLY SCOPED CUSTOMER VISIT CREATED: visit belongs only to invocation.scope.customer_id', () => {
  it('visit row customer_id equals scope customer_id; other customer rows untouched', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      await seedCustomerRow(fixture.db, 'customer-B', { name: 'B的原始名称', region: '上海' });
      const bBefore = await selectCustomerRow(fixture.db, 'customer-B');
      const { visit_id } = await capabilityVisitCreatePath(fixture.db, 'customer-A', { title: 'A的面访' });
      const row = await selectVisitRow(fixture.db, visit_id);
      expect(row!.customer_id).toBe('customer-A');
      expect(await countRows(fixture.db, 'visit_records', 'customer-A')).toBe(1);
      expect(await countRows(fixture.db, 'visit_records', 'customer-B')).toBe(0);
      expect(await selectCustomerRow(fixture.db, 'customer-B')).toEqual(bBefore);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T20 — CROSS-CUSTOMER ADVERSARIAL CASE                               */
/* ================================================================== */

describe('T20 — CROSS-CUSTOMER ADVERSARIAL CASE: smuggled B target fails before the executor', () => {
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
          capability_id: 'visit.create',
          capability_version: '1.0.0',
          input: { [key]: 'customer-B', title: '走私到B' },
          scope: { customer_id: 'customer-A' },
        });
        expect(outcome.status, key).toBe('EXECUTION_ERROR');
        if (outcome.status === 'EXECUTION_ERROR') {
          expect(outcome.error_code, key).toBe('INVALID_INPUT');
        }
      }
      expect(harness.callsFor('salesAgentWriteTool:create_visit_record')).toBe(0);
      expect(await countRows(fixture.db, 'visit_records', 'customer-B')).toBe(0);
      expect(await selectCustomerRow(fixture.db, 'customer-B')).toEqual(bBefore);
      expect(await countRows(fixture.db, 'visit_records', 'customer-A')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T21 — NO DEAD SYMBOLIC EXECUTOR BINDING                             */
/* ================================================================== */

describe('T21 — NO DEAD SYMBOLIC EXECUTOR BINDING: create_visit_record is now executable with the real 7-field whitelist', () => {
  it('allowedFields create_visit_record = the 7 real visit form fields (not the old incomplete 3)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/confirmedWrite.ts'), 'utf8');
    expect(source).toMatch(/create_visit_record: \['title', 'visit_notes', 'customer_concerns', 'intent_after_visit', 'visit_outcome', 'next_action', 'expected_contract_at'\]/);
    // visited_at 不再是输入字段（系统派生），绝不复活旧符号字段
    expect(source).not.toMatch(/create_visit_record: \['title', 'visit_notes', 'visited_at'\]/);
  });

  it('validateAgentWriteProposal accepts the 7-field visit proposal and rejects a forbidden system field', () => {
    const base: AgentWriteProposal = {
      proposal_id: 'p-1', proposal_hash: 'h', tool_id: 'create_visit_record',
      customer_id: 'customer-A', entity_type: 'visit', operation: 'create',
      current_values: {}, proposed_values: { title: '新', visit_notes: 'n', customer_concerns: 'c', intent_after_visit: 'HIGH', visit_outcome: 'CONSIDERING', next_action: 'WAIT_CUSTOMER', expected_contract_at: '2026-08-01' },
      reason: 'x', evidence_refs: [], reversible: true, nonce: 'n-1',
      created_at: NOW, status: 'awaiting_confirmation', executable: false, requires_confirmation: true,
    };
    expect(() => validateAgentWriteProposal(base)).not.toThrow();
    const forged: AgentWriteProposal = { ...base, proposed_values: { ...base.proposed_values, visited_at: NOW } };
    expect(() => validateAgentWriteProposal(forged)).toThrow(/forbidden field/);
  });

  it('visit.create executor_ref is create_visit_record (revived truthfully), never a fabricated second identity', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('visit.create', '1.0.0');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:create_visit_record');
    const ids = PRODUCTION_CAPABILITY_IDS;
    expect(ids).not.toContain('visit.record.create');
    expect(ids).not.toContain('visit.update');
    expect(ids).not.toContain('visit.delete');
  });
});

/* ================================================================== */
/* T22 — OUTPUT MINIMIZED                                              */
/* ================================================================== */

describe('T22 — OUTPUT MINIMIZED: result is visit_id-level, never a full raw row', () => {
  it('shared product service returns exactly { visit_id }', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const result = await createVisitWithProductRules({ id: uuidv4(), customer_id: 'customer-A', title: '最小输出' });
      expect(Object.keys(result).sort()).toEqual(['visit_id']);
      expect(result.visit_id).toBeTruthy();
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
      const { visit_id, fields } = await capabilityVisitCreatePath(fixture.db, 'customer-A', { title: '最小输出确认' });
      expect(visit_id).toBeTruthy();
      expect(fields.sort()).toEqual(VISIT_CREATE_INPUT_KEYS.slice().sort());
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T23 — OBSERVATION PRE-CONFIRM LIFECYCLE                             */
/* ================================================================== */

describe('T23 — OBSERVATION PRE-CONFIRM: STARTED → AUTHORITY_DECIDED → CONFIRMATION_REQUIRED with same invocation_id', () => {
  it('visit.create lifecycle emits the exact three events with CUSTOMER scope', async () => {
    const emitter = createInMemoryObservationEmitter();
    const bridge = createObservationBridge(emitter);
    const engine = createProductionCapabilityExecution(bridge.observer);
    const outcome = await engine.invoke({
      capability_id: 'visit.create',
      capability_version: '1.0.0',
      input: { db: dbStubWithCustomerA, title: '新面访' },
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
    expect(events.every((e) => e.capability_id === 'visit.create')).toBe(true);
    expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
  });
});

/* ================================================================== */
/* T24 — RAW PAYLOAD NOT LOGGED                                        */
/* ================================================================== */

describe('T24 — RAW PAYLOAD NOT LOGGED: Observation remains payload-minimal (no visit field names or values)', () => {
  it('events carry no business payload from the visit input', async () => {
    const emitter = createInMemoryObservationEmitter();
    const bridge = createObservationBridge(emitter);
    const engine = createProductionCapabilityExecution(bridge.observer);
    const secretMarker = 'RAW-VISIT-SECRET-MARKER';
    await engine.invoke({
      capability_id: 'visit.create',
      capability_version: '1.0.0',
      input: {
        db: dbStubWithCustomerA,
        title: '新面访',
        visit_notes: secretMarker,
        customer_concerns: '客户秘密关注点',
      },
      scope: { customer_id: 'customer-A' },
    });
    const serialized = JSON.stringify(emitter.events());
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain('客户秘密关注点');
    expect(serialized).not.toContain('新面访');
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
/* T25 — REPLAY / IDEMPOTENCY SEPARATION                               */
/* ================================================================== */

describe('T25 — REPLAY / IDEMPOTENCY SEPARATION: nonce replay protection is distinct from business idempotency', () => {
  it('same proposal cannot be re-confirmed (replay) but a new proposal creates a second visit (business non-idempotent)', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'visit.create',
        capability_version: '1.0.0',
        input: { db: fixture.db, title: '防重放面访' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      await confirmViaExistingFlow(proposal!);
      await expect(confirmViaExistingFlow(proposal!)).rejects.toThrow(/replay/i);
      expect(await countRows(fixture.db, 'visit_records')).toBe(1);
      // 业务不幂等：全新 proposal → 第二面访记录（与 A1 idempotency=NONE 一致）
      await capabilityVisitCreatePath(fixture.db, 'customer-A', { title: '防重放面访' });
      expect(await countRows(fixture.db, 'visit_records')).toBe(2);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T26 — W4-1 CUSTOMER.CREATE REGRESSION                               */
/* ================================================================== */

describe('T26 — W4-1 CUSTOMER.CREATE REGRESSION: customer.create remains truthful and unchanged', () => {
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
/* T27 — W4-2 CUSTOMER.PROFILE.UPDATE REGRESSION                       */
/* ================================================================== */

describe('T27 — W4-2 CUSTOMER.PROFILE.UPDATE REGRESSION: remains truthful and unchanged', () => {
  it('customer.profile.update still registers, still confirms, executor_ref unchanged', async () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.profile.update', '1.0.0');
    expect(definition.scope_requirement).toBe('CUSTOMER');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:update_customer_profile');
    expect(evaluateAuthorityPolicy(definition).decision).toBe('REQUIRE_CONFIRMATION');
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.profile.update',
      capability_version: '1.0.0',
      input: { db: { execute: async () => ({ rowsAffected: 0 }), select: async () => [{ id: 'customer-A', name: '旧' }] }, name: '新' },
      scope: { customer_id: 'customer-A' },
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
  });
});

/* ================================================================== */
/* T28 — FOLLOW_UP.CREATE REMAINS DISTINCT                             */
/* ================================================================== */

describe('T28 — FOLLOW_UP.CREATE REMAINS DISTINCT: visit.create does not merge into follow_up.create', () => {
  it('follow_up.create executor_ref unchanged and distinct from visit.create', () => {
    const followUp = PRODUCTION_CAPABILITY_REGISTRY.get('follow_up.create', '1.0.0');
    const visit = PRODUCTION_CAPABILITY_REGISTRY.get('visit.create', '1.0.0');
    expect(followUp.executor_ref).toBe('salesAgentWriteTool:create_follow_up_record');
    expect(visit.executor_ref).toBe('salesAgentWriteTool:create_visit_record');
    expect(followUp.executor_ref).not.toBe(visit.executor_ref);
  });
});

/* ================================================================== */
/* T29 — IMPORT.EXECUTE / VISIT.UPDATE / VISIT.DELETE ABSENT           */
/* ================================================================== */

describe('T29 — IMPORT.EXECUTE / VISIT.UPDATE / VISIT.DELETE ABSENT: no scope expansion (customer.delete is a legitimate W4-4 identity)', () => {
  it('none of the forbidden identities are registered', () => {
    const ids = PRODUCTION_CAPABILITY_IDS;
    for (const forbidden of ['import.execute', 'visit.update', 'visit.delete']) {
      expect(ids).not.toContain(forbidden);
    }
  });
});

/* ================================================================== */
/* T30 — NO V0.3 LEAKAGE                                               */
/* ================================================================== */

describe('T30 — NO V0.3 LEAKAGE: no Evidence capability; no Agent loop / planner in the visit path', () => {
  it('evidence domain still contributes zero capabilities', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    expect(PRODUCTION_CAPABILITY_IDS.some((id) => id.startsWith('evidence'))).toBe(false);
  });

  it('visit manifest + shared service contain no planner / Agent-loop / model / provider machinery', () => {
    const files = [
      'src/lib/capabilities/visit/createManifest.ts',
      'src/lib/visitCreate.ts',
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
/* §13 — REAL PRODUCT GOLDEN PATH PARITY (A vs B)                      */
/* ================================================================== */

describe('§13 — REAL PRODUCT GOLDEN PATH PARITY: human VisitForm composition (A) vs confirmed visit.create capability path (B) persist equivalent product truth', () => {
  it('visit fields match, visit_outcome rule side effect matches, no tasks, other customer unchanged', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      await seedCustomerRow(fixture.db, 'customer-A-human');
      await seedCustomerRow(fixture.db, 'customer-B', { name: 'B的原始名称', region: '上海' });

      const fields = {
        title: '黄金路径面访',
        visit_notes: '黄金路径面谈',
        customer_concerns: '黄金路径关注点',
        intent_after_visit: 'MEDIUM' as const,
        visit_outcome: 'CONSIDERING' as const,
        next_action: 'WAIT_CUSTOMER' as const,
        expected_contract_at: '2026-08-15',
      };

      const bBefore = await selectCustomerRow(fixture.db, 'customer-B');

      // A：人工 VisitForm + handleVisitSaved 语义
      const humanResult = await humanVisitCreatePath('customer-A-human', { ...fields });
      // B：确认后 visit.create 能力路径
      const agentResult = await capabilityVisitCreatePath(fixture.db, 'customer-A', { ...fields });

      const humanVisit = await selectVisitRow(fixture.db, humanResult.visit_id);
      const agentVisit = await selectVisitRow(fixture.db, agentResult.visit_id);
      expect(humanVisit).toBeDefined();
      expect(agentVisit).toBeDefined();

      // 面访字段完全相等（产品对等）
      for (const field of VISIT_CREATE_INPUT_KEYS) {
        expect(agentVisit![field], `visit field ${field} must match`).toEqual(humanVisit![field]);
      }
      // 系统派生字段：非空字符串（时间戳毫秒差异容忍）
      for (const field of ['id', 'visited_at', 'created_at', 'updated_at']) {
        expect(typeof agentVisit![field], field).toBe('string');
        expect((agentVisit![field] as string).length, field).toBeGreaterThan(0);
      }

      // 面访结论规则副作用：两个客户（A / A-human）都应用 CONSIDERING 规则，产品结果等价
      const humanCustomer = await selectCustomerRow(fixture.db, 'customer-A-human');
      const agentCustomer = await selectCustomerRow(fixture.db, 'customer-A');
      for (const field of ['customer_grade', 'stage', 'next_action', 'no_show_count', 'lost_reason']) {
        expect(agentCustomer![field], `customer rule field ${field}`).toEqual(humanCustomer![field]);
      }
      // next_follow_up_at 由规则按等级重算（CONSIDERING → B → daysLater(3)），两路径等价
      expect(agentCustomer!.next_follow_up_at).toEqual(humanCustomer!.next_follow_up_at);
      // 无任务（人工路径丢弃 applyVisitOutcome 返回的 tasks；能力路径同样不创建）
      expect(await countRows(fixture.db, 'tasks')).toBe(0);

      // 其他客户不变（B 行逐字节一致）
      const bAfter = await selectCustomerRow(fixture.db, 'customer-B');
      expect(bAfter).toEqual(bBefore);

      // 面访记录各 1 条（A 与 B 各自为其目标客户创建，绝不越界）
      expect(await countRows(fixture.db, 'visit_records', 'customer-A')).toBe(1);
      expect(await countRows(fixture.db, 'visit_records', 'customer-A-human')).toBe(1);
      expect(await countRows(fixture.db, 'visit_records', 'customer-B')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('without visit_outcome both paths persist an identical pure visit record and leave customer state unchanged', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomerRow(fixture.db, 'customer-A');
      await seedCustomerRow(fixture.db, 'customer-A-human');
      const fields = { title: '纯记录黄金路径', visit_notes: '无结论面访' };
      const humanResult = await humanVisitCreatePath('customer-A-human', fields);
      const agentResult = await capabilityVisitCreatePath(fixture.db, 'customer-A', fields);
      const humanVisit = await selectVisitRow(fixture.db, humanResult.visit_id);
      const agentVisit = await selectVisitRow(fixture.db, agentResult.visit_id);
      for (const field of VISIT_CREATE_INPUT_KEYS) {
        expect(agentVisit![field], field).toEqual(humanVisit![field]);
      }
      const humanCustomer = await selectCustomerRow(fixture.db, 'customer-A-human');
      const agentCustomer = await selectCustomerRow(fixture.db, 'customer-A');
      for (const field of ['customer_grade', 'stage', 'next_action', 'no_show_count', 'lost_reason']) {
        expect(agentCustomer![field], field).toEqual(humanCustomer![field]);
      }
      expect(await countRows(fixture.db, 'tasks')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});
