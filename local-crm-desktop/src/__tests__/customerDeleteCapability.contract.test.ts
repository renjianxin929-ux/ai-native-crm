/**
 * V0.2A / W4-4 — customer.delete Capability 契约测试（T1–T30 + 真实产品黄金路径对等）。
 *
 * 证明唯一新增破坏性生产能力 customer.delete（W4-4 冻结方向：SCOPE=CUSTOMER /
 * EFFECT=DELETE / RISK=DESTRUCTIVE / REQUIRES_CONFIRMATION=true；A10 产出
 * REQUIRE_STRONG_CONFIRMATION）：
 *   T1  能力定义（冻结元数据，恰一次）      T2  生产计数 23（原 22 保持 + 唯一新身份）
 *   T3  生产绑定 23 / UNBOUND=0             T4  scope=CUSTOMER
 *   T5  生效客户身份只来自 scope             T6  customer_id/customerId 输入拒绝
 *   T7  未知客户 fail closed                T8  effect=DELETE / risk=DESTRUCTIVE
 *   T9  A10 REQUIRE_STRONG_CONFIRMATION     T10 普通确认不能降级强确认
 *   T11 确认前客户删除=0                    T12 确认前关联记录删除=0
 *   T13 现有确认运行时复用                  T14 提案如实标记破坏性/不可逆
 *   T15 提案载荷最小化                      T16 批准边界执行真实产品删除
 *   T17 确认后客户真实消失                  T18 级联删除与产品真值一致
 *   T19 无关客户存活                        T20 跨客户对抗删除被阻断
 *   T21 二次执行/重放无意外副作用            T22 无伪造回滚保证
 *   T23 结果最小化                          T24 观察预确认生命周期
 *   T25 原始客户载荷不入观察事件            T26 W4-1 customer.create 不变
 *   T27 W4-2 profile.update 不变           T28 visit.create/import.execute 缺席
 *   T29 无通用 customer.update              T30 无 V0.3 泄漏
 *   §30 真实产品黄金路径对等（A 人工 deleteCustomer vs B 确认后能力路径）
 *
 * 原则：
 * - 只使用隔离测试 DB（better-sqlite3 :memory:），绝不触碰真实用户 CRM 数据。
 * - 统一执行全部经 PRODUCTION_CAPABILITY_EXECUTION（Registry → Input → Scope → A10 →
 *   强确认交接）；确认后执行经现有产品确认流（SalesAgentSession.confirmWriteByRef →
 *   approvedCrmWriteBoundary → db.deleteCustomer）。
 * - 人工路径 A 直接调用 db.deleteCustomer（CustomerDetail handleDelete 的真实产品路径），
 *   与能力路径 B 对比持久化真值，证明能力路径复用同一删除函数、无第二份删除实现。
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
  type CapabilityInvocation,
  type CapabilityInvocationScope,
} from '../lib/capabilities/execution';
import { SALES_AGENT_CONFIRMATION_MECHANISM } from '../lib/capabilities/execution/writeAdapters';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/evidence/manifest';
import { createInMemoryObservationEmitter } from '../lib/capabilities/observation';
import {
  CUSTOMER_DELETE_CAPABILITY_IDS,
  CUSTOMER_DELETE_MANIFEST,
} from '../lib/capabilities/customer/deleteManifest';

import {
  __setDbInstanceForTests,
  createCustomer,
  deleteCustomer,
  getCustomer,
  initializeDatabaseSchema,
  type DatabaseLike,
} from '../lib/db';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import {
  __resetSessionWriteStateStoreForTests,
  getCanonicalProposal,
} from '../lib/salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import { validateAgentWriteProposal, type AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
import type { CapabilityDefinition } from '../lib/capabilities/types';
import { sqliteFixture } from './salesAgentProductionHarness';

const NOW = '2026-07-14T12:00:00.000Z';

/* ------------------------------------------------------------------ */
/* 测试 DB fixture（隔离 :memory:）                                     */
/* ------------------------------------------------------------------ */

function openEmptyFixture() {
  return sqliteFixture();
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

/** 种子一个客户（复用真实产品 createCustomer 语义）。 */
async function seedCustomer(db: DatabaseLike, id: string, name = `客户-${id}`): Promise<void> {
  await createCustomer(
    id,
    name,
    'WECHAT',
    `wx-${id}`,
    `1380000${id.slice(-4).padStart(4, '0')}`,
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
    'https://example.com',
    '广州',
    '软件',
    '王经理',
    'wang@example.com',
    '天河区',
    '降本增效',
    '关键决策人',
    '线下活动',
  );
}

/**
 * 种子 customer.delete 级联的 7 个产品拥有的表（每个客户各 1 条），
 * 精确复刻 db.deleteCustomer 的应用层级联目标：
 * follow_up_records / visit_records / tasks / customer_stage_cards /
 * customer_hypotheses / reviewed_facts / intelligence_imports。
 */
async function seedCustomerOwnedRecords(db: DatabaseLike, customerId: string): Promise<void> {
  await db.execute(
    `INSERT INTO follow_up_records (id, customer_id, title, contact_channel, contact_result, feedback_notes, intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`fu-${customerId}`, customerId, '跟进记录', null, null, '反馈', null, null, null, null, 0, NOW, NOW],
  );
  await db.execute(
    `INSERT INTO visit_records (id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit, visit_outcome, next_action, expected_contract_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`v-${customerId}`, customerId, '面访', NOW, '面访记录', null, null, null, null, null, NOW, NOW],
  );
  await db.execute(
    `INSERT INTO tasks (id, customer_id, title, due_at, status, priority, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`t-${customerId}`, customerId, '任务', null, 'OPEN', 'MEDIUM', 'MANUAL', NOW, NOW],
  );
  await db.execute(
    `INSERT INTO intelligence_imports (id, customer_id, source_system, source_label, raw_content, content_hash, parser_version, parse_status, confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`imp-${customerId}`, customerId, 'MANUAL', 'label', 'raw', 'hash', 'v1', 'DRAFTED', null, NOW, NOW],
  );
  await db.execute(
    `INSERT INTO reviewed_facts (id, customer_id, source_import_id, fact_category, statement, normalized_value_json, verification_status, confidence, applicability, observed_at, valid_until, evidence_refs_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`rf-${customerId}`, customerId, `imp-${customerId}`, 'FACT', 'statement', null, 'PENDING', 0.5, 'GLOBAL', null, null, '[]', NOW, NOW],
  );
  await db.execute(
    `INSERT INTO customer_hypotheses (id, customer_id, source_import_id, category, statement, rationale, status, applicability, why_it_matters, validation_question, disconfirm_condition, evidence_refs_json, status_audit_json, created_at, resolved_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`hyp-${customerId}`, customerId, `imp-${customerId}`, 'HYP', 'statement', null, 'PENDING', 'CONDITIONAL', null, null, null, '[]', '[]', NOW, null, NOW],
  );
  await db.execute(
    `INSERT INTO customer_stage_cards (id, customer_id, stage_code, version, schema_version, card_status, source_import_id, supersedes_card_id, payload_json, evidence_snapshot_hash, generated_by, confirmed_by, created_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`card-${customerId}`, customerId, 'NEW_LEAD', 1, 'v1', 'DRAFT', `imp-${customerId}`, null, '{}', 'hash', 'DETERMINISTIC', null, NOW, null],
  );
}

/** 7 个产品级联目标表名（与 db.deleteCustomer 精确一致）。 */
const CASCADE_TABLES = [
  'follow_up_records',
  'visit_records',
  'tasks',
  'customer_stage_cards',
  'customer_hypotheses',
  'reviewed_facts',
  'intelligence_imports',
] as const;

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
/* 确认后执行 helper（现有产品确认流；与 W4-1/W4-2 同构）                */
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

/** 能力路径 B：invoke customer.delete → 强确认交接 → 现有确认流 → 真实删除。 */
async function capabilityDeletePath(db: DatabaseLike, scopeCustomerId: string): Promise<{ entity_id: string; fields: readonly string[] }> {
  const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
    capability_id: 'customer.delete',
    capability_version: '1.0.0',
    input: { db },
    scope: { customer_id: scopeCustomerId },
  });
  expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
  if (outcome.status !== 'STRONG_CONFIRMATION_REQUIRED') throw new Error('unreachable');
  const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
  expect(proposal).not.toBeNull();
  expect(proposal!.tool_id).toBe('delete_customer');
  const result = await confirmViaExistingFlow(proposal!);
  expect(result.entity_id).toBe(scopeCustomerId);
  return result;
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

describe('T1 — CAPABILITY DEFINITION: customer.delete exists exactly once with frozen metadata', () => {
  it('definition is registered exactly once with the frozen W4-4 contract metadata', () => {
    const definitions = PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.id === 'customer.delete');
    expect(definitions).toHaveLength(1);
    const definition = definitions[0]!;
    expect(definition.version).toBe('1.0.0');
    expect(definition.domain).toBe('customer');
    expect(definition.effect).toBe('DELETE');
    expect(definition.data_target).toBe('CRM_FACT');
    expect(definition.risk_level).toBe('DESTRUCTIVE');
    expect(definition.authority_policy).toBe('STRONG_CONFIRM');
    expect(definition.requires_confirmation).toBe(true);
    expect(definition.scope_requirement).toBe('CUSTOMER');
    expect(definition.idempotency).toBe('NONE');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:delete_customer');
    expect(definition.audit_contract).toEqual({
      audit_required: true,
      record_input: true,
      record_output: false,
      record_effect: true,
    });
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.audit_contract)).toBe(true);
    expect(definition.error_contract).toBe('UNSPECIFIED');
    // 描述必须如实标记硬删除 / 不可逆 / 级联，并明确否认 archive / soft delete 标签
    expect(definition.description).toMatch(/hard-?delete|irreversible|永久/i);
    expect(definition.description).toMatch(/NOT an archive|NOT.*soft\s*delete|no rollback|no tombstone/i);
  });

  it('manifest registers exactly the one W4-4 identity and nothing else', () => {
    expect(CUSTOMER_DELETE_MANIFEST.map((d) => d.id)).toEqual(['customer.delete']);
    expect(CUSTOMER_DELETE_CAPABILITY_IDS.delete).toBe('customer.delete');
  });
});

/* ================================================================== */
/* T2 — EXACT 23 PRODUCTION IDENTITIES                                 */
/* ================================================================== */

describe('T2 — EXACT 23 PRODUCTION IDENTITIES: original 22 preserved; customer.delete is the only new identity', () => {
  it('count = 23, all original 22 identities remain, only new identity is customer.delete', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(23);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(23);
    const ids = PRODUCTION_CAPABILITY_IDS;
    const original22 = new Set(ids.filter((id) => id !== 'customer.delete'));
    expect(original22.size).toBe(22);
    expect(ids).toHaveLength(23);
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
    // 不存在的身份仍不存在
    expect(ids).not.toContain('customer.update');
    expect(ids).not.toContain('customer.state.update');
    expect(ids).not.toContain('visit.create');
    expect(ids).not.toContain('import.execute');
  });

  it('all 23 identities resolve with version 1.0.0', () => {
    for (const id of PRODUCTION_CAPABILITY_IDS) {
      expect(PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0').id).toBe(id);
    }
  });
});

/* ================================================================== */
/* T3 — EXACT 23 BINDINGS                                              */
/* ================================================================== */

describe('T3 — EXACT 23 BINDINGS: customer.delete executor_ref resolves explicitly; unbound = 0', () => {
  it('binding count = 23 and customer.delete executor_ref resolves to the delete binding', () => {
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(23);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(23);
    const binding = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve('salesAgentWriteTool:delete_customer');
    expect(binding).toBeDefined();
    expect(binding?.executor_ref).toBe('salesAgentWriteTool:delete_customer');
    const unbound = PRODUCTION_CAPABILITY_IDS.filter((id) => {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      return PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref) === undefined;
    });
    expect(unbound).toEqual([]);
  });

  it('PRODUCTION_WRITE_BINDINGS has exactly 10 and includes the delete binding once', async () => {
    const { PRODUCTION_WRITE_BINDINGS } = await import('../lib/capabilities/execution/writeAdapters');
    expect(PRODUCTION_WRITE_BINDINGS).toHaveLength(10);
    expect(PRODUCTION_WRITE_BINDINGS.map((b) => b.executor_ref)).toContain('salesAgentWriteTool:delete_customer');
    expect(PRODUCTION_WRITE_BINDINGS.filter((b) => b.executor_ref === 'salesAgentWriteTool:delete_customer')).toHaveLength(1);
  });
});

/* ================================================================== */
/* T4 — CUSTOMER SCOPE                                                 */
/* ================================================================== */

describe('T4 — CUSTOMER SCOPE: scope_requirement = CUSTOMER (existing customer required)', () => {
  it('definition scope is CUSTOMER and scope validation fails closed without customer_id', async () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.delete', '1.0.0');
    expect(definition.scope_requirement).toBe('CUSTOMER');
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.delete',
      capability_version: '1.0.0',
      input: { db: { execute: async () => ({ rowsAffected: 0 }), select: async () => [] } },
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
      await seedCustomer(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
        expect(proposal?.customer_id).toBe('customer-A');
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
  it('any input customer selector that contradicts scope fails closed (INVALID_INPUT, calls = 0)', async () => {
    const harness = makeWriteCountingHarness();
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    for (const key of ['customer_id', 'customerId']) {
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: dbStub, [key]: 'customer-B' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status, key).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, key).toBe('INVALID_INPUT');
      }
    }
    expect(harness.callsFor('salesAgentWriteTool:delete_customer')).toBe(0);
  });
});

/* ================================================================== */
/* T7 — UNKNOWN CUSTOMER FAIL CLOSED                                   */
/* ================================================================== */

describe('T7 — UNKNOWN CUSTOMER FAIL CLOSED: handoff fails truthfully, zero deletion', () => {
  it('scope customer that does not exist fails at handoff (INVALID_INPUT), nothing deleted', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      const before = await countRows(fixture.db, 'customers');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-UNKNOWN' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
        expect(outcome.message).toMatch(/does not exist/);
      }
      expect(await countRows(fixture.db, 'customers')).toBe(before);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T8 — EFFECT / RISK                                                 */
/* ================================================================== */

describe('T8 — EFFECT=DELETE / RISK=DESTRUCTIVE: frozen destructive semantics', () => {
  it('definition carries the frozen destructive effect/risk vocabulary', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.delete', '1.0.0');
    expect(definition.effect).toBe('DELETE');
    expect(definition.risk_level).toBe('DESTRUCTIVE');
    expect(definition.requires_confirmation).toBe(true);
  });
});

/* ================================================================== */
/* T9 — A10 STRONG CONFIRMATION DECISION                               */
/* ================================================================== */

describe('T9 — A10 DECISION: exact REQUIRE_STRONG_CONFIRMATION + DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL', () => {
  it('evaluateAuthorityPolicy produces the frozen strong-confirmation decision', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.delete', '1.0.0');
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.capability_id).toBe('customer.delete');
    expect(decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    expect(decision.reason_code).toBe('DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL');
    expect(decision.confirmation_required).toBe(true);
    expect(decision.autonomous_allowed).toBe(false);
  });
});

/* ================================================================== */
/* T10 — NO STRONG→NORMAL DOWNGRADE                                    */
/* ================================================================== */

describe('T10 — NO STRONG→NORMAL DOWNGRADE: DELETE effect floors to strong confirmation regardless of authority', () => {
  it('a forged DELETE definition with CONFIRM / AUTO authority still yields REQUIRE_STRONG_CONFIRMATION', () => {
    const base = PRODUCTION_CAPABILITY_REGISTRY.get('customer.delete', '1.0.0');
    for (const authority of ['CONFIRM', 'AUTO', 'POLICY_CONTROLLED'] as const) {
      const forged: CapabilityDefinition = { ...base, authority_policy: authority, requires_confirmation: authority !== 'AUTO' };
      const decision = evaluateAuthorityPolicy(forged);
      expect(decision.decision, authority).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(decision.reason_code, authority).toBe('DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL');
    }
    // DENY_AUTONOMOUS 仍是最强楼层：拒绝自主，但绝不降级为普通确认
    const denied = evaluateAuthorityPolicy({ ...base, authority_policy: 'DENY_AUTONOMOUS' });
    expect(denied.decision).toBe('DENY_AUTONOMOUS');
  });
});

/* ================================================================== */
/* T11 — PRE-CONFIRM ZERO CUSTOMER DELETE                              */
/* ================================================================== */

describe('T11 — PRE-CONFIRM ZERO CUSTOMER DELETE: customer row unchanged before strong confirmation', () => {
  it('after STRONG_CONFIRMATION_REQUIRED the seeded customer row still exists and delete executor never ran', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      const harness = makeWriteCountingHarness();
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      expect(await getCustomer('customer-A')).not.toBeNull();
      expect(await countRows(fixture.db, 'customers')).toBe(1);
      expect(harness.callsFor('salesAgentWriteTool:delete_customer')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T12 — PRE-CONFIRM ZERO RELATED-RECORD DELETE                        */
/* ================================================================== */

describe('T12 — PRE-CONFIRM ZERO RELATED-RECORD DELETE: dependent records unchanged before strong confirmation', () => {
  it('all 7 cascade tables keep their rows after STRONG_CONFIRMATION_REQUIRED', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      await seedCustomerOwnedRecords(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      for (const table of CASCADE_TABLES) {
        expect(await countRows(fixture.db, table, 'customer-A'), table).toBe(1);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T13 — EXISTING CONFIRMATION RUNTIME REUSED                          */
/* ================================================================== */

describe('T13 — EXISTING CONFIRMATION RUNTIME REUSED: no new proposal store / nonce / replay mechanism', () => {
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
      await seedCustomer(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
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
});

/* ================================================================== */
/* T14 — PROPOSAL TRUTHFULLY MARKS DESTRUCTIVE / IRREVERSIBLE          */
/* ================================================================== */

describe('T14 — PROPOSAL TRUTHFULLY MARKS DESTRUCTIVE / IRREVERSIBLE ACTION', () => {
  it('delete proposal is operation=delete, reversible=false, and reason discloses hard delete + cascade', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
        expect(proposal!.operation).toBe('delete');
        expect(proposal!.reversible).toBe(false);
        expect(proposal!.tool_id).toBe('delete_customer');
        expect(proposal!.reason).toMatch(/硬删除|不可逆|永久/i);
        expect(proposal!.reason).toMatch(/follow_up_records|visit_records|tasks|级联/);
        expect(proposal!.reason).not.toMatch(/\barchive\b|\bsoft\s*delete\b/i);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T15 — PROPOSAL PAYLOAD MINIMIZED                                    */
/* ================================================================== */

describe('T15 — PROPOSAL PAYLOAD MINIMIZED: bounded identity only, no raw customer snapshot', () => {
  it('proposed_values is empty and current_values carries only the bounded customer_name', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A', '最小载荷客户');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id);
        expect(Object.keys(proposal!.proposed_values)).toEqual([]);
        expect(Object.keys(proposal!.current_values).sort()).toEqual(['customer_name']);
        expect(proposal!.current_values.customer_name).toBe('最小载荷客户');
        // 无整行客户快照：不携带手机/微信/备注等 PII
        const serialized = JSON.stringify(proposal);
        expect(serialized).not.toContain('wang@example.com');
        expect(serialized).not.toContain('原始备注');
        expect(serialized).not.toContain('1380000');
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('validateAgentWriteProposal accepts the empty-proposed_values delete proposal and rejects smuggled fields', () => {
    const base: AgentWriteProposal = {
      proposal_id: 'p-1', proposal_hash: 'h', tool_id: 'delete_customer',
      customer_id: 'customer-A', entity_type: 'customer', operation: 'delete',
      current_values: { customer_name: 'Ada' }, proposed_values: {},
      reason: '硬删除', evidence_refs: [], reversible: false, nonce: 'n-1',
      created_at: NOW, status: 'awaiting_confirmation', executable: false, requires_confirmation: true,
    };
    expect(() => validateAgentWriteProposal(base)).not.toThrow();
    const smuggled: AgentWriteProposal = { ...base, proposed_values: { customer_id: 'customer-B' } };
    expect(() => validateAgentWriteProposal(smuggled)).toThrow(/forbidden field/);
  });
});

/* ================================================================== */
/* T16 — APPROVED BOUNDARY EXECUTES REAL PRODUCT DELETE                */
/* ================================================================== */

describe('T16 — APPROVED BOUNDARY EXECUTES REAL PRODUCT DELETE: delete_customer routes to db.deleteCustomer', () => {
  it('boundary source routes delete_customer through the shared product deleteCustomer, not a second implementation', () => {
    const boundarySource = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts'), 'utf8');
    expect(boundarySource).toMatch(/proposal\.tool_id === 'delete_customer'/);
    expect(boundarySource).toMatch(/deleteCustomer\(proposal\.customer_id\)/);
    expect(boundarySource).toMatch(/deleteCustomer.*from '\.\.\/db'|from '\.\.\/db'.*deleteCustomer/s);
  });
});

/* ================================================================== */
/* T17 — REAL CUSTOMER DISAPPEARS AFTER CONFIRMED EXECUTION            */
/* ================================================================== */

describe('T17 — REAL CUSTOMER DISAPPEARS AFTER CONFIRMED EXECUTION', () => {
  it('confirmed delete removes the customer row via the real product path', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      expect(await getCustomer('customer-A')).not.toBeNull();
      await capabilityDeletePath(fixture.db, 'customer-A');
      expect(await getCustomer('customer-A')).toBeNull();
      expect(await countRows(fixture.db, 'customers')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T18 — CASCADE PARITY                                               */
/* ================================================================== */

describe('T18 — CASCADE PARITY: confirmed delete removes the same product-owned records as db.deleteCustomer', () => {
  it('all 7 product cascade tables lose the customer-owned rows', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      await seedCustomerOwnedRecords(fixture.db, 'customer-A');
      for (const table of CASCADE_TABLES) {
        expect(await countRows(fixture.db, table, 'customer-A'), table).toBe(1);
      }
      await capabilityDeletePath(fixture.db, 'customer-A');
      for (const table of CASCADE_TABLES) {
        expect(await countRows(fixture.db, table, 'customer-A'), table).toBe(0);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T19 — UNRELATED CUSTOMER SURVIVES                                   */
/* ================================================================== */

describe('T19 — UNRELATED CUSTOMER SURVIVES: customer B and its dependent records intact', () => {
  it('deleting A leaves B and all B-owned records untouched', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      await seedCustomer(fixture.db, 'customer-B');
      await seedCustomerOwnedRecords(fixture.db, 'customer-A');
      await seedCustomerOwnedRecords(fixture.db, 'customer-B');
      await capabilityDeletePath(fixture.db, 'customer-A');
      expect(await getCustomer('customer-A')).toBeNull();
      expect(await getCustomer('customer-B')).not.toBeNull();
      for (const table of CASCADE_TABLES) {
        expect(await countRows(fixture.db, table, 'customer-A'), table).toBe(0);
        expect(await countRows(fixture.db, table, 'customer-B'), table).toBe(1);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T20 — CROSS-CUSTOMER ADVERSARIAL DELETE BLOCKED                     */
/* ================================================================== */

describe('T20 — CROSS-CUSTOMER ADVERSARIAL DELETE BLOCKED: never delete another customer', () => {
  it('scope=A + input customer_id=B fails closed and B survives', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      await seedCustomer(fixture.db, 'customer-B');
      const harness = makeWriteCountingHarness();
      const outcome = await harness.engine.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db, customer_id: 'customer-B' },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
      expect(await getCustomer('customer-B')).not.toBeNull();
      expect(await getCustomer('customer-A')).not.toBeNull();
      expect(harness.callsFor('salesAgentWriteTool:delete_customer')).toBe(0);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T21 — SECOND EXECUTION / REPLAY NO UNINTENDED EFFECTS               */
/* ================================================================== */

describe('T21 — SECOND EXECUTION / REPLAY NO UNINTENDED EFFECTS', () => {
  it('re-confirming a consumed proposal is nonce-rejected; re-invoking after delete fails closed', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      await seedCustomer(fixture.db, 'customer-B');
      await seedCustomerOwnedRecords(fixture.db, 'customer-B');

      const first = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(first.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      const p1 = getCanonicalProposal((first as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff!.proposal_id);
      await confirmViaExistingFlow(p1!);
      // 同一 nonce 重放 → 拒绝（现有 confirmation nonce 保护，与业务幂等分离）
      await expect(confirmViaExistingFlow(p1!)).rejects.toThrow(/replay/i);

      // 删除后再次 invoke 同一客户 → 交接前因"客户不存在" fail closed（无意外副作用）
      const second = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(second.status).toBe('EXECUTION_ERROR');
      if (second.status === 'EXECUTION_ERROR') {
        expect(second.error_code).toBe('INVALID_INPUT');
      }
      // B 及其记录始终完好
      expect(await getCustomer('customer-B')).not.toBeNull();
      for (const table of CASCADE_TABLES) {
        expect(await countRows(fixture.db, table, 'customer-B'), table).toBe(1);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T22 — NO FAKE ROLLBACK GUARANTEE                                    */
/* ================================================================== */

describe('T22 — NO FAKE ROLLBACK GUARANTEE: honest irreversibility, no archive/tombstone', () => {
  it('definition idempotency=NONE and the delete path truthfully denies rollback/archive/tombstone', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.delete', '1.0.0');
    expect(definition.idempotency).toBe('NONE');
    expect(definition.description).toMatch(/no rollback|no tombstone|不可逆/i);
    const manifest = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/customer/deleteManifest.ts'), 'utf8');
    expect(manifest).toMatch(/no rollback|no tombstone|不可逆/i);
  });
});

/* ================================================================== */
/* T23 — RESULT MINIMIZED                                             */
/* ================================================================== */

describe('T23 — RESULT MINIMIZED: confirmed boundary returns entity_id (customer_id) with empty fields', () => {
  it('result is { entity_id: customer_id, fields: [] }, not a raw row', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      const result = await capabilityDeletePath(fixture.db, 'customer-A');
      expect(result.entity_id).toBe('customer-A');
      expect(result.fields).toEqual([]);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T24 — OBSERVATION PRE-CONFIRM LIFECYCLE                             */
/* ================================================================== */

describe('T24 — OBSERVATION PRE-CONFIRM LIFECYCLE: STARTED → AUTHORITY_DECIDED → CONFIRMATION_REQUIRED(STRONG)', () => {
  it('customer.delete lifecycle emits three events with same invocation_id, STRONG_REQUIRED state, CUSTOMER scope', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A');
      const emitter = createInMemoryObservationEmitter();
      const bridge = createObservationBridge(emitter);
      const engine = createProductionCapabilityExecution(bridge.observer);
      const outcome = await engine.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      const events = emitter.events();
      expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
      expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
      expect(events[1].authority_decision).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(events[1].authority_reason_code).toBe('DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL');
      expect(events[2].confirmation_state).toBe('STRONG_REQUIRED');
      expect(events.every((e) => e.scope_type === 'CUSTOMER' && e.scope_id === 'customer-A')).toBe(true);
      expect(events.every((e) => e.capability_id === 'customer.delete')).toBe(true);
      expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
      // 无业务删除发生
      expect(await getCustomer('customer-A')).not.toBeNull();
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T25 — RAW CUSTOMER PAYLOAD NOT LOGGED                               */
/* ================================================================== */

describe('T25 — RAW CUSTOMER PAYLOAD NOT LOGGED: Observation remains payload-minimal', () => {
  it('events carry no customer name / phone / notes / wechat', async () => {
    const fixture = openEmptyFixture();
    await fixture.initialize();
    __setDbInstanceForTests(fixture.db);
    try {
      await seedCustomer(fixture.db, 'customer-A', '载荷最小化客户');
      const emitter = createInMemoryObservationEmitter();
      const bridge = createObservationBridge(emitter);
      const engine = createProductionCapabilityExecution(bridge.observer);
      await engine.invoke({
        capability_id: 'customer.delete',
        capability_version: '1.0.0',
        input: { db: fixture.db },
        scope: { customer_id: 'customer-A' },
      });
      const serialized = JSON.stringify(emitter.events());
      expect(serialized).not.toContain('载荷最小化客户');
      expect(serialized).not.toContain('wang@example.com');
      expect(serialized).not.toContain('原始备注');
      for (const event of emitter.events()) {
        expect(Object.keys(event).sort()).toEqual([
          'authority_decision', 'authority_reason_code', 'capability_id', 'capability_version',
          'confirmation_required', 'confirmation_state', 'error_code', 'event_id', 'event_type',
          'executor_ref', 'invocation_id', 'result_status', 'scope_id', 'scope_type', 'timestamp',
        ]);
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

/* ================================================================== */
/* T26 — W4-1 customer.create UNCHANGED                                */
/* ================================================================== */

describe('T26 — W4-1 customer.create UNCHANGED', () => {
  it('customer.create still exists with frozen WRITE metadata and REQUIRE_CONFIRMATION decision', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.create', '1.0.0');
    expect(definition.effect).toBe('WRITE');
    expect(definition.scope_requirement).toBe('NONE');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:create_customer');
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
  });
});

/* ================================================================== */
/* T27 — W4-2 profile.update UNCHANGED                                 */
/* ================================================================== */

describe('T27 — W4-2 profile.update UNCHANGED', () => {
  it('customer.profile.update still exists with frozen WRITE metadata and REQUIRE_CONFIRMATION decision', () => {
    const definition = PRODUCTION_CAPABILITY_REGISTRY.get('customer.profile.update', '1.0.0');
    expect(definition.effect).toBe('WRITE');
    expect(definition.scope_requirement).toBe('CUSTOMER');
    expect(definition.executor_ref).toBe('salesAgentWriteTool:update_customer_profile');
    const decision = evaluateAuthorityPolicy(definition);
    expect(decision.decision).toBe('REQUIRE_CONFIRMATION');
    expect(decision.reason_code).toBe('EXPLICIT_CONFIRMATION_REQUIRED');
  });
});

/* ================================================================== */
/* T28 — visit.create / import.execute ABSENT                          */
/* ================================================================== */

describe('T28 — visit.create / import.execute ABSENT', () => {
  it('neither identity is registered', () => {
    expect(PRODUCTION_CAPABILITY_IDS).not.toContain('visit.create');
    expect(PRODUCTION_CAPABILITY_IDS).not.toContain('import.execute');
  });
});

/* ================================================================== */
/* T29 — NO GENERIC customer.update                                    */
/* ================================================================== */

describe('T29 — NO GENERIC customer.update', () => {
  it('customer.update / customer.state.update remain absent', () => {
    expect(PRODUCTION_CAPABILITY_IDS).not.toContain('customer.update');
    expect(PRODUCTION_CAPABILITY_IDS).not.toContain('customer.state.update');
  });
});

/* ================================================================== */
/* T30 — NO V0.3 LEAKAGE                                               */
/* ================================================================== */

describe('T30 — NO V0.3 LEAKAGE: delete path has no planner / agent-loop / model machinery', () => {
  it('evidence domain still contributes zero capabilities', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    expect(PRODUCTION_CAPABILITY_IDS.some((id) => id.startsWith('evidence'))).toBe(false);
  });

  it('delete manifest + boundary delete branch contain no planner / Agent-loop / model / provider machinery', () => {
    const files = [
      'src/lib/capabilities/customer/deleteManifest.ts',
      'src/lib/salesAgentTools/approvedCrmWriteBoundary.ts',
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

describe('§30 — REAL PRODUCT GOLDEN PATH PARITY: human db.deleteCustomer (A) vs confirmed customer.delete capability (B)', () => {
  it('both paths remove the same product-owned records and preserve unrelated customer B', async () => {
    // A：人工产品删除路径（CustomerDetail handleDelete → db.deleteCustomer）
    const fixtureA = openEmptyFixture();
    await fixtureA.initialize();
    __setDbInstanceForTests(fixtureA.db);
    await seedCustomer(fixtureA.db, 'customer-A');
    await seedCustomer(fixtureA.db, 'customer-B');
    await seedCustomerOwnedRecords(fixtureA.db, 'customer-A');
    await seedCustomerOwnedRecords(fixtureA.db, 'customer-B');
    await deleteCustomer('customer-A');
    const humanState = {
      aCustomer: await getCustomer('customer-A'),
      bCustomer: await getCustomer('customer-B'),
      aRecords: await Promise.all(CASCADE_TABLES.map(async (t) => [t, await countRows(fixtureA.db, t, 'customer-A')] as const)),
      bRecords: await Promise.all(CASCADE_TABLES.map(async (t) => [t, await countRows(fixtureA.db, t, 'customer-B')] as const)),
    };
    __setDbInstanceForTests(null);
    fixtureA.close();

    // B：强确认后的 customer.delete 能力路径
    const fixtureB = openEmptyFixture();
    await fixtureB.initialize();
    __setDbInstanceForTests(fixtureB.db);
    await seedCustomer(fixtureB.db, 'customer-A');
    await seedCustomer(fixtureB.db, 'customer-B');
    await seedCustomerOwnedRecords(fixtureB.db, 'customer-A');
    await seedCustomerOwnedRecords(fixtureB.db, 'customer-B');
    await capabilityDeletePath(fixtureB.db, 'customer-A');
    const capabilityState = {
      aCustomer: await getCustomer('customer-A'),
      bCustomer: await getCustomer('customer-B'),
      aRecords: await Promise.all(CASCADE_TABLES.map(async (t) => [t, await countRows(fixtureB.db, t, 'customer-A')] as const)),
      bRecords: await Promise.all(CASCADE_TABLES.map(async (t) => [t, await countRows(fixtureB.db, t, 'customer-B')] as const)),
    };
    __setDbInstanceForTests(null);
    fixtureB.close();

    // 客户 A 消失、客户 B 存活（两路径一致）
    expect(humanState.aCustomer).toBeNull();
    expect(capabilityState.aCustomer).toBeNull();
    expect(humanState.bCustomer).not.toBeNull();
    expect(capabilityState.bCustomer).not.toBeNull();

    // A 的 7 个产品级联表记录被移除（两路径一致）
    for (const [table, n] of humanState.aRecords) {
      expect(n, `human A ${table}`).toBe(0);
    }
    for (const [table, n] of capabilityState.aRecords) {
      expect(n, `capability A ${table}`).toBe(0);
    }
    // B 的 7 个产品级联表记录完整保留（两路径一致）
    for (const [table, n] of humanState.bRecords) {
      expect(n, `human B ${table}`).toBe(1);
    }
    for (const [table, n] of capabilityState.bRecords) {
      expect(n, `capability B ${table}`).toBe(1);
    }
    // 能力路径与人工路径的级联行为逐表一致（PARITY）
    expect(capabilityState.aRecords).toEqual(humanState.aRecords);
    expect(capabilityState.bRecords).toEqual(humanState.bRecords);
  });
});
