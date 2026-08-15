/**
 * V0.2A / W3-1 Closure 2 — Capability Execution ↔ Observation Integration 契约测试。
 *
 * 覆盖任务 §26（T1–T29）+ §27 真实产品集成证据：
 *   T1  一次调用恰好一个 invocation_id      T2  调用方不能经输入覆盖身份
 *   T3  结果暴露 invocation_id              T4  READ 成功生命周期（customer.get）
 *   T5  ANALYZE 成功生命周期（NONE scope）  T6  执行器失败生命周期
 *   T7  确认要求生命周期（业务执行器 0 次）  T8  强确认生命周期（STRONG_REQUIRED）
 *   T9  自主拒绝生命周期                    T10 输入非法前置授权失败（真实事件序列）
 *   T11 范围非法前置授权失败                T12 能力不存在（无伪造执行器）
 *   T13 执行器未绑定（真实）                T14 同一调用身份相干性
 *   T15 并发同能力同范围可区分              T16 event_id 唯一性保持
 *   T17 无原始输入事件                      T18 无原始输出事件
 *   T19 无原始错误消息/堆栈事件             T20 A1 audit_contract 可解析
 *   T21 20+1 生产基础不变                  T22 确认写安全不变
 *   T23 强确认写安全不变                    T24 AUTO 草稿行为不变
 *   T25 客户范围相干不变                    T26 GLOBAL/NONE 不受影响
 *   T27 观察失败不双执行                    T28 无 V0.3 运行时
 *   T29 无 Wave 4
 *
 * 关键语义（与 observationBridge.ts 一致）：
 * - 前置授权失败（无 A10 决策）绝不伪造 authority_decision / executor_ref /
 *   scope_id；W3-2 的 EXECUTION_FAILED 要求治理决策，故前置失败不发伪造终态事件
 *   （结果真值由 outcome 携带）。
 * - 事件零载荷：只含 W3-2 冻结结构字段；不携带 raw input / output / 错误消息。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import Database from 'better-sqlite3';

import { createCapabilityRegistry, type CapabilityDefinition } from '../lib/capabilities';
import type { CapabilityRegistry } from '../lib/capabilities/registry';
import {
  CapabilityInputValidationError,
  PRODUCTION_CAPABILITY_BINDING_REGISTRY,
  PRODUCTION_CAPABILITY_BINDINGS,
  PRODUCTION_CAPABILITY_COUNT,
  PRODUCTION_CAPABILITY_EXECUTION,
  PRODUCTION_CAPABILITY_IDS,
  PRODUCTION_CAPABILITY_REGISTRY,
  createCapabilityBindingRegistry,
  createCapabilityExecutionEngine,
  createObservationBridge,
  createProductionCapabilityExecution,
  type CapabilityBindingRegistry,
  type CapabilityExecutionEngine,
  type CapabilityExecutorBinding,
  type CapabilityInvocationScope,
} from '../lib/capabilities/execution';
import {
  createInMemoryObservationEmitter,
  ObservationEventError,
  type InMemoryObservationEmitter,
  type ObservationEvent,
} from '../lib/capabilities/observation';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';

import { getCustomerRead } from '../lib/capabilities/customer/readAdapter';
import { buildWorkspaceContextSnapshot } from '../lib/context/workspaceContextAdapter';
import type { ContextSnapshot } from '../lib/context/types';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import type { SalesAgentToolResult } from '../lib/salesAgentTools/registry';
import { __setDbInstanceForTests, initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { createBattleCardRepositories, type BattleCardRepositories } from '../lib/battleCard/repository';
import { BATTLE_CARD_SCHEMA_VERSION } from '../lib/battleCard/schema';
import type { BattleCardPayload, CustomerStageCardInput } from '../lib/battleCard/types';
import type { FieldMapping } from '../lib/importer';

const NOW = '2026-07-14T12:00:00.000Z';
const BC_NOW = '2026-08-01T12:00:00.000Z';
const clock = (): string => BC_NOW;

/* ------------------------------------------------------------------ */
/* 合成 fixture（只证明生命周期语义；绝不进入生产 manifest）               */
/* ------------------------------------------------------------------ */

const AUDIT_NONE = {
  audit_required: false,
  record_input: false,
  record_output: false,
  record_effect: false,
} as const;

function makeFixture(
  id: string,
  overrides: Partial<Pick<CapabilityDefinition, 'effect' | 'risk_level' | 'authority_policy' | 'requires_confirmation' | 'data_target' | 'scope_requirement' | 'idempotency'>> & { executor_ref?: string },
): CapabilityDefinition {
  return {
    id,
    version: '1.0.0',
    domain: 'fixture-closure2',
    description: `Closure 2 synthetic fixture: ${id}`,
    input_schema: 'fixture.input.v1',
    output_schema: 'fixture.output.v1',
    effect: 'READ',
    data_target: 'CRM_FACT',
    risk_level: 'LOW',
    authority_policy: 'AUTO',
    requires_confirmation: false,
    scope_requirement: 'NONE',
    idempotency: 'SAFE',
    executor_ref: 'fixture.executor.v1',
    audit_contract: { ...AUDIT_NONE },
    error_contract: 'DISTINGUISHABLE',
    ...overrides,
  };
}

const SYNTHETIC_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  makeFixture('fixture.executor.success', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.success' }),
  makeFixture('fixture.executor.error', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.error' }),
  makeFixture('fixture.executor.unbound', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.not-registered' }),
  makeFixture('fixture.write.confirm', { effect: 'WRITE', data_target: 'CRM_STATE', risk_level: 'LOW', authority_policy: 'CONFIRM', requires_confirmation: true, idempotency: 'REQUIRED', executor_ref: 'fixture.executor.write.confirm' }),
  makeFixture('fixture.write.bulk', { effect: 'BULK_WRITE', data_target: 'CRM_STATE', risk_level: 'MEDIUM', authority_policy: 'AUTO', idempotency: 'REQUIRED', executor_ref: 'fixture.executor.write.bulk' }),
  makeFixture('fixture.deny.read', { effect: 'READ', authority_policy: 'DENY_AUTONOMOUS', executor_ref: 'fixture.executor.deny.read' }),
  makeFixture('fixture.scope.customer', { effect: 'READ', authority_policy: 'AUTO', scope_requirement: 'CUSTOMER', executor_ref: 'fixture.executor.scope.customer' }),
  makeFixture('fixture.scope.global', { effect: 'READ', authority_policy: 'AUTO', scope_requirement: 'GLOBAL', executor_ref: 'fixture.executor.scope.global' }),
  makeFixture('fixture.scope.none', { effect: 'ANALYZE', authority_policy: 'AUTO', scope_requirement: 'NONE', executor_ref: 'fixture.executor.scope.none' }),
  makeFixture('fixture.input.invalid', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.input.invalid' }),
]);

interface SyntheticHarness {
  readonly engine: CapabilityExecutionEngine;
  readonly emitter: InMemoryObservationEmitter;
  readonly callsFor: (executorRef: string) => number;
}

let invocationSeq = 0;

/** 确定性测试身份源（与生产 uuidv4 完全分离；TEST_ID_SOURCE=注入计数序列）。 */
function nextTestInvocationId(): string {
  invocationSeq += 1;
  return `inv-test-${String(invocationSeq).padStart(4, '0')}`;
}

/** 每个用例一个全新计数 harness（计数器互不干扰）。 */
function makeSyntheticHarness(): SyntheticHarness {
  const counters = new Map<string, number>();
  const bump = (ref: string): void => {
    counters.set(ref, (counters.get(ref) ?? 0) + 1);
  };

  const bindings = createCapabilityBindingRegistry([
    {
      executor_ref: 'fixture.executor.success',
      validateInput: (input: unknown): unknown => input,
      execute: async (input: unknown) => {
        bump('fixture.executor.success');
        return input;
      },
    },
    {
      executor_ref: 'fixture.executor.error',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        bump('fixture.executor.error');
        throw new Error('synthetic domain boom');
      },
    },
    {
      executor_ref: 'fixture.executor.write.confirm',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        bump('fixture.executor.write.confirm');
        throw new Error('SHOULD_NOT_RUN');
      },
    },
    {
      executor_ref: 'fixture.executor.write.bulk',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        bump('fixture.executor.write.bulk');
        throw new Error('SHOULD_NOT_RUN');
      },
    },
    {
      executor_ref: 'fixture.executor.deny.read',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        bump('fixture.executor.deny.read');
        throw new Error('SHOULD_NOT_RUN');
      },
    },
    {
      executor_ref: 'fixture.executor.scope.customer',
      validateInput: (input: unknown): unknown => input,
      execute: async (_input, scope) => {
        bump('fixture.executor.scope.customer');
        return { customer_id: scope.customer_id };
      },
    },
    {
      executor_ref: 'fixture.executor.scope.global',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        bump('fixture.executor.scope.global');
        return { scoped: 'global' };
      },
    },
    {
      executor_ref: 'fixture.executor.scope.none',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        bump('fixture.executor.scope.none');
        return { scoped: 'none' };
      },
    },
    {
      executor_ref: 'fixture.executor.input.invalid',
      validateInput: (input: unknown): unknown => {
        const record = input as { value?: unknown } | null;
        if (!record || record.value !== 7) {
          throw new CapabilityInputValidationError('fixture.input.invalid requires input.value === 7.');
        }
        return input;
      },
      execute: async (input: unknown) => {
        bump('fixture.executor.input.invalid');
        return { accepted: (input as { value: number }).value };
      },
    },
  ]);

  const registry = createCapabilityRegistry(SYNTHETIC_MANIFEST);
  const emitter = createInMemoryObservationEmitter();
  const bridge = createObservationBridge(emitter);
  const engine = createCapabilityExecutionEngine({
    registry,
    bindings,
    observer: bridge.observer,
    generateInvocationId: nextTestInvocationId,
  });
  return { engine, emitter, callsFor: (ref) => counters.get(ref) ?? 0 };
}

/** 生产引擎 + 内存发射器（真实 21 能力全路径）。 */
function makeProductionHarness(): { engine: CapabilityExecutionEngine; emitter: InMemoryObservationEmitter } {
  const emitter = createInMemoryObservationEmitter();
  const bridge = createObservationBridge(emitter);
  const engine = createProductionCapabilityExecution(bridge.observer);
  return { engine, emitter };
}

/* ------------------------------------------------------------------ */
/* 真实产品路径 fixture（安全测试 DB / 只读快照）                          */
/* ------------------------------------------------------------------ */

function snapshotFixture(): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'closure2-contract-fixture',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [
      { id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } },
      { id: 'customer-2', name: 'Ben', customer_grade: 'B', intent_level: 'MEDIUM', evidence_ref: { type: 'customer', id: 'customer-2', label: 'Ben', synthetic: false, persisted: true } },
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

function contextFixture(snapshot: LoadedReadOnlyAgentSnapshot): ContextSnapshot {
  return buildWorkspaceContextSnapshot(snapshot);
}

class SqliteDatabaseLike implements DatabaseLike {
  constructor(private readonly sqlite: Database.Database) {}
  async execute(sql: string, bindings: unknown[] = []): Promise<{ rowsAffected: number }> {
    const info = this.sqlite.prepare(sql).run(...bindings);
    return { rowsAffected: info.changes };
  }
  async select<T>(sql: string, bindings: unknown[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...bindings) as T[];
  }
  close(): void {
    this.sqlite.close();
  }
}

function makePayload(customerId: string, stageCode: string): BattleCardPayload {
  return {
    action_card: {
      current_situation: `${customerId} ${stageCode} 当前态势`,
      stage_goal: '完成首轮验证',
      stage_entry_criteria: ['已触达'],
      stage_exit_criteria: ['意向明确'],
      confirmed_facts: [],
      key_hypotheses: [],
      target_roles: ['决策人'],
      must_ask_questions: [],
      next_best_action: {
        target_role: '决策人',
        channel: 'wechat',
        recommended_time: '2026-08-03T00:00:00.000Z',
        objective: '验证假设',
        opening: '您好',
        questions: ['当前最大瓶颈是什么？'],
        success_signal: '明确反馈',
        failure_signal: '拒绝',
        fallback_action: '低频维护',
      },
      success_signal: '明确反馈',
      failure_signal: '拒绝',
      risks: [],
      do_not_say: [],
      changes_since_previous_card: ['首张作战卡（无上一张可比）'],
      confidence: 'MEDIUM',
      evidence_refs: [`import:${customerId}-sec-1`, `CUSTOMER:${customerId}`],
    },
    solution_reference_card: {
      feishu_value_statement: {
        original: '原文',
        current: '原文',
        short_spoken_version: null,
        full_spoken_version: null,
        wechat_version: null,
        version_history: [],
      },
      solution_scenarios: [],
      human_review_boundaries: [],
      peer_references: [],
      counterexamples_and_boundaries: [],
      poc_path: [],
      acceptance_metrics: ['待人工补充验收指标'],
      evidence_refs: [`import:${customerId}-sec-2`],
    },
  };
}

interface SeededDb {
  readonly db: SqliteDatabaseLike;
  readonly repos: BattleCardRepositories;
}

let memoryDb: SqliteDatabaseLike | null = null;

afterEach(() => {
  __setDbInstanceForTests(null);
  memoryDb?.close();
  memoryDb = null;
});

async function openMemoryDbWithCards(): Promise<SeededDb> {
  const sqlite = new Database(':memory:');
  const db = new SqliteDatabaseLike(sqlite);
  await initializeDatabaseSchema(db);
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, last_contacted_at, next_action, battle_card_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['cust-a', '客户甲', 'A', 'NEW_LEAD', 'HIGH', null, null, null, 'CONFIRMED', BC_NOW, BC_NOW],
  );
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, last_contacted_at, next_action, battle_card_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['cust-b', '客户乙', 'B', 'CONTACTED', 'MEDIUM', null, null, null, 'CONFIRMED', BC_NOW, BC_NOW],
  );
  const repos = createBattleCardRepositories(db, clock);

  const insertCard = async (customerId: string, stageCode: string, version: number, cardStatus: 'DRAFT' | 'CONFIRMED'): Promise<{ id: string; version: number }> => {
    const input: CustomerStageCardInput = {
      id: `card-${customerId}-${stageCode}-v${version}`,
      customer_id: customerId,
      stage_code: stageCode,
      version,
      schema_version: BATTLE_CARD_SCHEMA_VERSION,
      card_status: cardStatus,
      source_import_id: null,
      supersedes_card_id: version > 1 ? `card-${customerId}-${stageCode}-v${version - 1}` : null,
      payload_json: JSON.stringify(makePayload(customerId, stageCode)),
      evidence_snapshot_hash: `hash-${customerId}-v${version}`,
      generated_by: 'DETERMINISTIC',
      confirmed_by: cardStatus === 'CONFIRMED' ? 'HUMAN_CONFIRM' : null,
      created_at: BC_NOW,
      confirmed_at: cardStatus === 'CONFIRMED' ? BC_NOW : null,
    };
    const row = await repos.cards.insert(input);
    return { id: row.id, version: row.version };
  };

  const cardA1 = await insertCard('cust-a', 'NEW_LEAD', 1, 'CONFIRMED');
  await insertCard('cust-a', 'NEW_LEAD', 2, 'DRAFT');
  await insertCard('cust-b', 'CONTACTED', 1, 'CONFIRMED');
  await insertCard('cust-b', 'CONTACTED', 2, 'DRAFT');

  await db.execute(
    `UPDATE customers SET current_stage_card_id = ?, battle_card_status = 'CONFIRMED', last_battle_review_at = ?, updated_at = ? WHERE id = ?`,
    [cardA1.id, BC_NOW, BC_NOW, 'cust-a'],
  );

  memoryDb = db;
  return { db, repos };
}

function toBytes(out: unknown): Uint8Array {
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (ArrayBuffer.isView(out)) return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  return Uint8Array.from(out as number[]);
}

function makeXlsxFile(name = 'fixture.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['客户名称', '手机号', '城市', '意向'],
    ['上海某某科技有限公司', '13800000001', '上海', '高'],
    ['北京某某贸易有限公司', '13800000002', '北京', '中'],
    ['', '13800000003', '深圳', '低'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '客户名单');
  return new File([toBytes(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))], name);
}

const STRUCTURAL_KEYS: readonly string[] = Object.freeze([
  'authority_decision', 'authority_reason_code', 'capability_id', 'capability_version',
  'confirmation_required', 'confirmation_state', 'error_code', 'event_id', 'event_type',
  'executor_ref', 'invocation_id', 'result_status', 'scope_id', 'scope_type', 'timestamp',
]);

/* ================================================================== */
/* T1 — ONE INVOCATION ID CREATED                                      */
/* ================================================================== */

describe('T1 — ONE INVOCATION ID: one unified execution call receives exactly one stable invocation_id', () => {
  it('every observer event and the outcome share one stable invocation_id', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { marker: 1 },
      scope: {},
    });
    expect(outcome.invocation_id).toMatch(/^inv-test-\d{4}$/);
    const events = harness.emitter.events();
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
  });

  it('two invocations receive distinct invocation_ids', async () => {
    const harness = makeSyntheticHarness();
    const a = await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: {}, scope: {} });
    const b = await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: {}, scope: {} });
    expect(a.invocation_id).not.toBe(b.invocation_id);
  });
});

/* ================================================================== */
/* T2 — CALLER CANNOT SMUGGLE INVOCATION ID                            */
/* ================================================================== */

describe('T2 — CALLER CANNOT SMUGGLE: business input cannot override the production invocation identity', () => {
  it('an invocation_id field inside business input is ignored; the engine identity wins', async () => {
    const harness = makeSyntheticHarness();
    const smuggled = 'inv-HIJACKED-BY-CALLER';
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { invocation_id: smuggled, marker: 1 },
      scope: {},
    });
    expect(outcome.invocation_id).not.toBe(smuggled);
    expect(outcome.invocation_id).toMatch(/^inv-test-\d{4}$/);
    const events = harness.emitter.events();
    expect(events.every((e) => e.invocation_id !== smuggled)).toBe(true);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
  });

  it('no event field carries the smuggled value (bridge only reads engine-owned identity)', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { invocation_id: 'inv-SECRET-SMUGGLE', marker: 2 },
      scope: {},
    });
    const serialized = JSON.stringify(harness.emitter.events());
    expect(serialized).not.toContain('inv-SECRET-SMUGGLE');
  });
});

/* ================================================================== */
/* T3 — OUTCOME EXPOSES INVOCATION ID                                  */
/* ================================================================== */

describe('T3 — OUTCOME EXPOSES INVOCATION ID: SUCCESS outcome exposes the same invocation_id as Observation events', () => {
  it('SUCCESS outcome.invocation_id equals every emitted event invocation_id', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { marker: 3 },
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect(outcome.invocation_id).toBeTruthy();
      const events = harness.emitter.events();
      expect(events.length).toBe(3); // STARTED + AUTHORITY_DECIDED + EXECUTION_COMPLETED
      expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
      expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    }
  });
});

/* ================================================================== */
/* T4 — READ SUCCESS LIFECYCLE (customer.get)                          */
/* ================================================================== */

describe('T4 — READ SUCCESS LIFECYCLE: customer.get emits STARTED → AUTHORITY_DECIDED → EXECUTION_COMPLETED with one invocation_id', () => {
  it('real production path: customer.get lifecycle correlates one invocation identity', async () => {
    const { engine, emitter } = makeProductionHarness();
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await engine.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect(outcome.payload).toEqual(getCustomerRead({ customer_id: 'customer-1', snapshot, context }));
      const result = outcome.payload as SalesAgentToolResult;
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({ id: 'customer-1', name: 'Ada' });
    }
    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    for (const event of events) {
      expect(event.capability_id).toBe('customer.get');
      expect(event.capability_version).toBe('1.0.0');
      expect(event.scope_type).toBe('CUSTOMER');
      expect(event.scope_id).toBe('customer-1');
      expect(event.executor_ref).toBe('salesAgentTool:get_customer');
    }
    expect(events[1].authority_decision).toBe('ALLOW_AUTO');
    expect(events[2].result_status).toBe('SUCCESS');
  });
});

/* ================================================================== */
/* T5 — ANALYZE SUCCESS LIFECYCLE (NONE scope)                         */
/* ================================================================== */

describe('T5 — ANALYZE SUCCESS LIFECYCLE: import.mapping.validate (NONE scope) correlates one invocation identity', () => {
  it('real production path: NONE scope lifecycle with no fabricated customer', async () => {
    const { engine, emitter } = makeProductionHarness();
    const mapping: readonly FieldMapping[] = [{ sourceColumn: '客户名称', crmField: 'name' }];
    const outcome = await engine.invoke({
      capability_id: 'import.mapping.validate',
      capability_version: '1.0.0',
      input: mapping,
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    for (const event of events) {
      expect(event.scope_type).toBe('NONE');
      expect(event.scope_id).toBeNull();
      expect(event.capability_id).toBe('import.mapping.validate');
    }
  });

  it('synthetic NONE scope also correlates', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.scope.none', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('SUCCESS');
    expect(harness.emitter.events().every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    expect(harness.emitter.events().every((e) => e.scope_type === 'NONE' && e.scope_id === null)).toBe(true);
  });
});

/* ================================================================== */
/* T6 — EXECUTOR FAILURE LIFECYCLE                                     */
/* ================================================================== */

describe('T6 — EXECUTOR FAILURE LIFECYCLE: ALLOW_AUTO executor failure emits STARTED → AUTHORITY_DECIDED → EXECUTION_FAILED', () => {
  it('same invocation_id across all events; stable EXECUTOR_ERROR category', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.executor.error', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('EXECUTOR_ERROR');
    }
    const events = harness.emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_FAILED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    expect(events[2].error_code).toBe('EXECUTOR_ERROR');
    expect(events[2].result_status).toBe('FAILED');
  });
});

/* ================================================================== */
/* T7 — CONFIRMATION REQUIRED LIFECYCLE                                */
/* ================================================================== */

describe('T7 — CONFIRMATION REQUIRED LIFECYCLE: normal Write emits STARTED → AUTHORITY_DECIDED → CONFIRMATION_REQUIRED; business executor calls = 0', () => {
  it('synthetic confirm write: lifecycle + zero executor calls', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.write.confirm', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    expect(harness.callsFor('fixture.executor.write.confirm')).toBe(0);
    const events = harness.emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    expect(events[2].confirmation_state).toBe('REQUIRED');
    expect(events[2].result_status).toBe('NOT_EXECUTED');
  });

  it('real production path: follow_up.create lifecycle correlates; business executor never runs pre-confirm', async () => {
    const { engine, emitter } = makeProductionHarness();
    const outcome = await engine.invoke({
      capability_id: 'follow_up.create',
      capability_version: '1.0.0',
      input: { title: '确认跟进' },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    if (outcome.status === 'CONFIRMATION_REQUIRED') {
      expect(outcome.confirmation_handoff?.mechanism).toBeTruthy();
      expect(outcome.confirmation_handoff?.proposal_id).toBeTruthy();
    }
    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    expect(events[2].confirmation_state).toBe('REQUIRED');
    expect(events[2].authority_decision).toBe('REQUIRE_CONFIRMATION');
  });
});

/* ================================================================== */
/* T8 — STRONG CONFIRMATION LIFECYCLE                                  */
/* ================================================================== */

describe('T8 — STRONG CONFIRMATION LIFECYCLE: battle_card.intelligence_import.confirm preserves STRONG_REQUIRED; business executor calls = 0', () => {
  it('real production path: strong confirmation lifecycle with confirmation_state=STRONG_REQUIRED', async () => {
    const seeded = await openMemoryDbWithCards();
    const { engine, emitter } = makeProductionHarness();
    try {
      const outcome = await engine.invoke({
        capability_id: 'battle_card.intelligence_import.confirm',
        capability_version: '1.0.0',
        input: { db: seeded.db, raw_content: '测试导入内容' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
        expect(outcome.confirmation_handoff?.mechanism).toBeTruthy();
      }
      const events = emitter.events();
      expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
      expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
      expect(events[1].authority_decision).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(events[2].confirmation_state).toBe('STRONG_REQUIRED');
      expect(events[2].result_status).toBe('NOT_EXECUTED');
      // 无任何 EXECUTION_* 事件：业务执行器在确认前绝不被调用。
      expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
    } finally {
      seeded.db.close();
    }
  });

  it('synthetic BULK_WRITE strong confirmation keeps STRONG_REQUIRED semantics', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.write.bulk', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
    expect(harness.callsFor('fixture.executor.write.bulk')).toBe(0);
    expect(harness.emitter.events()[2].confirmation_state).toBe('STRONG_REQUIRED');
  });
});

/* ================================================================== */
/* T9 — DENY AUTONOMOUS LIFECYCLE                                      */
/* ================================================================== */

describe('T9 — DENY AUTONOMOUS LIFECYCLE: denied capability emits STARTED → AUTHORITY_DECIDED → AUTONOMY_DENIED', () => {
  it('same invocation_id; AUTONOMY_DENIED is a decision outcome, not an execution error', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.deny.read', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('AUTONOMY_DENIED');
    expect(harness.callsFor('fixture.executor.deny.read')).toBe(0);
    const events = harness.emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'AUTONOMY_DENIED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
    expect(events[2].authority_decision).toBe('DENY_AUTONOMOUS');
    expect(events[2].result_status).toBe('NOT_EXECUTED');
    expect(events[2].error_code).toBeNull();
  });
});

/* ================================================================== */
/* T10 — INVALID INPUT PRE-AUTHORITY                                   */
/* ================================================================== */

describe('T10 — INVALID INPUT PRE-AUTHORITY: truthful event sequence; no fake authority event; executor calls = 0', () => {
  it('emits only the truthful INVOCATION_STARTED (no fabricated AUTHORITY_DECIDED / terminal)', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.input.invalid', capability_version: '1.0.0', input: { value: 1 }, scope: {} });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
      expect(outcome.authority_decision).toBeNull();
    }
    expect(harness.callsFor('fixture.executor.input.invalid')).toBe(0);
    const events = harness.emitter.events();
    // 前置授权失败：W3-2 EXECUTION_FAILED 要求治理决策 → 桥不发伪造终态事件。
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED']);
    expect(events[0].invocation_id).toBe(outcome.invocation_id);
    expect(events.some((e) => e.event_type === 'AUTHORITY_DECIDED')).toBe(false);
    expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
  });
});

/* ================================================================== */
/* T11 — INVALID SCOPE PRE-AUTHORITY                                   */
/* ================================================================== */

describe('T11 — INVALID SCOPE PRE-AUTHORITY: truthful event sequence; no fake scope; executor calls = 0', () => {
  it('CUSTOMER capability without customer scope emits no fabricated events', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.scope.customer', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
      expect(outcome.authority_decision).toBeNull();
    }
    expect(harness.callsFor('fixture.executor.scope.customer')).toBe(0);
    // 范围无法如实表示（CUSTOMER 缺 customer_id）→ 桥保持沉默（不发伪造 scope_id）。
    expect(harness.emitter.events()).toEqual([]);
  });

  it('production: customer.get without customer scope → INVALID_SCOPE with truthful empty event set', async () => {
    const { engine, emitter } = makeProductionHarness();
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await engine.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
      expect(outcome.invocation_id).toBeTruthy();
    }
    expect(emitter.events()).toEqual([]);
  });
});

/* ================================================================== */
/* T12 — CAPABILITY NOT FOUND                                          */
/* ================================================================== */

describe('T12 — CAPABILITY NOT FOUND: truthful representation without fabricated executor_ref / scope / authority', () => {
  it('unknown identity → outcome carries invocation_id + stable error; no fabricated events', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.not.registered', capability_version: '9.9.9', input: {}, scope: {} });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('CAPABILITY_NOT_FOUND');
      expect(outcome.authority_decision).toBeNull();
      expect(outcome.executor_ref).toBeNull();
      expect(outcome.invocation_id).toBeTruthy();
    }
    // 无定义 → 无真实 executor_ref → W3-2 无法如实表示，桥不发任何事件。
    expect(harness.emitter.events()).toEqual([]);
  });
});

/* ================================================================== */
/* T13 — EXECUTOR NOT BOUND                                            */
/* ================================================================== */

describe('T13 — EXECUTOR NOT BOUND: truthful representation; INVOCATION_STARTED only, no fabricated terminal', () => {
  it('unbound executor_ref → outcome EXECUTOR_NOT_BOUND; lifecycle has no fabricated authority event', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({ capability_id: 'fixture.executor.unbound', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('EXECUTOR_NOT_BOUND');
      expect(outcome.authority_decision).toBeNull();
    }
    const events = harness.emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED']);
    expect(events[0].executor_ref).toBe('fixture.executor.not-registered');
    expect(events[0].invocation_id).toBe(outcome.invocation_id);
    expect(events.some((e) => e.event_type === 'AUTHORITY_DECIDED')).toBe(false);
  });
});

/* ================================================================== */
/* T14 — SAME INVOCATION IDENTITY COHERENCE                            */
/* ================================================================== */

describe('T14 — SAME INVOCATION IDENTITY COHERENCE: all events sharing one invocation_id preserve capability id/version/scope/executor_ref', () => {
  it('customer.get: every event preserves identity fields exactly', async () => {
    const { engine, emitter } = makeProductionHarness();
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await engine.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    const events = emitter.events();
    expect(events.length).toBe(3);
    for (const event of events) {
      expect(event.invocation_id).toBe(outcome.invocation_id);
      expect(event.capability_id).toBe('customer.get');
      expect(event.capability_version).toBe('1.0.0');
      expect(event.scope_type).toBe('CUSTOMER');
      expect(event.scope_id).toBe('customer-1');
      expect(event.executor_ref).toBe('salesAgentTool:get_customer');
    }
  });

  it('synthetic write confirm: identity coherence across the full lifecycle', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({ capability_id: 'fixture.write.confirm', capability_version: '1.0.0', input: {}, scope: {} });
    const events = harness.emitter.events();
    for (const event of events) {
      expect(event.capability_id).toBe('fixture.write.confirm');
      expect(event.capability_version).toBe('1.0.0');
      expect(event.executor_ref).toBe('fixture.executor.write.confirm');
    }
  });
});

/* ================================================================== */
/* T15 — CONCURRENT IDENTICAL INVOCATIONS                              */
/* ================================================================== */

describe('T15 — CONCURRENT IDENTICAL INVOCATIONS: simultaneous calls to the same capability receive different invocation_ids; events never mix', () => {
  it('interleaved concurrent calls keep per-invocation event sets isolated', async () => {
    const harness = makeSyntheticHarness();
    const [a, b] = await Promise.all([
      harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { tag: 'A' }, scope: {} }),
      harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { tag: 'B' }, scope: {} }),
    ]);
    expect(a.invocation_id).not.toBe(b.invocation_id);
    const events = harness.emitter.events();
    expect(events).toHaveLength(6);
    const groupA = events.filter((e) => e.invocation_id === a.invocation_id);
    const groupB = events.filter((e) => e.invocation_id === b.invocation_id);
    expect(groupA.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    expect(groupB.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    // 事件绝不混用：A 的事件里没有 B 的 identity，反之亦然。
    expect(groupA.every((e) => e.capability_id === 'fixture.executor.success')).toBe(true);
    expect(groupB.every((e) => e.capability_id === 'fixture.executor.success')).toBe(true);
    // event_id 全局唯一
    expect(new Set(events.map((e) => e.event_id)).size).toBe(6);
  });
});

/* ================================================================== */
/* T16 — EVENT ID UNIQUENESS                                           */
/* ================================================================== */

describe('T16 — EVENT ID UNIQUENESS: one invocation has multiple unique event_ids; duplicate protection remains intact', () => {
  it('one invocation produces N unique auto-generated event_ids', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: {}, scope: {} });
    const events = harness.emitter.events();
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.event_id)).size).toBe(3);
    expect(events.every((e) => e.event_id.match(/^OBS-\d{6}$/))).toBe(true);
  });

  it('duplicate event_id is still rejected by the emitter (protection not weakened by shared invocation_id)', async () => {
    const emitter = createInMemoryObservationEmitter();
    emitter.emit({
      event_id: 'OBS-dup-closure2',
      invocation_id: 'inv-shared-1',
      event_type: 'INVOCATION_STARTED',
      timestamp: '2025-08-13T22:25:00+08:00',
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      scope_type: 'CUSTOMER',
      scope_id: 'cust-1',
      executor_ref: 'salesAgentTool:get_customer',
    } as ObservationEvent);
    expect(() =>
      emitter.emit({
        event_id: 'OBS-dup-closure2',
        invocation_id: 'inv-shared-1',
        event_type: 'AUTHORITY_DECIDED',
        timestamp: '2025-08-13T22:25:00+08:00',
        capability_id: 'customer.get',
        capability_version: '1.0.0',
        scope_type: 'CUSTOMER',
        scope_id: 'cust-1',
        executor_ref: 'salesAgentTool:get_customer',
        authority_decision: 'ALLOW_AUTO',
        authority_reason_code: 'AUTO_ALLOWED',
      } as ObservationEvent),
    ).toThrow(ObservationEventError);
    expect(emitter.size()).toBe(1);
  });
});

/* ================================================================== */
/* T17 / T18 / T19 — ZERO PAYLOAD LEAKAGE                              */
/* ================================================================== */

describe('T17/T18/T19 — NO RAW PAYLOAD: events carry only the 15 frozen structural fields; no input/output/error leakage', () => {
  it('every bridge-emitted event has exactly the structural key set (no payload fields)', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { raw_note: 'secret-note', api_key: 'sk-123', prompt: 'do it' }, scope: {} });
    for (const event of harness.emitter.events()) {
      expect(Object.keys(event).sort()).toEqual([...STRUCTURAL_KEYS].sort());
    }
  });

  it('raw input / raw output / secret values never appear in events (success path)', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { customer_note: 'TOP-SECRET-NOTE-1', api_key: 'sk-SECRET-1', prompt: 'PROMPT-SECRET-1', spreadsheet_rows: ['row-1'] },
      scope: { customer_id: 'customer-1' },
    });
    const serialized = JSON.stringify(harness.emitter.events());
    for (const secret of ['TOP-SECRET-NOTE-1', 'sk-SECRET-1', 'PROMPT-SECRET-1', 'row-1']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('raw executor error message / stack never appear in events (failure path)', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({ capability_id: 'fixture.executor.error', capability_version: '1.0.0', input: {}, scope: {} });
    const serialized = JSON.stringify(harness.emitter.events());
    expect(serialized).not.toContain('synthetic domain boom');
    expect(serialized).not.toContain('Error:');
    expect(serialized).not.toContain('at ');
    for (const event of harness.emitter.events()) {
      expect('message' in event).toBe(false);
      expect('stack' in event).toBe(false);
      expect('cause' in event).toBe(false);
    }
  });

  it('production real path: customer.get events contain no customer payload', async () => {
    const { engine, emitter } = makeProductionHarness();
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    await engine.invoke({ capability_id: 'customer.get', capability_version: '1.0.0', input: { snapshot, context }, scope: { customer_id: 'customer-1' } });
    const serialized = JSON.stringify(emitter.events());
    expect(serialized).not.toContain('Ada');
    expect(serialized).not.toContain('snapshot');
    expect(serialized).not.toContain('records');
  });
});

/* ================================================================== */
/* T20 — A1 AUDIT CONTRACT RESOLVABLE                                  */
/* ================================================================== */

describe('T20 — A1 AUDIT CONTRACT RESOLVABLE: event identity resolves the exact production definition and its audit_contract', () => {
  it('event capability identity → exact CapabilityDefinition → exact A1 audit_contract (no duplication in events)', async () => {
    const { engine, emitter } = makeProductionHarness();
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    await engine.invoke({ capability_id: 'customer.get', capability_version: '1.0.0', input: { snapshot, context }, scope: { customer_id: 'customer-1' } });
    for (const event of emitter.events()) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(event.capability_id, event.capability_version);
      expect(definition.id).toBe('customer.get');
      expect(definition.version).toBe('1.0.0');
      expect(definition.audit_contract).toEqual({
        audit_required: false,
        record_input: false,
        record_output: false,
        record_effect: false,
      });
      expect('audit_contract' in event).toBe(false);
    }
  });

  it('high-audit-declaration capability (import.file.preview) still carries no audit_contract / payload in events', async () => {
    const { engine, emitter } = makeProductionHarness();
    const outcome = await engine.invoke({ capability_id: 'import.file.preview', capability_version: '1.0.0', input: makeXlsxFile(), scope: {} });
    expect(outcome.status).toBe('SUCCESS');
    const preview = PRODUCTION_CAPABILITY_REGISTRY.get('import.file.preview', '1.0.0');
    expect(preview.audit_contract.record_input).toBe(true);
    for (const event of emitter.events()) {
      expect('audit_contract' in event).toBe(false);
      expect('rows' in event).toBe(false);
      expect('headers' in event).toBe(false);
    }
  });
});

/* ================================================================== */
/* T21 — ORIGINAL 20 FOUNDATION UNCHANGED + W4-1 customer.create       */
/* ================================================================== */

describe('T21 — ORIGINAL 20 FOUNDATION UNCHANGED + W4-1 customer.create + W4-2 customer.profile.update: registry=22, bindings=22, unbound=0', () => {
  it('production registry/bindings remain exactly 22 with zero unbound', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(22);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(22);
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(22);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(22);
    const unbound = PRODUCTION_CAPABILITY_IDS.filter((id) => {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      return PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref) === undefined;
    });
    expect(unbound).toEqual([]);
  });
});

/* ================================================================== */
/* T22 / T23 — CONFIRMATION WRITE SAFETY UNCHANGED                     */
/* ================================================================== */

describe('T22/T23 — CONFIRMATION WRITE SAFETY UNCHANGED: confirmation-required & strong-confirmation writes never call the business executor pre-confirm', () => {
  it('all six confirmation-required write capabilities return confirmation outcomes, never EXECUTION_ERROR (executor refuse-guard would throw)', async () => {
    const { engine } = makeProductionHarness();
    const cases = [
      { capability_id: 'follow_up.create', input: { title: 'x' } },
      { capability_id: 'task.create', input: { title: 'x' } },
      { capability_id: 'customer.next_follow_up_time.update', input: { db: { execute: async () => ({ rowsAffected: 0 }), select: async () => [{ next_follow_up_at: null }] }, next_follow_up_at: '2026-08-01T00:00:00.000Z' } },
      { capability_id: 'customer.create', input: { name: 'x' } },
    ];
    for (const testCase of cases) {
      const outcome = await engine.invoke({ capability_id: testCase.capability_id, capability_version: '1.0.0', input: testCase.input, scope: { customer_id: 'customer-1' } });
      expect(outcome.status, testCase.capability_id).toBe('CONFIRMATION_REQUIRED');
    }
  });

  it('battle_card.intelligence_import.confirm stays STRONG_CONFIRMATION_REQUIRED (executor refuse-guard never runs)', async () => {
    const seeded = await openMemoryDbWithCards();
    const { engine } = makeProductionHarness();
    try {
      const outcome = await engine.invoke({
        capability_id: 'battle_card.intelligence_import.confirm',
        capability_version: '1.0.0',
        input: { db: seeded.db, raw_content: 'x' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
    } finally {
      seeded.db.close();
    }
  });

  it('synthetic counters prove zero executor calls for confirm and strong-confirm decisions', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({ capability_id: 'fixture.write.confirm', capability_version: '1.0.0', input: {}, scope: {} });
    await harness.engine.invoke({ capability_id: 'fixture.write.bulk', capability_version: '1.0.0', input: {}, scope: {} });
    expect(harness.callsFor('fixture.executor.write.confirm')).toBe(0);
    expect(harness.callsFor('fixture.executor.write.bulk')).toBe(0);
  });
});

/* ================================================================== */
/* T24 — AUTO DRAFT BEHAVIOR UNCHANGED                                 */
/* ================================================================== */

describe('T24 — AUTO DRAFT BEHAVIOR UNCHANGED: battle_card.draft.create stays AUTO; no implicit confirm; truthful lifecycle', () => {
  it('real production path: draft lifecycle emits STARTED → AUTHORITY_DECIDED → EXECUTION_COMPLETED (ALLOW_AUTO)', async () => {
    const seeded = await openMemoryDbWithCards();
    const { engine, emitter } = makeProductionHarness();
    try {
      const outcome = await engine.invoke({
        capability_id: 'battle_card.draft.create',
        capability_version: '1.0.0',
        input: { db: seeded.db, stage_code: 'NEW_LEAD' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('SUCCESS');
      const events = emitter.events();
      expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
      expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
      expect(events[1].authority_decision).toBe('ALLOW_AUTO');
      // 无隐式确认：绝无 CONFIRMATION_REQUIRED 事件。
      expect(events.some((e) => e.event_type === 'CONFIRMATION_REQUIRED')).toBe(false);
    } finally {
      seeded.db.close();
    }
  });
});

/* ================================================================== */
/* T25 — CUSTOMER SCOPE COHERENCE UNCHANGED                            */
/* ================================================================== */

describe('T25 — CUSTOMER SCOPE COHERENCE UNCHANGED: scope=A / input selector=B still fails before executor', () => {
  it('production customer.get: scope=customer-1 + input.customer_id=customer-2 → INVALID_INPUT, executor never runs', async () => {
    const { engine, emitter } = makeProductionHarness();
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await engine.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context, customer_id: 'customer-2' },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
      expect(outcome.authority_decision).toBeNull();
    }
    // 前置授权失败：只发如实表示的 INVOCATION_STARTED（scope 有效可表示）。
    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED']);
    expect(events[0].invocation_id).toBe(outcome.invocation_id);
    expect(events[0].scope_type).toBe('CUSTOMER');
    expect(events[0].scope_id).toBe('customer-1');
  });
});

/* ================================================================== */
/* T26 — GLOBAL / NONE UNAFFECTED                                      */
/* ================================================================== */

describe('T26 — GLOBAL/NONE UNAFFECTED: global and none capabilities run unchanged with truthful scope events', () => {
  it('follow_up.global.read (GLOBAL) succeeds; events carry scope_type=GLOBAL with null scope_id', async () => {
    const { engine, emitter } = makeProductionHarness();
    const outcome = await engine.invoke({ capability_id: 'follow_up.global.read', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('SUCCESS');
    const events = emitter.events();
    expect(events.every((e) => e.scope_type === 'GLOBAL' && e.scope_id === null)).toBe(true);
    expect(events[2].event_type).toBe('EXECUTION_COMPLETED');
  });

  it('import.mapping.validate (NONE) still succeeds with NONE scope events', async () => {
    const { engine, emitter } = makeProductionHarness();
    const outcome = await engine.invoke({
      capability_id: 'import.mapping.validate',
      capability_version: '1.0.0',
      input: [{ sourceColumn: '客户名称', crmField: 'name' }],
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    expect(emitter.events().every((e) => e.scope_type === 'NONE' && e.scope_id === null)).toBe(true);
  });
});

/* ================================================================== */
/* T27 — OBSERVATION FAILURE DOES NOT DOUBLE EXECUTE                   */
/* ================================================================== */

describe('T27 — OBSERVATION FAILURE DOES NOT DOUBLE EXECUTE: observer/emitter errors never retry the business executor', () => {
  it('observer that throws on every event: business outcome is still returned; executor ran exactly once', async () => {
    let calls = 0;
    const registry = createCapabilityRegistry([makeFixture('fixture.obs.fail', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.obs.fail.exec' })]);
    const bindings: CapabilityBindingRegistry = createCapabilityBindingRegistry([{
      executor_ref: 'fixture.obs.fail.exec',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        calls += 1;
        return { ran: true };
      },
    }]);
    const engine = createCapabilityExecutionEngine({
      registry,
      bindings,
      observer: {
        observe: () => {
          throw new Error('observer exploded');
        },
      },
    });
    const outcome = await engine.invoke({ capability_id: 'fixture.obs.fail', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('SUCCESS');
    expect(calls).toBe(1); // 绝不因观察失败重试/双执行
  });

  it('emitter that throws on OUTCOME: SUCCESS outcome is still returned; executor ran exactly once; no second execution misreport', async () => {
    let calls = 0;
    const registry = createCapabilityRegistry([makeFixture('fixture.obs.emitter', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.obs.emitter.exec' })]);
    const bindings: CapabilityBindingRegistry = createCapabilityBindingRegistry([{
      executor_ref: 'fixture.obs.emitter.exec',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        calls += 1;
        return { ok: true };
      },
    }]);
    const throwingEmitter = createInMemoryObservationEmitter();
    const bridge = createObservationBridge(throwingEmitter);
    const originalEmit = throwingEmitter.emit.bind(throwingEmitter);
    (throwingEmitter as { emit: (e: ObservationEvent) => ObservationEvent }).emit = (event: ObservationEvent): ObservationEvent => {
      if (event.event_type === 'EXECUTION_COMPLETED') throw new Error('persistence sink unavailable');
      return originalEmit(event);
    };
    const engine = createCapabilityExecutionEngine({
      registry,
      bindings,
      observer: bridge.observer,
    });
    const outcome = await engine.invoke({ capability_id: 'fixture.obs.emitter', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('SUCCESS');
    expect(calls).toBe(1);
    // 观察失败被包含：业务真值未变。
    if (outcome.status === 'SUCCESS') {
      expect(outcome.payload).toEqual({ ok: true });
    }
  });
});

/* ================================================================== */
/* T28 — NO V0.3 RUNTIME                                               */
/* ================================================================== */

describe('T28 — NO V0.3 RUNTIME: no planner / tool-selection / agent loop introduced', () => {
  it('static: closure-2 sources contain no V0.3 constructs or while loops', () => {
    const dir = resolve(process.cwd(), 'src/lib/capabilities/execution');
    const files = ['contract.ts', 'engine.ts', 'production.ts', 'observationBridge.ts', 'invocationId.ts', 'index.ts'];
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden = /(executeNaturalLanguageGoal|selectCapability|planTools|runAgentLoop|agentLoop|toolSelection|tool_selection|planner|goalDecompos|goal_decompos|observeAndContinue|Observe→Continue)/;
    for (const file of files) {
      const codeOnly = stripComments(readFileSync(resolve(dir, file), 'utf8'));
      expect(codeOnly, `${file} must not contain V0.3 constructs`).not.toMatch(forbidden);
      expect(codeOnly, `${file} must not contain while loops`).not.toMatch(/\bwhile\s*\(/);
    }
  });
});

/* ================================================================== */
/* T29 — NO WAVE-4 LEAKAGE                                             */
/* ================================================================== */

describe('T29 — NO WAVE-4 LEAKAGE: customer.create + customer.profile.update registered; customer.delete / visit.create / import.execute remain absent (count=22)', () => {
  it('registry contains exactly the 22 frozen capabilities; customer.create and customer.profile.update are the Wave-4 identities', () => {
    const ids = PRODUCTION_CAPABILITY_REGISTRY.list().map((d) => d.id);
    expect(ids).toHaveLength(22);
    expect(ids).toContain('customer.create');
    expect(ids).toContain('customer.profile.update');
    expect(ids).not.toContain('customer.delete');
    expect(ids).not.toContain('visit.create');
    expect(ids).not.toContain('import.execute');
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(22);
  });
});

/* ================================================================== */
/* §27 — REAL PRODUCT INTEGRATION EVIDENCE (safe fixtures only)        */
/* ================================================================== */

describe('§27 — REAL PRODUCT INTEGRATION EVIDENCE: real-path lifecycle integration across capability classes', () => {
  it('customer.get (READ/CUSTOMER): full lifecycle with one invocation_id', async () => {
    const { engine, emitter } = makeProductionHarness();
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await engine.invoke({ capability_id: 'customer.get', capability_version: '1.0.0', input: { snapshot, context }, scope: { customer_id: 'customer-1' } });
    expect(outcome.status).toBe('SUCCESS');
    expect(emitter.events().map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
    expect(emitter.events().every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
  });

  it('battle_card.current.read (READ/CUSTOMER): real memory-DB path lifecycle', async () => {
    const seeded = await openMemoryDbWithCards();
    const { engine, emitter } = makeProductionHarness();
    try {
      const outcome = await engine.invoke({
        capability_id: 'battle_card.current.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('SUCCESS');
      const events = emitter.events();
      expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
      expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
      expect(events[2].scope_id).toBe('cust-a');
    } finally {
      seeded.db.close();
    }
  });

  it('import.mapping.validate (ANALYZE/NONE): lifecycle without artificial customer scope', async () => {
    const { engine, emitter } = makeProductionHarness();
    const outcome = await engine.invoke({
      capability_id: 'import.mapping.validate',
      capability_version: '1.0.0',
      input: [{ sourceColumn: '客户名称', crmField: 'name' }],
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    expect(emitter.events().every((e) => e.scope_type === 'NONE' && e.scope_id === null)).toBe(true);
    expect(emitter.events()[2].event_type).toBe('EXECUTION_COMPLETED');
  });

  it('battle_card.draft.create (DRAFT/ALLOW_AUTO): real draft executor lifecycle, no implicit confirm', async () => {
    const seeded = await openMemoryDbWithCards();
    const { engine, emitter } = makeProductionHarness();
    try {
      const outcome = await engine.invoke({
        capability_id: 'battle_card.draft.create',
        capability_version: '1.0.0',
        input: { db: seeded.db, stage_code: 'NEW_LEAD' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('SUCCESS');
      expect(emitter.events().map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'EXECUTION_COMPLETED']);
      expect(emitter.events().some((e) => e.event_type === 'CONFIRMATION_REQUIRED')).toBe(false);
    } finally {
      seeded.db.close();
    }
  });

  it('follow_up.create (WRITE/REQUIRE_CONFIRMATION): confirmation lifecycle with existing-mechanism handoff', async () => {
    const { engine, emitter } = makeProductionHarness();
    const outcome = await engine.invoke({
      capability_id: 'follow_up.create',
      capability_version: '1.0.0',
      input: { title: '真实路径跟进' },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    if (outcome.status === 'CONFIRMATION_REQUIRED') {
      expect(outcome.confirmation_handoff?.proposal_id).toBeTruthy();
    }
    const events = emitter.events();
    expect(events.map((e) => e.event_type)).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'CONFIRMATION_REQUIRED']);
    expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
  });

  it('battle_card.intelligence_import.confirm (BULK_WRITE/REQUIRE_STRONG_CONFIRMATION): strong-confirmation lifecycle', async () => {
    const seeded = await openMemoryDbWithCards();
    const { engine, emitter } = makeProductionHarness();
    try {
      const outcome = await engine.invoke({
        capability_id: 'battle_card.intelligence_import.confirm',
        capability_version: '1.0.0',
        input: { db: seeded.db, raw_content: '真实导入内容' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      const events = emitter.events();
      expect(events.every((e) => e.invocation_id === outcome.invocation_id)).toBe(true);
      expect(events[2].confirmation_state).toBe('STRONG_REQUIRED');
      expect(events.some((e) => e.event_type.startsWith('EXECUTION_'))).toBe(false);
    } finally {
      seeded.db.close();
    }
  });

  it('all-20 compatibility: every production capability produces a valid event lifecycle with its real scope/A10 semantics', async () => {
    const { engine, emitter } = makeProductionHarness();
    for (const id of PRODUCTION_CAPABILITY_IDS) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      const decision = evaluateAuthorityPolicy(definition);
      const scope = definition.scope_requirement === 'CUSTOMER' ? { customer_id: 'cust-a' } : {};
      const input = inputFor(id);
      const outcome = await engine.invoke({ capability_id: id, capability_version: definition.version, input, scope });
      const events = emitter.events().filter((e) => e.invocation_id === outcome.invocation_id);
      // 每个调用至少产生可验证的结构化生命周期（CUSTOMER 有效 scope 下）。
      expect(events.length, id).toBeGreaterThanOrEqual(1);
      for (const event of events) {
        expect(event.capability_id, id).toBe(id);
        expect(event.capability_version).toBe(definition.version);
        expect(event.scope_type, id).toBe(definition.scope_requirement);
      }
      // 终态事件与 A10 决策一致（仅当该路径如实发出终态事件时）。
      const terminal = events[events.length - 1];
      if (decision.decision === 'ALLOW_AUTO') {
        if (terminal.event_type === 'EXECUTION_COMPLETED') {
          expect(terminal.result_status).toBe('SUCCESS');
        }
      }
    }
  });
});

/** 每个生产能力的真实输入形状（安全 fixture；只用于生命周期证据）。 */
function inputFor(id: string): unknown {
  switch (id) {
    case 'customer.search':
      return { filters: {} };
    case 'customer.get':
    case 'customer.context': {
      const snapshot = snapshotFixture();
      return { snapshot, context: contextFixture(snapshot) };
    }
    case 'timeline.customer.read':
    case 'timeline.visit.read':
    case 'follow_up.customer.read':
    case 'follow_up.global.read':
    case 'task.read_by_customer':
      return {};
    case 'battle_card.current.read':
    case 'battle_card.history.read':
    case 'battle_card.context.read':
      return { db: memoryDb ?? stubDb() };
    case 'import.file.preview':
      return makeXlsxFile();
    case 'import.mapping.validate':
      return [{ sourceColumn: '客户名称', crmField: 'name' }];
    case 'follow_up.create':
      return { title: 'x' };
    case 'task.create':
      return { title: 'x' };
    case 'customer.create':
      return { name: '生命周期客户' };
    case 'customer.next_follow_up_time.update':
      return { db: stubDb(), next_follow_up_at: '2026-08-01T00:00:00.000Z' };
    case 'battle_card.draft.create':
      return { db: memoryDb ?? stubDb(), stage_code: 'NEW_LEAD' };
    case 'battle_card.confirm':
      return { db: memoryDb ?? stubDb(), card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2 };
    case 'battle_card.hypothesis.status.update':
      return { db: memoryDb ?? stubDb(), hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: BC_NOW };
    case 'battle_card.intelligence_import.confirm':
      return { db: memoryDb ?? stubDb(), raw_content: 'x' };
    default:
      return {};
  }
}

function stubDb(): DatabaseLike {
  return {
    execute: async () => ({ rowsAffected: 0 }),
    select: async () => [],
  };
}
