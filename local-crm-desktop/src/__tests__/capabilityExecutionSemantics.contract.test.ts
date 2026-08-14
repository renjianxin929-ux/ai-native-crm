/**
 * V0.2A / W3-1 — Capability Execution Semantics 契约测试。
 *
 * 覆盖规格 T1–T20 + 第 26 节真实集成证据 + 第 27 节安全审查：
 *   T1  PRODUCTION REGISTRY COMPOSITION   T2  IDENTITY LOOKUP
 *   T3  BINDING UNIQUENESS                T4  UNKNOWN EXECUTOR
 *   T5  CAPABILITY NOT FOUND              T6  INPUT VALIDATION
 *   T7  CUSTOMER SCOPE REQUIRED           T8  NO GLOBAL FALLBACK
 *   T9  NONE SCOPE                        T10 AUTHORITY AUTO
 *   T11 CONFIRMATION REQUIRED             T12 STRONG CONFIRMATION
 *   T13 DENY AUTONOMOUS                   T14 EXECUTOR SUCCESS
 *   T15 EXECUTOR ERROR                    T16 NO MODEL / NETWORK
 *   T17 ZERO BUSINESS WRITES              T18 AUTHORITY CANNOT BE BYPASSED
 *   T19 CALLER IMMUTABILITY               T20 NO V0.3 RUNTIME
 *
 * 相干闭合（W3_1_01 CUSTOMER_SCOPE_INPUT_COHERENCE）追加覆盖：
 *   T21 CUSTOMER SCOPE / INPUT MATCH      T22 CUSTOMER SCOPE / INPUT MISMATCH
 *   T23 ALL CUSTOMER CAPABILITY COHERENCE T24 NO INPUT SCOPE SMUGGLING
 *   T25 GLOBAL UNAFFECTED                 T26 NONE UNAFFECTED
 *   + 双客户真实路径对抗证据（customer.get / timeline.customer.read /
 *     battle_card.current.read）：scope=A 绝不返回 B、绝不调用 B 目标执行器。
 *
 * 原则：
 * - 合成 fixture（fixture.*）只用于证明结果语义（写/删/拒/错误/校验/相干）；
 *   真实生产路径（customer / timeline / follow-up / task / battle-card / import）
 *   全部经 PRODUCTION_CAPABILITY_EXECUTION 走统一链并比对现有真实 adapter 输出。
 * - W3-1 Closure 1 后，生产基线已按集成审计演进为 20 项：
 *     原 Wave1/Wave2 READ/ANALYZE 13 项（行为不变）
 *     + W3-3 冻结 WRITE/DRAFT 能力 7 项（按各自冻结 A10 矩阵）
 *   本套件按分区断言：13 原读能力保持原语义；7 写能力使用 W3-3 冻结 A10 决策；
 *   不把 AUTO 语义扩大到全部 20 项。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import Database from 'better-sqlite3';

import { createCapabilityRegistry, type CapabilityDefinition } from '../lib/capabilities';
import type { CapabilityRegistry } from '../lib/capabilities/registry';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import {
  CapabilityInputValidationError,
  createCapabilityBindingRegistry,
  createCapabilityExecutionEngine,
  DuplicateExecutorBindingError,
  InvalidExecutorBindingError,
  PRODUCTION_CAPABILITY_BINDINGS,
  PRODUCTION_CAPABILITY_BINDING_REGISTRY,
  PRODUCTION_CAPABILITY_COUNT,
  PRODUCTION_CAPABILITY_EXECUTION,
  PRODUCTION_CAPABILITY_IDS,
  PRODUCTION_CAPABILITY_REGISTRY,
  type CapabilityBindingRegistry,
  type CapabilityExecutionEngine,
  type CapabilityExecutorBinding,
  type CapabilityInvocation,
  type CapabilityInvocationScope,
} from '../lib/capabilities/execution';

import { EVIDENCE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/evidence/manifest';

/* ------------------------------------------------------------------ */
/* 生产身份分区常量（本套件的真实基线：13 原读 + 7 W3-3 写 = 20）           */
/* ------------------------------------------------------------------ */

/** 原 Wave1/Wave2 READ/ANALYZE 能力（13 项；生产注册表必须完整保留，行为不变）。 */
const ORIGINAL_READ_ANALYZE_IDS: readonly string[] = Object.freeze([
  'customer.search',
  'customer.get',
  'customer.context',
  'timeline.customer.read',
  'timeline.visit.read',
  'follow_up.customer.read',
  'follow_up.global.read',
  'task.read_by_customer',
  'battle_card.current.read',
  'battle_card.history.read',
  'battle_card.context.read',
  'import.file.preview',
  'import.mapping.validate',
]);

/** W3-3 冻结 WRITE/DRAFT 能力（7 项；各自 A10 决策来自冻结 manifest，见 WRITE_DRAFT_A10）。 */
const WRITE_DRAFT_IDS: readonly string[] = Object.freeze([
  'customer.next_follow_up_time.update',
  'follow_up.create',
  'task.create',
  'battle_card.draft.create',
  'battle_card.confirm',
  'battle_card.hypothesis.status.update',
  'battle_card.intelligence_import.confirm',
]);

/** W3-3 冻结 A10 决策矩阵（与 existingWriteCapabilityRegistration / Closure-1 套件同一真值）。 */
const WRITE_DRAFT_A10: Readonly<Record<string, 'ALLOW_AUTO' | 'REQUIRE_CONFIRMATION' | 'REQUIRE_STRONG_CONFIRMATION' | 'DENY_AUTONOMOUS'>> = Object.freeze({
  'follow_up.create': 'REQUIRE_CONFIRMATION',
  'task.create': 'REQUIRE_CONFIRMATION',
  'customer.next_follow_up_time.update': 'REQUIRE_CONFIRMATION',
  'battle_card.draft.create': 'ALLOW_AUTO',
  'battle_card.confirm': 'REQUIRE_CONFIRMATION',
  'battle_card.hypothesis.status.update': 'REQUIRE_CONFIRMATION',
  'battle_card.intelligence_import.confirm': 'REQUIRE_STRONG_CONFIRMATION',
});

import { getCustomerRead, readCustomerContextRead } from '../lib/capabilities/customer/readAdapter';
import { readCustomerTimeline, readCustomerVisits } from '../lib/capabilities/timeline/readAdapter';
import {
  readBattleCardHistory,
  readCurrentBattleCard,
  readCustomerBattleContext,
  type BattleCardReadResult,
} from '../lib/capabilities/battleCard/readAdapter';

import { buildWorkspaceContextSnapshot } from '../lib/context/workspaceContextAdapter';
import type { ContextSnapshot } from '../lib/context/types';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import type { SalesAgentToolResult } from '../lib/salesAgentTools/registry';
import type { SearchCustomersResult } from '../lib/salesAgentTools/executeSearchCustomersTool';
import { openSalesAgentSqliteFixture } from './salesAgentFunctionalFixture';
import { __setDbInstanceForTests, initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { createBattleCardRepositories, type BattleCardRepositories } from '../lib/battleCard/repository';
import { createBattleCardAgentTools } from '../lib/battleCard/agentTools';
import { BATTLE_CARD_SCHEMA_VERSION } from '../lib/battleCard/schema';
import type { BattleCardPayload, CustomerStageCardInput } from '../lib/battleCard/types';
import { parseExcelFile, type FieldMapping } from '../lib/importer';

const NOW = '2026-07-14T12:00:00.000Z';
const BC_NOW = '2026-08-01T12:00:00.000Z';
const clock = () => BC_NOW;

/* ------------------------------------------------------------------ */
/* 合成 fixture（只用于证明结果语义；绝不进入生产 manifest）               */
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
    domain: 'fixture-execution',
    description: `W3-1 synthetic fixture: ${id}`,
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

/** 合成 manifest：写/删/拒/成功/错误/未绑定/作用域/输入校验 语义样本。 */
const SYNTHETIC_MANIFEST: readonly CapabilityDefinition[] = Object.freeze([
  makeFixture('fixture.write.confirm', { effect: 'WRITE', data_target: 'CRM_STATE', risk_level: 'LOW', authority_policy: 'CONFIRM', requires_confirmation: true, idempotency: 'REQUIRED', executor_ref: 'fixture.executor.write.confirm' }),
  makeFixture('fixture.write.bulk', { effect: 'BULK_WRITE', data_target: 'CRM_STATE', risk_level: 'MEDIUM', authority_policy: 'AUTO', idempotency: 'REQUIRED', executor_ref: 'fixture.executor.write.bulk' }),
  makeFixture('fixture.write.delete', { effect: 'DELETE', data_target: 'CRM_STATE', risk_level: 'HIGH', authority_policy: 'AUTO', idempotency: 'REQUIRED', executor_ref: 'fixture.executor.write.delete' }),
  makeFixture('fixture.deny.read', { effect: 'READ', authority_policy: 'DENY_AUTONOMOUS', executor_ref: 'fixture.executor.deny.read' }),
  makeFixture('fixture.executor.success', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.success' }),
  makeFixture('fixture.executor.error', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.error' }),
  makeFixture('fixture.executor.unbound', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.not-registered' }),
  makeFixture('fixture.scope.customer', { effect: 'READ', authority_policy: 'AUTO', scope_requirement: 'CUSTOMER', executor_ref: 'fixture.executor.scope.customer' }),
  makeFixture('fixture.scope.global', { effect: 'READ', authority_policy: 'AUTO', scope_requirement: 'GLOBAL', executor_ref: 'fixture.executor.scope.global' }),
  makeFixture('fixture.scope.none', { effect: 'ANALYZE', authority_policy: 'AUTO', scope_requirement: 'NONE', executor_ref: 'fixture.executor.scope.none' }),
  makeFixture('fixture.input.invalid', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.input.invalid' }),
  makeFixture('fixture.scope.coherence', { effect: 'READ', authority_policy: 'AUTO', scope_requirement: 'CUSTOMER', executor_ref: 'fixture.executor.scope.coherence' }),
]);

interface SyntheticHarness {
  readonly engine: CapabilityExecutionEngine;
  readonly registry: CapabilityRegistry;
  readonly bindings: CapabilityBindingRegistry;
  readonly callsFor: (executorRef: string) => number;
}

/** 每个用例一个全新计数 harness（计数器互不干扰）。 */
function makeSyntheticHarness(): SyntheticHarness {
  const counters = new Map<string, number>();
  const bump = (ref: string): void => {
    counters.set(ref, (counters.get(ref) ?? 0) + 1);
  };
  const guarded = (ref: string, execute: (input: unknown, scope: CapabilityInvocationScope) => unknown): CapabilityExecutorBinding => ({
    executor_ref: ref,
    validateInput: (input: unknown): unknown => input,
    execute: async (input, scope) => {
      bump(ref);
      return execute(input, scope);
    },
  });

  const bindings = createCapabilityBindingRegistry([
    guarded('fixture.executor.write.confirm', () => 'SHOULD_NOT_RUN'),
    guarded('fixture.executor.write.bulk', () => 'SHOULD_NOT_RUN'),
    guarded('fixture.executor.write.delete', () => 'SHOULD_NOT_RUN'),
    guarded('fixture.executor.deny.read', () => 'SHOULD_NOT_RUN'),
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
    guarded('fixture.executor.scope.customer', (_input, scope) => ({ scoped: 'customer', customer_id: scope.customer_id })),
    guarded('fixture.executor.scope.global', () => ({ scoped: 'global' })),
    guarded('fixture.executor.scope.none', () => ({ scoped: 'none' })),
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
    {
      executor_ref: 'fixture.executor.scope.coherence',
      // 引擎级 SCOPE↔INPUT 相干证明：validateInput 收到显式 scope，
      // 输入客户选择字段必须等于 scope.customer_id，否则执行器绝不被调用。
      validateInput: (input: unknown, scope: CapabilityInvocationScope): unknown => {
        const record = input as { customer_id?: unknown } | null;
        if (record && typeof record === 'object' && record.customer_id !== undefined) {
          if (typeof record.customer_id !== 'string' || record.customer_id.trim().length === 0) {
            throw new CapabilityInputValidationError('fixture.scope.coherence input customer_id must be a non-empty string when present.');
          }
          if (record.customer_id !== scope.customer_id) {
            throw new CapabilityInputValidationError(
              `fixture.scope.coherence input customer_id (${record.customer_id}) contradicts scope.customer_id (${String(scope.customer_id)}).`,
            );
          }
        }
        return input;
      },
      execute: async (_input: unknown, scope: CapabilityInvocationScope) => {
        bump('fixture.executor.scope.coherence');
        return { effective_customer_id: scope.customer_id };
      },
    },
  ]);

  const registry = createCapabilityRegistry(SYNTHETIC_MANIFEST);
  const engine = createCapabilityExecutionEngine({ registry, bindings });
  return { engine, registry, bindings, callsFor: (ref) => counters.get(ref) ?? 0 };
}

/** 深层冻结（A1 同款防御模式；用于不可变性断言）。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 与产品路径一致的 snapshot fixture（两个客户 + 一个任务）。 */
function snapshotFixture(): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'w3-1-contract-fixture',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [
      { id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } },
      { id: 'customer-2', name: 'Ben', customer_grade: 'B', intent_level: 'MEDIUM', evidence_ref: { type: 'customer', id: 'customer-2', label: 'Ben', synthetic: false, persisted: true } },
    ],
    tasks: [
      { id: 'task-1', customer_id: 'customer-1', title: '跟进报价', due_at: '2026-07-15T00:00:00.000Z', status: 'TODO', priority: 2, evidence_ref: { type: 'task', id: 'task-1', label: '跟进报价', synthetic: false, persisted: true } },
    ],
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

/** xlsx 库 write(type:'array') 输出转 Uint8Array。 */
function toBytes(out: unknown): Uint8Array {
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (ArrayBuffer.isView(out)) return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  return Uint8Array.from(out as number[]);
}

/** 代表性有效 .xlsx fixture（4 列 × 4 行，含一行缺客户名称）。 */
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

/* ------------------------------------------------------------------ */
/* Battle Card 内存 DB（真实 schema + 真实产品读取路径）                  */
/* ------------------------------------------------------------------ */

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
  const cardB1 = await insertCard('cust-b', 'CONTACTED', 1, 'CONFIRMED');
  await insertCard('cust-b', 'CONTACTED', 2, 'DRAFT');

  await db.execute(
    `UPDATE customers SET current_stage_card_id = ?, battle_card_status = 'CONFIRMED', last_battle_review_at = ?, updated_at = ? WHERE id = ?`,
    [cardA1.id, BC_NOW, BC_NOW, 'cust-a'],
  );
  await db.execute(
    `UPDATE customers SET current_stage_card_id = ?, battle_card_status = 'CONFIRMED', last_battle_review_at = ?, updated_at = ? WHERE id = ?`,
    [cardB1.id, BC_NOW, BC_NOW, 'cust-b'],
  );

  memoryDb = db;
  return { db, repos };
}

/* ------------------------------------------------------------------ */
/* T1 — PRODUCTION REGISTRY COMPOSITION                                 */
/* ------------------------------------------------------------------ */

describe('T1 — PRODUCTION REGISTRY COMPOSITION: all frozen manifests compose; count = 20 (13 original + 7 W3-3); Evidence contributes 0', () => {
  it('composes all frozen domain manifests: count = 20, exact identity set = 13 original + 7 W3-3', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(20);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(20);
    expect(PRODUCTION_CAPABILITY_IDS).toEqual([
      // 原 Wave1/Wave2 READ/ANALYZE 13 项（注册顺序与 Wave-2 冻结基线一致）
      'customer.search',
      'customer.get',
      'customer.context',
      'timeline.customer.read',
      'timeline.visit.read',
      'follow_up.customer.read',
      'follow_up.global.read',
      'task.read_by_customer',
      'battle_card.current.read',
      'battle_card.history.read',
      'battle_card.context.read',
      'import.file.preview',
      'import.mapping.validate',
      // W3-3 冻结 WRITE/DRAFT 7 项（追加注册，注册顺序 = manifest 组合顺序）
      'customer.next_follow_up_time.update',
      'follow_up.create',
      'task.create',
      'battle_card.draft.create',
      'battle_card.confirm',
      'battle_card.hypothesis.status.update',
      'battle_card.intelligence_import.confirm',
    ]);
    expect(new Set(PRODUCTION_CAPABILITY_IDS).size).toBe(20);
    // 原 13 身份必须完整保留（不是被替换，而是被扩展）
    for (const id of ORIGINAL_READ_ANALYZE_IDS) {
      expect(PRODUCTION_CAPABILITY_IDS).toContain(id);
    }
    // 恰好 7 个 W3-3 写/草稿身份（精确集合，不允许第 8 个）
    expect(PRODUCTION_CAPABILITY_IDS.filter((id) => WRITE_DRAFT_IDS.includes(id)).sort()).toEqual([...WRITE_DRAFT_IDS].sort());
    expect(PRODUCTION_CAPABILITY_IDS.filter((id) => WRITE_DRAFT_IDS.includes(id))).toHaveLength(7);
    // 分区不重叠、无第 21 项
    expect(ORIGINAL_READ_ANALYZE_IDS.some((id) => WRITE_DRAFT_IDS.includes(id))).toBe(false);
    expect(PRODUCTION_CAPABILITY_IDS.length).toBe(20);
  });

  it('evidence empty manifest stays part of composition while contributing zero identities', () => {
    expect(EVIDENCE_READ_CAPABILITY_MANIFEST).toHaveLength(0);
    const evidenceIds = PRODUCTION_CAPABILITY_REGISTRY.listByDomain('evidence').map((d) => d.id);
    expect(evidenceIds).toEqual([]);
    expect(PRODUCTION_CAPABILITY_IDS.some((id) => id.startsWith('evidence'))).toBe(false);
  });

  it('production registry is deterministic, immutable, and caller-safe', () => {
    const a = PRODUCTION_CAPABILITY_REGISTRY.get('customer.get', '1.0.0');
    const b = PRODUCTION_CAPABILITY_REGISTRY.get('customer.get', '1.0.0');
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.audit_contract)).toBe(true);
    const listed = PRODUCTION_CAPABILITY_REGISTRY.list();
    expect(listed).toHaveLength(20);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(20);
  });

  it('no giant mutable ALL_CAPABILITIES array is exported', () => {
    const indexSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/index.ts'), 'utf8');
    const productionSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/production.ts'), 'utf8');
    // 剥离注释：文档可以描述约束，导出面代码不得出现 ALL_CAPABILITIES 标识符。
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripComments(indexSource)).not.toMatch(/ALL_CAPABILITIES/);
    expect(stripComments(productionSource)).not.toMatch(/ALL_CAPABILITIES/);
  });
});

/* ------------------------------------------------------------------ */
/* T2 — IDENTITY LOOKUP                                                 */
/* ------------------------------------------------------------------ */

describe('T2 — IDENTITY LOOKUP: all 20 identities resolve through the production registry; all executor_refs truthfully bound', () => {
  it('every production identity resolves deterministically', () => {
    for (const id of PRODUCTION_CAPABILITY_IDS) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      expect(definition.id).toBe(id);
      expect(definition.version).toBe('1.0.0');
    }
  });

  it('all 20 executor_refs are truthfully bound to existing domain adapters (BOUND=20, UNBOUND=[])', () => {
    const unbound: string[] = [];
    for (const id of PRODUCTION_CAPABILITY_IDS) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      const binding = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref);
      if (binding === undefined) unbound.push(id);
      expect(binding, `executor_ref ${definition.executor_ref} of ${id} must be bound`).toBeDefined();
      expect(binding?.executor_ref).toBe(definition.executor_ref);
    }
    expect(unbound).toEqual([]);
    // 绑定数 = 注册表数 = 20（绑定与身份一一对应）
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(20);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(20);
    // 七个 W3-3 写 executor_ref 全部为冻结身份
    for (const id of WRITE_DRAFT_IDS) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref)).toBeDefined();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T3 — BINDING UNIQUENESS                                              */
/* ------------------------------------------------------------------ */

describe('T3 — BINDING UNIQUENESS: duplicate executor binding fails closed', () => {
  it('a second binding with the same executor_ref is rejected at construction', () => {
    const entry: CapabilityExecutorBinding = {
      executor_ref: 'fixture.dup.ref',
      validateInput: (input: unknown): unknown => input,
      execute: async () => 'ok',
    };
    expect(() => createCapabilityBindingRegistry([entry, { ...entry }])).toThrow(DuplicateExecutorBindingError);
  });

  it('malformed binding entries fail closed (no silent acceptance)', () => {
    expect(() => createCapabilityBindingRegistry([null as unknown as CapabilityExecutorBinding])).toThrow(InvalidExecutorBindingError);
    expect(() => createCapabilityBindingRegistry([{ executor_ref: '   ' } as unknown as CapabilityExecutorBinding])).toThrow(InvalidExecutorBindingError);
    expect(() => createCapabilityBindingRegistry([{ executor_ref: 'x', validateInput: () => undefined } as unknown as CapabilityExecutorBinding])).toThrow(InvalidExecutorBindingError);
  });
});

/* ------------------------------------------------------------------ */
/* T4 — UNKNOWN EXECUTOR                                                */
/* ------------------------------------------------------------------ */

describe('T4 — UNKNOWN EXECUTOR: unbound executor_ref never falls back', () => {
  it('returns a stable EXECUTOR_NOT_BOUND failure; nothing executes', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.executor.unbound',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('EXECUTOR_NOT_BOUND');
      expect(outcome.executor_ref).toBeNull();
      expect(outcome.message).toContain('fixture.executor.not-registered');
    }
  });

  it('an arbitrary executor_ref string in a definition is never executed (no string-to-code)', async () => {
    // 即使能力定义携带任意 executor_ref，也只会做注册表精确查找，绝不 eval / 动态加载。
    const registry = createCapabilityRegistry([makeFixture('fixture.injected.ref', { executor_ref: 'evil:anything' })]);
    const bindings = createCapabilityBindingRegistry([]);
    const engine = createCapabilityExecutionEngine({ registry, bindings });
    const outcome = await engine.invoke({ capability_id: 'fixture.injected.ref', capability_version: '1.0.0', input: {}, scope: {} });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('EXECUTOR_NOT_BOUND');
    }
  });
});

/* ------------------------------------------------------------------ */
/* T5 — CAPABILITY NOT FOUND                                            */
/* ------------------------------------------------------------------ */

describe('T5 — CAPABILITY NOT FOUND: unknown identity returns stable failure', () => {
  it('synthetic engine: unknown identity → CAPABILITY_NOT_FOUND', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.not.registered',
      capability_version: '9.9.9',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('CAPABILITY_NOT_FOUND');
      expect(outcome.capability_id).toBe('fixture.not.registered');
      expect(outcome.capability_version).toBe('9.9.9');
    }
  });

  it('production engine: unknown identity → CAPABILITY_NOT_FOUND', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.nonexistent',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('CAPABILITY_NOT_FOUND');
    }
  });
});

/* ------------------------------------------------------------------ */
/* T6 — INPUT VALIDATION                                                */
/* ------------------------------------------------------------------ */

describe('T6 — INPUT VALIDATION: invalid input fails before executor call (calls = 0)', () => {
  it('invalid input → INVALID_INPUT, executor call count stays 0', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.input.invalid',
      capability_version: '1.0.0',
      input: { value: 1 },
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
    expect(harness.callsFor('fixture.executor.input.invalid')).toBe(0);
  });

  it('valid input passes the guard and executes exactly once', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.input.invalid',
      capability_version: '1.0.0',
      input: { value: 7 },
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    expect(harness.callsFor('fixture.executor.input.invalid')).toBe(1);
  });

  it('production: customer.get with malformed input fails before executor call', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot: 'not-an-object' },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
  });
});

/* ------------------------------------------------------------------ */
/* T7 — CUSTOMER SCOPE REQUIRED                                         */
/* ------------------------------------------------------------------ */

describe('T7 — CUSTOMER SCOPE REQUIRED: CUSTOMER capability without valid scope fails closed', () => {
  it('synthetic customer-scoped capability with missing customer scope → INVALID_SCOPE, calls = 0', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.scope.customer',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
    }
    expect(harness.callsFor('fixture.executor.scope.customer')).toBe(0);
  });

  it('blank customer scope is also rejected (no silent trimming to a customer)', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.scope.customer',
      capability_version: '1.0.0',
      input: {},
      scope: { customer_id: '   ' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
    }
  });

  it('production: customer.get without customer scope → INVALID_SCOPE (calls = 0, no read)', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
    }
  });

  it('production: battle_card.current.read without customer scope → INVALID_SCOPE', async () => {
    // 输入校验先行：db 必须通过 DatabaseLike 护栏，才会到达 scope 门控。
    const dbStub: DatabaseLike = {
      execute: async () => ({ rowsAffected: 0 }),
      select: async () => [],
    };
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'battle_card.current.read',
      capability_version: '1.0.0',
      input: { db: dbStub },
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
    }
  });
});

/* ------------------------------------------------------------------ */
/* T8 — NO GLOBAL FALLBACK                                              */
/* ------------------------------------------------------------------ */

describe('T8 — NO GLOBAL FALLBACK: missing customer never broadens to GLOBAL', () => {
  it('customer-scoped invocation failure is INVALID_SCOPE, never a global read', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.scope.customer',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
      expect(outcome.message).toMatch(/refusing to broaden to GLOBAL/);
    }
    expect(harness.callsFor('fixture.executor.scope.customer')).toBe(0);
    expect(harness.callsFor('fixture.executor.scope.global')).toBe(0);
  });

  it('GLOBAL capability does not pretend customer scope is required (with or without customer_id)', async () => {
    const harness = makeSyntheticHarness();
    const withoutCustomer = await harness.engine.invoke({
      capability_id: 'fixture.scope.global',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(withoutCustomer.status).toBe('SUCCESS');
    const withCustomer = await harness.engine.invoke({
      capability_id: 'fixture.scope.global',
      capability_version: '1.0.0',
      input: {},
      scope: { customer_id: 'customer-1' },
    });
    expect(withCustomer.status).toBe('SUCCESS');
    expect(harness.callsFor('fixture.executor.scope.global')).toBe(2);
  });

  it('production: follow_up.global.read (GLOBAL) succeeds without customer scope', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'follow_up.global.read',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    // GLOBAL 语义：不要求 customer scope；真实执行走 db.listAllFollowUps（见集成节）。
    expect(outcome.status).toBe('SUCCESS');
  });
});

/* ------------------------------------------------------------------ */
/* T9 — NONE SCOPE                                                      */
/* ------------------------------------------------------------------ */

describe('T9 — NONE SCOPE: Import Preview/Validate do not require artificial customer scope', () => {
  it('synthetic NONE capability runs with no customer scope', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.scope.none',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    expect(harness.callsFor('fixture.executor.scope.none')).toBe(1);
  });

  it('production: import.mapping.validate (NONE) runs with empty scope', async () => {
    const mapping: readonly FieldMapping[] = [{ sourceColumn: '客户名称', crmField: 'name' }];
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'import.mapping.validate',
      capability_version: '1.0.0',
      input: mapping,
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect((outcome.payload as { valid: boolean }).valid).toBe(true);
    }
  });

  it('production: import.file.preview (NONE) runs with empty scope', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'import.file.preview',
      capability_version: '1.0.0',
      input: makeXlsxFile(),
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect((outcome.payload as { headers: string[] }).headers).toEqual(['客户名称', '手机号', '城市', '意向']);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T10 — AUTHORITY AUTO                                                 */
/* ------------------------------------------------------------------ */

describe('T10 — AUTHORITY AUTO: original 13 READ/ANALYZE run exactly once; 7 W3-3 writes keep frozen A10', () => {
  it('synthetic READ with A10 ALLOW_AUTO executes exactly once per invocation', async () => {
    const harness = makeSyntheticHarness();
    const first = await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { marker: 1 },
      scope: {},
    });
    expect(first.status).toBe('SUCCESS');
    if (first.status === 'SUCCESS') {
      expect(first.authority_decision.decision).toBe('ALLOW_AUTO');
      expect(first.authority_decision.reason_code).toBe('AUTO_ALLOWED');
    }
    expect(harness.callsFor('fixture.executor.success')).toBe(1);

    await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { marker: 2 },
      scope: {},
    });
    expect(harness.callsFor('fixture.executor.success')).toBe(2);
  });

  it('original 13 READ/ANALYZE capabilities stay ALLOW_AUTO; the 7 W3-3 writes keep their frozen A10 matrix (AUTO is NOT broadened to 20)', () => {
    // 原 13：READ/ANALYZE effect + A10 ALLOW_AUTO（Wave1/Wave2 冻结行为不变）
    for (const id of ORIGINAL_READ_ANALYZE_IDS) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      expect(['READ', 'ANALYZE']).toContain(definition.effect);
      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.decision, id).toBe('ALLOW_AUTO');
      expect(decision.reason_code, id).toBe('AUTO_ALLOWED');
    }
    // 新 7：各自的冻结 W3-3 A10 决策（REQUIRE_CONFIRMATION ×5 / ALLOW_AUTO ×1 / REQUIRE_STRONG_CONFIRMATION ×1）
    for (const id of WRITE_DRAFT_IDS) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      expect(evaluateAuthorityPolicy(definition).decision, id).toBe(WRITE_DRAFT_A10[id]);
    }
    // 分区完备：13 + 7 = 20；全部身份都落在两个冻结分区之一
    const all = new Set(PRODUCTION_CAPABILITY_IDS);
    expect(all.size).toBe(20);
    for (const id of [...ORIGINAL_READ_ANALYZE_IDS, ...WRITE_DRAFT_IDS]) {
      expect(all.has(id)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T11 — CONFIRMATION REQUIRED                                          */
/* ------------------------------------------------------------------ */

describe('T11 — CONFIRMATION REQUIRED: WRITE requiring confirmation never invokes the executor', () => {
  it('returns a structured CONFIRMATION_REQUIRED outcome; executor call count = 0', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.write.confirm',
      capability_version: '1.0.0',
      input: { title: 'x' },
      scope: {},
    });
    expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    if (outcome.status === 'CONFIRMATION_REQUIRED') {
      expect(outcome.authority_decision.decision).toBe('REQUIRE_CONFIRMATION');
      expect(outcome.authority_decision.confirmation_required).toBe(true);
      expect(outcome.authority_decision.autonomous_allowed).toBe(false);
    }
    expect(harness.callsFor('fixture.executor.write.confirm')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* T12 — STRONG CONFIRMATION                                            */
/* ------------------------------------------------------------------ */

describe('T12 — STRONG CONFIRMATION: DELETE / BULK_WRITE never invoke the executor', () => {
  it('BULK_WRITE → STRONG_CONFIRMATION_REQUIRED, calls = 0', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.write.bulk',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
    if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
      expect(outcome.authority_decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
      expect(outcome.authority_decision.reason_code).toBe('DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL');
    }
    expect(harness.callsFor('fixture.executor.write.bulk')).toBe(0);
  });

  it('DELETE → STRONG_CONFIRMATION_REQUIRED, calls = 0', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.write.delete',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
    if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
      expect(outcome.authority_decision.decision).toBe('REQUIRE_STRONG_CONFIRMATION');
    }
    expect(harness.callsFor('fixture.executor.write.delete')).toBe(0);
  });

  it('the production write/draft surface is exactly the 7 frozen W3-3 capabilities; no DELETE, no Wave-4, no generic customer.update', () => {
    const effects = Object.fromEntries(PRODUCTION_CAPABILITY_REGISTRY.list().map((d) => [d.id, d.effect]));
    // 原 13 保持 READ/ANALYZE（写面没有从读能力上"偷渡"）
    for (const id of ORIGINAL_READ_ANALYZE_IDS) {
      expect(['READ', 'ANALYZE']).toContain(effects[id]);
    }
    // 写/草稿面 = 恰好 7 个 W3-3 身份（WRITE / DRAFT / BULK_WRITE；精确集合）
    const writeDraft = Object.entries(effects)
      .filter(([, effect]) => effect === 'WRITE' || effect === 'BULK_WRITE' || effect === 'DRAFT')
      .map(([id]) => id);
    expect(writeDraft.sort()).toEqual([...WRITE_DRAFT_IDS].sort());
    expect(writeDraft).toHaveLength(7);
    // 无 DELETE 效应；Wave-4 / 泛化写身份缺席
    expect(Object.values(effects)).not.toContain('DELETE');
    for (const forbidden of ['customer.create', 'customer.delete', 'visit.create', 'import.execute', 'customer.update']) {
      expect(PRODUCTION_CAPABILITY_IDS).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T13 — DENY AUTONOMOUS                                                */
/* ------------------------------------------------------------------ */

describe('T13 — DENY AUTONOMOUS: denied outcome with executor call count = 0', () => {
  it('DENY_AUTONOMOUS → AUTONOMY_DENIED, calls = 0', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.deny.read',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('AUTONOMY_DENIED');
    if (outcome.status === 'AUTONOMY_DENIED') {
      expect(outcome.authority_decision.decision).toBe('DENY_AUTONOMOUS');
      expect(outcome.authority_decision.reason_code).toBe('AUTONOMY_DENIED');
      expect(outcome.authority_decision.autonomous_allowed).toBe(false);
      expect(outcome.authority_decision.confirmation_required).toBe(false);
    }
    expect(harness.callsFor('fixture.executor.deny.read')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* T14 — EXECUTOR SUCCESS                                               */
/* ------------------------------------------------------------------ */

describe('T14 — EXECUTOR SUCCESS: original payload preserved', () => {
  it('payload is the original executor result (same reference, not rewritten)', async () => {
    const harness = makeSyntheticHarness();
    const input = { original: 'payload', nested: { keep: true } };
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input,
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect(outcome.payload).toBe(input);
      expect(outcome.payload).toEqual({ original: 'payload', nested: { keep: true } });
    }
  });

  it('production: customer.get payload equals the real adapter output', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect(outcome.payload).toEqual(getCustomerRead({ customer_id: 'customer-1', snapshot, context }));
      const result = outcome.payload as SalesAgentToolResult;
      expect(result.tool_id).toBe('get_customer');
      expect(result.read_only).toBe(true);
      expect(result.writes_crm).toBe(false);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({ id: 'customer-1', name: 'Ada' });
    }
  });
});

/* ------------------------------------------------------------------ */
/* T15 — EXECUTOR ERROR                                                 */
/* ------------------------------------------------------------------ */

describe('T15 — EXECUTOR ERROR: domain executor error is an execution error, never false success', () => {
  it('executor throw → EXECUTION_ERROR with EXECUTOR_ERROR code', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.executor.error',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('EXECUTOR_ERROR');
      expect(outcome.message).toContain('synthetic domain boom');
    }
  });

  it('error metadata is sanitized: control characters escaped and message bounded', async () => {
    const registry = createCapabilityRegistry([makeFixture('fixture.sanitize', { effect: 'READ' })]);
    const bindings = createCapabilityBindingRegistry([{
      executor_ref: 'fixture.executor.v1',
      validateInput: (input: unknown): unknown => input,
      execute: async () => {
        throw new Error(`top\u0000secret${'y'.repeat(700)}`);
      },
    }]);
    const engine = createCapabilityExecutionEngine({ registry, bindings });
    const outcome = await engine.invoke({
      capability_id: 'fixture.sanitize',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      // 原始 NUL 被转义为字面量 \\u0000；消息长度有界（512 + 省略号）。
      expect(outcome.message).not.toContain('\u0000');
      expect(outcome.message).toContain('\\u0000');
      expect(outcome.message.length).toBeLessThanOrEqual(520);
      // 不泄漏"原始敏感内容"整体（截断）。
      expect(outcome.message).not.toContain('y'.repeat(700));
    }
  });
});

/* ------------------------------------------------------------------ */
/* T16 — NO MODEL / NETWORK                                             */
/* ------------------------------------------------------------------ */

describe('T16 — NO MODEL / NETWORK: execution framework introduces MODEL_CALLS=0 / PROVIDER_CALLS=0 / NETWORK_CALLS=0', () => {
  it('static: execution layer sources never reference model/provider/network machinery', () => {
    const dir = resolve(process.cwd(), 'src/lib/capabilities/execution');
    const files = ['contract.ts', 'binding.ts', 'engine.ts', 'production.ts', 'index.ts'];
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden = /(fetch\(|XMLHttpRequest|WebSocket|axios|https?:\/\/|deepseek|openai|anthropic|firecrawl|\.generate\s*\(|llm\b|model\s*\(|provider\s*\(|prompt\s*\()/i;
    for (const file of files) {
      const codeOnly = stripComments(readFileSync(resolve(dir, file), 'utf8'));
      expect(codeOnly, `${file} must not reference model/provider/network machinery`).not.toMatch(forbidden);
    }
  });

  it('static: engine imports stay within A1/A10/contract/binding layers (no db/provider/executor runtime)', () => {
    const engineSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/engine.ts'), 'utf8');
    const imports = [...engineSource.matchAll(/from '([^']+)';/g)].map((m) => m[1]);
    expect(imports.every((p) => /^\.\.\/|^\.\//.test(p))).toBe(true);
    expect(imports.join('\n')).not.toMatch(/db|provider|model|battleCard|importer|salesAgent|network/i);
  });

  it('behavioral: representative executions produce read-only results with no provider/network flags', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      const result = outcome.payload as SalesAgentToolResult;
      expect(result.read_only).toBe(true);
      expect(result.writes_crm).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T17 — ZERO BUSINESS WRITES                                           */
/* ------------------------------------------------------------------ */

describe('T17 — ZERO BUSINESS WRITES IN CORE: engine/contract/binding/production composition files carry no CRM write tokens; write adapters stay isolated in ./writeAdapters', () => {
  it('static: execution layer sources contain no CRM write tokens', () => {
    const dir = resolve(process.cwd(), 'src/lib/capabilities/execution');
    const files = ['contract.ts', 'binding.ts', 'engine.ts', 'production.ts', 'index.ts'];
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const writeTokens = /(INSERT INTO|UPDATE |DELETE FROM|\bcreateCustomer\b|\bupdateCustomer\b|\bdeleteCustomer\b|\bcreateTask\b|\bcreateFollowUp\b|\bcreateVisit\b|\bexecuteImport\b|\bimportLeadRowsToBatch\b|\bcreateLeadImportBatch\b|\bconfirmedWrite\b|\bapprovedCrmWriteBoundary\b|\bsessionWriteStateStore\b)/;
    for (const file of files) {
      const codeOnly = stripComments(readFileSync(resolve(dir, file), 'utf8'));
      expect(codeOnly, `${file} must not reference write operations`).not.toMatch(writeTokens);
    }
  });

  it('behavioral: customer.get payload declares writes_crm=false', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect((outcome.payload as SalesAgentToolResult).writes_crm).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T18 — AUTHORITY CANNOT BE BYPASSED                                   */
/* ------------------------------------------------------------------ */

describe('T18 — AUTHORITY CANNOT BE BYPASSED: public unified surface always evaluates A10', () => {
  it('no public function that executes a bound executor without authority is exported', () => {
    const indexSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/index.ts'), 'utf8');
    expect(indexSource).not.toMatch(/executeBoundCapabilityDirectly|executeDirectly|bypass/i);
    const engineSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/engine.ts'), 'utf8');
    // 引擎唯一执行调用点位于 A10 评估之后；引擎源码必须引用 A10 评估器。
    expect(engineSource).toMatch(/evaluateAuthorityPolicy/);
    expect(engineSource).toMatch(/binding\.execute\(validatedInput/);
    // 引擎导出面只有 invoke（统一入口）+ registry/bindings 查询面（无 execute）。
    expect(engineSource).toMatch(/invoke/);
  });

  it('every SUCCESS outcome carries the A10 decision that allowed it (proof authority ran before execution)', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { marker: 1 },
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect(outcome.authority_decision.decision).toBe('ALLOW_AUTO');
      expect(outcome.authority_decision.autonomous_allowed).toBe(true);
    }
  });

  it('confirm / strong-confirm / deny paths never reach the executor (bypass impossible)', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({ capability_id: 'fixture.write.confirm', capability_version: '1.0.0', input: {}, scope: {} });
    await harness.engine.invoke({ capability_id: 'fixture.write.bulk', capability_version: '1.0.0', input: {}, scope: {} });
    await harness.engine.invoke({ capability_id: 'fixture.write.delete', capability_version: '1.0.0', input: {}, scope: {} });
    await harness.engine.invoke({ capability_id: 'fixture.deny.read', capability_version: '1.0.0', input: {}, scope: {} });
    expect(harness.callsFor('fixture.executor.write.confirm')).toBe(0);
    expect(harness.callsFor('fixture.executor.write.bulk')).toBe(0);
    expect(harness.callsFor('fixture.executor.write.delete')).toBe(0);
    expect(harness.callsFor('fixture.executor.deny.read')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* T19 — CALLER IMMUTABILITY                                            */
/* ------------------------------------------------------------------ */

describe('T19 — CALLER IMMUTABILITY: invocation/evaluation cannot mutate definitions, registry, or bindings', () => {
  it('invoking does not change registry or binding registry state', async () => {
    const harness = makeSyntheticHarness();
    const beforeRegistry = harness.registry.size();
    const beforeBindings = harness.bindings.size();
    await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { a: 1 }, scope: {} });
    await harness.engine.invoke({ capability_id: 'fixture.write.confirm', capability_version: '1.0.0', input: {}, scope: {} });
    await harness.engine.invoke({ capability_id: 'fixture.not.registered', capability_version: '1.0.0', input: {}, scope: {} });
    expect(harness.registry.size()).toBe(beforeRegistry);
    expect(harness.bindings.size()).toBe(beforeBindings);
  });

  it('definitions remain frozen and unchanged after invocations', async () => {
    const definition = deepFreeze(makeFixture('fixture.frozen.read', { effect: 'READ', authority_policy: 'AUTO', executor_ref: 'fixture.executor.success' }));
    const registry = createCapabilityRegistry([definition]);
    const bindings = createCapabilityBindingRegistry([{
      executor_ref: 'fixture.executor.success',
      validateInput: (input: unknown): unknown => input,
      execute: async () => 'ok',
    }]);
    const engine = createCapabilityExecutionEngine({ registry, bindings });
    const before = JSON.stringify(definition);
    await engine.invoke({ capability_id: 'fixture.frozen.read', capability_version: '1.0.0', input: {}, scope: {} });
    expect(JSON.stringify(definition)).toBe(before);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.audit_contract)).toBe(true);
  });

  it('outcome objects are frozen; caller mutation does not affect later outcomes', async () => {
    const harness = makeSyntheticHarness();
    const first = await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { n: 1 }, scope: {} });
    expect(Object.isFrozen(first)).toBe(true);
    const second = await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { n: 2 }, scope: {} });
    expect(second).not.toBe(first);
    if (first.status === 'SUCCESS' && second.status === 'SUCCESS') {
      expect(first.payload).toEqual({ n: 1 });
      expect(second.payload).toEqual({ n: 2 });
    }
  });

  it('the invocation object is not mutated by the engine', async () => {
    const harness = makeSyntheticHarness();
    const invocation: CapabilityInvocation = {
      capability_id: 'fixture.executor.success',
      capability_version: '1.0.0',
      input: { keep: 'this' },
      scope: { customer_id: 'customer-1' },
    };
    const before = JSON.stringify(invocation);
    await harness.engine.invoke(invocation);
    expect(JSON.stringify(invocation)).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/* T20 — NO V0.3 RUNTIME                                                */
/* ------------------------------------------------------------------ */

describe('T20 — NO V0.3 RUNTIME: no planner / tool-selection / agent-loop implemented', () => {
  it('static: execution layer contains no V0.3 constructs', () => {
    const dir = resolve(process.cwd(), 'src/lib/capabilities/execution');
    const files = ['contract.ts', 'binding.ts', 'engine.ts', 'production.ts', 'index.ts'];
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden = /(executeNaturalLanguageGoal|selectCapability|planTools|runAgentLoop|agentLoop|toolSelection|tool_selection|planner|goalDecompos|goal_decompos|observeAndContinue|Observe→Continue)/;
    for (const file of files) {
      const codeOnly = stripComments(readFileSync(resolve(dir, file), 'utf8'));
      expect(codeOnly, `${file} must not contain V0.3 constructs`).not.toMatch(forbidden);
      // 无 while 循环（禁止工具循环/重试循环）。
      expect(codeOnly, `${file} must not contain while loops`).not.toMatch(/\bwhile\s*\(/);
    }
  });

  it('static: no model/provider imports anywhere in the execution layer', () => {
    const dir = resolve(process.cwd(), 'src/lib/capabilities/execution');
    for (const file of ['contract.ts', 'binding.ts', 'engine.ts', 'production.ts', 'index.ts']) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      expect(source).not.toMatch(/from ['"][^'"]*(productionAi|modelProvider|ai\.ts|multimodalProvider|textAIProvider|provider)/);
    }
  });

  it('static: binding lookup is a deterministic map, not a switch over tool ids', () => {
    const bindingSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/binding.ts'), 'utf8');
    expect(bindingSource).not.toMatch(/\bswitch\s*\(/);
  });
});

/* ------------------------------------------------------------------ */
/* INTEGRATION — 真实产品链（规格 §26）                                   */
/* ------------------------------------------------------------------ */

describe('INTEGRATION — representative real product chains through the unified production surface', () => {
  it('customer.get: production registry → A10 ALLOW_AUTO → real Customer adapter → real Product result', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      const result = outcome.payload as SalesAgentToolResult;
      expect(result.tool_id).toBe('get_customer');
      expect(result.records[0]).toMatchObject({ id: 'customer-1', name: 'Ada', customer_grade: 'A' });
      expect(result.evidence_refs).toContain('customer-1');
      // parity：与现有真实 adapter 输出完全一致。
      expect(outcome.payload).toEqual(getCustomerRead({ customer_id: 'customer-1', snapshot, context }));
    }
  });

  it('customer.context: real context representation flows through the unified path', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.context',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      const result = outcome.payload as SalesAgentToolResult;
      expect(result.tool_id).toBe('get_customer_context');
      expect(outcome.payload).toEqual(readCustomerContextRead({ customer_id: 'customer-1', snapshot, context }));
      expect((result.records[0] as ContextSnapshot).kind).toBe('CRM_CONTEXT_SNAPSHOT');
    }
  });

  it('customer.search: real SQLite repository path through the unified surface', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.search',
        capability_version: '1.0.0',
        input: { filters: { region: '东莞' }, list_kind: 'portfolio', db: fixture.db },
        scope: {},
      });
      expect(outcome.status).toBe('SUCCESS');
      if (outcome.status === 'SUCCESS') {
        const result = outcome.payload as SearchCustomersResult;
        expect(result.read_only).toBe(true);
        expect(result.writes_crm).toBe(false);
        expect(result.candidates.map((c) => c.id).sort()).toEqual(['dg-a-jm', 'dg-c-other']);
        expect(result.total_matches).toBe(2);
      }
    } finally {
      fixture.close();
    }
  });

  it('battle_card.current.read: real Battle Card engine path through the unified surface', async () => {
    const seeded = await openMemoryDbWithCards();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.current.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('SUCCESS');
      if (outcome.status === 'SUCCESS') {
        const result = outcome.payload as BattleCardReadResult<Awaited<ReturnType<ReturnType<typeof createBattleCardAgentTools>['getCurrentStageCard']>>>;
        expect(result.customer_id).toBe('cust-a');
        expect(result.read_only).toBe(true);
        expect(result.writes_crm).toBe(false);
        expect(result.data?.id).toBe('card-cust-a-NEW_LEAD-v1');
        expect(result.data?.customer_id).toBe('cust-a');
        expect(result.data?.card_status).toBe('CONFIRMED');
        expect(outcome.payload).toEqual(await readCurrentBattleCard({ db: seeded.db, clock }, 'cust-a'));
      }
    } finally {
      seeded.db.close();
    }
  });

  it('battle_card.history.read + battle_card.context.read: real append-only history + context aggregation', async () => {
    const seeded = await openMemoryDbWithCards();
    try {
      const history = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.history.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock },
        scope: { customer_id: 'cust-a' },
      });
      expect(history.status).toBe('SUCCESS');
      if (history.status === 'SUCCESS') {
        expect(history.payload).toEqual(await readBattleCardHistory({ db: seeded.db, clock }, 'cust-a'));
        const historyResult = history.payload as BattleCardReadResult<unknown>;
        expect((historyResult.data as unknown[]).length).toBe(2);
      }

      const context = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.context.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock },
        scope: { customer_id: 'cust-a' },
      });
      expect(context.status).toBe('SUCCESS');
      if (context.status === 'SUCCESS') {
        expect(context.payload).toEqual(await readCustomerBattleContext({ db: seeded.db, clock }, 'cust-a'));
        const contextResult = context.payload as BattleCardReadResult<{ current_stage_card?: { id: string }; card_history_count?: number }>;
        expect(contextResult.data.current_stage_card?.id).toBe('card-cust-a-NEW_LEAD-v1');
        expect(contextResult.data.card_history_count).toBe(2);
      }
    } finally {
      seeded.db.close();
    }
  });

  it('timeline / follow-up / task: real db.ts read paths through the unified surface, zero CRM writes', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    __setDbInstanceForTests(fixture.db);
    try {
      await fixture.db.execute(
        `INSERT INTO follow_up_records (id, customer_id, title, is_completed, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        ['fu-1', 'dg-a-jm', '首次电话跟进', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z'],
      );
      await fixture.db.execute(
        `INSERT INTO visit_records (id, customer_id, title, visited_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['visit-1', 'dg-a-jm', '上门拜访', '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z'],
      );
      await fixture.db.execute(
        `INSERT INTO tasks (id, customer_id, title, due_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['task-1', 'dg-a-jm', '准备报价', '2026-07-15T00:00:00.000Z', 'OPEN', '2026-07-12T00:00:00.000Z', '2026-07-12T00:00:00.000Z'],
      );

      // timeline.customer.read — 真实 db.listFollowUps + listVisits → buildCustomerTimeline
      const timeline = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'timeline.customer.read',
        capability_version: '1.0.0',
        input: {},
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(timeline.status).toBe('SUCCESS');
      if (timeline.status === 'SUCCESS') {
        expect(timeline.payload).toEqual(await readCustomerTimeline({ customer_id: 'dg-a-jm' }));
        const result = timeline.payload as { records: unknown[]; read_only: boolean; writes_crm: boolean };
        expect(result.read_only).toBe(true);
        expect(result.writes_crm).toBe(false);
        expect(result.records.length).toBe(2);
      }

      // timeline.visit.read — 真实 db.listVisits
      const visits = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'timeline.visit.read',
        capability_version: '1.0.0',
        input: {},
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(visits.status).toBe('SUCCESS');
      if (visits.status === 'SUCCESS') {
        expect(visits.payload).toEqual(await readCustomerVisits({ customer_id: 'dg-a-jm' }));
        expect((visits.payload as { records: unknown[] }).records).toHaveLength(1);
      }

      // follow_up.customer.read — 真实 db.listFollowUps（客户范围）
      const followUps = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'follow_up.customer.read',
        capability_version: '1.0.0',
        input: {},
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(followUps.status).toBe('SUCCESS');
      if (followUps.status === 'SUCCESS') {
        expect((followUps.payload as unknown[])).toHaveLength(1);
      }

      // follow_up.global.read — 真实 db.listAllFollowUps（GLOBAL，不要求 customer scope）
      const globalFollowUps = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'follow_up.global.read',
        capability_version: '1.0.0',
        input: {},
        scope: {},
      });
      expect(globalFollowUps.status).toBe('SUCCESS');
      if (globalFollowUps.status === 'SUCCESS') {
        expect((globalFollowUps.payload as unknown[]).length).toBeGreaterThanOrEqual(1);
      }

      // task.read_by_customer — 真实 db.listTasks + customer 过滤
      const tasks = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'task.read_by_customer',
        capability_version: '1.0.0',
        input: {},
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(tasks.status).toBe('SUCCESS');
      if (tasks.status === 'SUCCESS') {
        expect((tasks.payload as { customer_id: string }[])).toHaveLength(1);
        expect((tasks.payload as { customer_id: string }[])[0].customer_id).toBe('dg-a-jm');
      }
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('import.file.preview + import.mapping.validate: real product parser/validator, zero CRM writes', async () => {
    const file = makeXlsxFile();
    const preview = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'import.file.preview',
      capability_version: '1.0.0',
      input: file,
      scope: {},
    });
    expect(preview.status).toBe('SUCCESS');
    if (preview.status === 'SUCCESS') {
      expect(preview.payload).toEqual(await parseExcelFile(file));
      const result = preview.payload as { headers: string[]; rows: unknown[]; created_customer_id?: string };
      expect(result.headers).toEqual(['客户名称', '手机号', '城市', '意向']);
      expect(result.rows).toHaveLength(3);
      expect(result.created_customer_id).toBeUndefined();
    }

    const validate = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'import.mapping.validate',
      capability_version: '1.0.0',
      input: [
        { sourceColumn: '客户名称', crmField: 'name' },
        { sourceColumn: '手机号', crmField: 'phone_number' },
      ],
      scope: {},
    });
    expect(validate.status).toBe('SUCCESS');
    if (validate.status === 'SUCCESS') {
      expect((validate.payload as { valid: boolean; errors: readonly string[] })).toEqual({ valid: true, errors: [] });
    }
  });
});

/* ------------------------------------------------------------------ */
/* OBSERVATION SEAM                                                     */
/* ------------------------------------------------------------------ */

describe('OBSERVATION — W3-1 → W3-2 lifecycle seam (Closure 2)', () => {
  it('observer receives INVOCATION_STARTED → AUTHORITY_DECIDED → BEFORE_EXECUTION → OUTCOME in order for a successful run', async () => {
    const phases: string[] = [];
    const harness = makeSyntheticHarness();
    const engine = createCapabilityExecutionEngine({
      registry: harness.registry,
      bindings: harness.bindings,
      observer: {
        observe: (event) => {
          phases.push(`${event.phase}:${event.capability_id}`);
        },
      },
    });
    await engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { x: 1 }, scope: {} });
    expect(phases).toEqual([
      'INVOCATION_STARTED:fixture.executor.success',
      'AUTHORITY_DECIDED:fixture.executor.success',
      'BEFORE_EXECUTION:fixture.executor.success',
      'OUTCOME:fixture.executor.success',
    ]);
  });

  it('observer receives INVOCATION_STARTED + AUTHORITY_DECIDED + OUTCOME but no BEFORE_EXECUTION when confirmation is required', async () => {
    const phases: string[] = [];
    const harness = makeSyntheticHarness();
    const engine = createCapabilityExecutionEngine({
      registry: harness.registry,
      bindings: harness.bindings,
      observer: {
        observe: (event) => {
          phases.push(event.phase);
        },
      },
    });
    await engine.invoke({ capability_id: 'fixture.write.confirm', capability_version: '1.0.0', input: {}, scope: {} });
    expect(phases).toEqual(['INVOCATION_STARTED', 'AUTHORITY_DECIDED', 'OUTCOME']);
  });

  it('every observer event shares the invocation_id exposed by the outcome (one invocation → one identity)', async () => {
    const phases: Array<{ phase: string; invocation_id: string }> = [];
    const harness = makeSyntheticHarness();
    const engine = createCapabilityExecutionEngine({
      registry: harness.registry,
      bindings: harness.bindings,
      generateInvocationId: () => 'inv-seam-1',
      observer: {
        observe: (event) => {
          phases.push({ phase: event.phase, invocation_id: event.invocation_id });
        },
      },
    });
    const outcome = await engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { x: 1 }, scope: {} });
    expect(outcome.invocation_id).toBe('inv-seam-1');
    expect(phases.every((p) => p.invocation_id === 'inv-seam-1')).toBe(true);
    expect(phases).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/* SECURITY REVIEW（规格 §27）                                           */
/* ------------------------------------------------------------------ */

describe('SECURITY REVIEW — fail-closed execution surface', () => {
  it('no prototype pollution after hostile input attempts', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({
      capability_id: 'fixture.input.invalid',
      capability_version: '1.0.0',
      input: JSON.parse('{"__proto__":{"polluted":true},"value":7}') as { value: number },
      scope: {},
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect('polluted' in ({} as object)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('scope cannot be smuggled through input to bypass the customer-scope gate', async () => {
    // 输入携带 customer_id 也不能替代 invocation.scope（CUSTOMER 门控只看 scope）。
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context, customer_id: 'customer-2' },
      scope: {},
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_SCOPE');
    }
  });

  it('binding registry exposes no mutation surface (closure-captured, caller-safe)', () => {
    const harness = makeSyntheticHarness();
    expect(Object.keys(harness.bindings).sort()).toEqual(['resolve', 'size']);
    const before = harness.bindings.size();
    // 没有任何 register/bind/override/delete 方法可调用。
    expect((harness.bindings as unknown as { register?: unknown }).register).toBeUndefined();
    expect(harness.bindings.size()).toBe(before);
  });

  it('no eval / dynamic require / dynamic import / reflection in the execution layer', () => {
    const dir = resolve(process.cwd(), 'src/lib/capabilities/execution');
    for (const file of ['contract.ts', 'binding.ts', 'engine.ts', 'production.ts', 'index.ts']) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      expect(source, `${file} must not use eval/require/reflection`).not.toMatch(/\beval\s*\(|\brequire\s*\(|import\s*\(|Function\s*\(|Reflect\./);
    }
  });

  it('invoking the same capability twice never double-executes within one call', async () => {
    const harness = makeSyntheticHarness();
    await harness.engine.invoke({ capability_id: 'fixture.executor.success', capability_version: '1.0.0', input: { n: 1 }, scope: {} });
    expect(harness.callsFor('fixture.executor.success')).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* T21 — CUSTOMER SCOPE / INPUT MATCH（相干闭合）                        */
/* ------------------------------------------------------------------ */

describe('T21 — CUSTOMER SCOPE / INPUT MATCH: scope=A + executor-targeting customer=A is the normal valid path', () => {
  it('production customer.get: scope=customer-1 + input.customer_id=customer-1 → SUCCESS, reads customer-1', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context, customer_id: 'customer-1' },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      const result = outcome.payload as SalesAgentToolResult;
      expect(result.records.map((r) => (r as { id: string }).id)).toEqual(['customer-1']);
      // 与真实 adapter 直接调用一致（执行器生效客户 = scope）。
      expect(outcome.payload).toEqual(getCustomerRead({ customer_id: 'customer-1', snapshot, context }));
    }
  });

  it('synthetic engine-level: scope=A + input selector A → executor runs exactly once with effective A', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.scope.coherence',
      capability_version: '1.0.0',
      input: { customer_id: 'customer-A' },
      scope: { customer_id: 'customer-A' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect((outcome.payload as { effective_customer_id: string }).effective_customer_id).toBe('customer-A');
    }
    expect(harness.callsFor('fixture.executor.scope.coherence')).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* T22 — CUSTOMER SCOPE / INPUT MISMATCH（fail closed，调用数 = 0）       */
/* ------------------------------------------------------------------ */

describe('T22 — CUSTOMER SCOPE / INPUT MISMATCH: scope=A + input-targeting B fails before executor call', () => {
  it('production customer.get: scope=customer-1 + input.customer_id=customer-2 → INVALID_INPUT', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context, customer_id: 'customer-2' },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
      expect(outcome.message).toContain('contradicts invocation scope.customer_id');
    }
  });

  it('production customer.get: scope=customer-1 + input.customerId=customer-2 (alias spelling) → INVALID_INPUT', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context, customerId: 'customer-2' },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
  });

  it('production timeline.customer.read (no-arg contract): scope=dg-a-jm + input.customer_id=dg-c-other → INVALID_INPUT', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'timeline.customer.read',
      capability_version: '1.0.0',
      input: { customer_id: 'dg-c-other' },
      scope: { customer_id: 'dg-a-jm' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
  });

  it('production battle_card.current.read: scope=cust-a + input.customer_id=cust-b → INVALID_INPUT', async () => {
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'battle_card.current.read',
      capability_version: '1.0.0',
      input: { db: dbStub, customer_id: 'cust-b' },
      scope: { customer_id: 'cust-a' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
  });

  it('synthetic engine-level: scope=A + input selector B → INVALID_INPUT, MISMATCHED_EXECUTOR_CALL_COUNT=0', async () => {
    const harness = makeSyntheticHarness();
    const outcome = await harness.engine.invoke({
      capability_id: 'fixture.scope.coherence',
      capability_version: '1.0.0',
      input: { customer_id: 'customer-B' },
      scope: { customer_id: 'customer-A' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
    expect(harness.callsFor('fixture.executor.scope.coherence')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* T23 — ALL CUSTOMER CAPABILITY COHERENCE（由真实 manifest 推导）        */
/* ------------------------------------------------------------------ */

describe('T23 — ALL CUSTOMER CAPABILITY COHERENCE: every CUSTOMER-scoped production capability (16 = 9 original + 7 W3-3) has a truthful coherence model', () => {
  it('enumerates every scoped capability from the actual registry (20 = 13 original + 7 W3-3; CUSTOMER=16 / GLOBAL=2 / NONE=2)', () => {
    const customerScoped = PRODUCTION_CAPABILITY_REGISTRY.list()
      .filter((d) => d.scope_requirement === 'CUSTOMER')
      .map((d) => d.id);
    expect(customerScoped).toEqual([
      // 原 9 个 CUSTOMER 读能力（注册顺序不变）
      'customer.get',
      'customer.context',
      'timeline.customer.read',
      'timeline.visit.read',
      'follow_up.customer.read',
      'task.read_by_customer',
      'battle_card.current.read',
      'battle_card.history.read',
      'battle_card.context.read',
      // W3-3 7 个 CUSTOMER 写/草稿能力（全部 CUSTOMER 范围，禁止缺省全局写）
      'customer.next_follow_up_time.update',
      'follow_up.create',
      'task.create',
      'battle_card.draft.create',
      'battle_card.confirm',
      'battle_card.hypothesis.status.update',
      'battle_card.intelligence_import.confirm',
    ]);
    const globalScoped = PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.scope_requirement === 'GLOBAL').map((d) => d.id);
    const noneScoped = PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.scope_requirement === 'NONE').map((d) => d.id);
    expect(globalScoped).toEqual(['customer.search', 'follow_up.global.read']);
    expect(noneScoped).toEqual(['import.file.preview', 'import.mapping.validate']);
    expect(customerScoped.length + globalScoped.length + noneScoped.length).toBe(20);
    expect(customerScoped.length).toBe(16);
    // 7 个 W3-3 写全部 CUSTOMER 范围（W3-3 T17 的冻结语义在生产组合中保持）
    expect(customerScoped.filter((id) => WRITE_DRAFT_IDS.includes(id)).sort()).toEqual([...WRITE_DRAFT_IDS].sort());
  });

  it('every CUSTOMER-scoped capability fails closed on scope=A / input-targeting=B per its own input contract', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const dbStub: DatabaseLike = { execute: async () => ({ rowsAffected: 0 }), select: async () => [] };
    const adversarialInputs: Readonly<Record<string, unknown>> = {
      // 原 9 个 CUSTOMER 读能力
      'customer.get': { snapshot, context, customer_id: 'customer-2' },
      'customer.context': { snapshot, context, customer_id: 'customer-2' },
      'timeline.customer.read': { customer_id: 'customer-2' },
      'timeline.visit.read': { customer_id: 'customer-2' },
      'follow_up.customer.read': { customer_id: 'customer-2' },
      'task.read_by_customer': { customer_id: 'customer-2' },
      'battle_card.current.read': { db: dbStub, customer_id: 'customer-2' },
      'battle_card.history.read': { db: dbStub, customer_id: 'customer-2' },
      'battle_card.context.read': { db: dbStub, customer_id: 'customer-2' },
      // W3-3 7 个 CUSTOMER 写/草稿能力（scope=A + 输入选择器=B → 输入层 fail-closed）
      'customer.next_follow_up_time.update': { db: dbStub, next_follow_up_at: '2026-08-01T09:00:00.000Z', customer_id: 'customer-2' },
      'follow_up.create': { title: 'x', customer_id: 'customer-2' },
      'task.create': { title: 'x', customer_id: 'customer-2' },
      'battle_card.draft.create': { db: dbStub, stage_code: 'NEW_LEAD', customer_id: 'customer-2' },
      'battle_card.confirm': { db: dbStub, card_id: 'card-x', expected_version: 1, customer_id: 'customer-2' },
      'battle_card.hypothesis.status.update': { db: dbStub, hypothesis_id: 'hyp-x', new_status: 'CONFIRMED', expected_version: '2026-01-01T00:00:00.000Z', customer_id: 'customer-2' },
      'battle_card.intelligence_import.confirm': { db: dbStub, raw_content: 'x', customer_id: 'customer-2' },
    };
    for (const capabilityId of Object.keys(adversarialInputs)) {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: capabilityId,
        capability_version: '1.0.0',
        input: adversarialInputs[capabilityId],
        scope: { customer_id: 'customer-1' },
      });
      expect(outcome.status, `${capabilityId} must fail closed on scope/input mismatch`).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code, `${capabilityId} mismatch must fail in the input layer`).toBe('INVALID_INPUT');
        expect(outcome.message).toMatch(/customer/);
      }
    }
  });

  it('positive coherence: scope=A + clean input (no customer selector) executes with effective customer A', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      expect((outcome.payload as SalesAgentToolResult).records.map((r) => (r as { id: string }).id)).toEqual(['customer-1']);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T24 — NO INPUT SCOPE SMUGGLING                                       */
/* ------------------------------------------------------------------ */

describe('T24 — NO INPUT SCOPE SMUGGLING: unrecognized input fields cannot alter effective customer scope', () => {
  it('nested scope / nested context / arbitrary lookalike keys cannot override invocation.scope=A', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: {
        snapshot,
        context,
        scope: { customer_id: 'customer-2' },
        context_nested: { customer_id: 'customer-2' },
        arbitrary: { customer_id: 'customer-2' },
        list: [{ customer_id: 'customer-2' }],
      },
      scope: { customer_id: 'customer-1' },
    });
    // 非客户选择字段被丢弃/忽略：执行器生效客户仍然 = scope（customer-1）。
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') {
      const ids = (outcome.payload as SalesAgentToolResult).records.map((r) => (r as { id: string }).id);
      expect(ids).toEqual(['customer-1']);
      expect(ids).not.toContain('customer-2');
    }
  });

  it('a top-level customer selector contradiction is caught even when nested lookalikes are also present', async () => {
    const snapshot = snapshotFixture();
    const context = contextFixture(snapshot);
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: {
        snapshot,
        context,
        customer_id: 'customer-2',
        scope: { customer_id: 'customer-2' },
        nested: { customer_id: 'customer-2' },
      },
      scope: { customer_id: 'customer-1' },
    });
    expect(outcome.status).toBe('EXECUTION_ERROR');
    if (outcome.status === 'EXECUTION_ERROR') {
      expect(outcome.error_code).toBe('INVALID_INPUT');
    }
  });

  it('battleCard: nested lookalike keys cannot redirect the customer; top-level mismatch still fails', async () => {
    const seeded = await openMemoryDbWithCards();
    try {
      // 嵌套伪字段无法重定向：执行器仍读 cust-a。
      const ok = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.current.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock, nested: { customer_id: 'cust-b' }, scope: { customer_id: 'cust-b' } },
        scope: { customer_id: 'cust-a' },
      });
      expect(ok.status).toBe('SUCCESS');
      if (ok.status === 'SUCCESS') {
        const result = ok.payload as BattleCardReadResult<{ id?: string; customer_id?: string }>;
        expect(result.data?.id).toBe('card-cust-a-NEW_LEAD-v1');
        expect(result.data?.customer_id).toBe('cust-a');
      }
      // 顶层客户选择字段反驳 scope → fail closed。
      const bad = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.current.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock, customer_id: 'cust-b' },
        scope: { customer_id: 'cust-a' },
      });
      expect(bad.status).toBe('EXECUTION_ERROR');
      if (bad.status === 'EXECUTION_ERROR') {
        expect(bad.error_code).toBe('INVALID_INPUT');
      }
    } finally {
      seeded.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T25 — GLOBAL UNAFFECTED                                              */
/* ------------------------------------------------------------------ */

describe('T25 — GLOBAL UNAFFECTED: GLOBAL capabilities stay global, no artificial customer scope', () => {
  it('customer.search (GLOBAL) executes with empty scope through the real SQLite path', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.search',
        capability_version: '1.0.0',
        input: { filters: { region: '东莞' }, list_kind: 'portfolio', db: fixture.db },
        scope: {},
      });
      expect(outcome.status).toBe('SUCCESS');
      if (outcome.status === 'SUCCESS') {
        expect((outcome.payload as SearchCustomersResult).candidates.map((c) => c.id).sort()).toEqual(['dg-a-jm', 'dg-c-other']);
      }
    } finally {
      fixture.close();
    }
  });

  it('follow_up.global.read (GLOBAL) executes with empty scope', async () => {
    const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'follow_up.global.read',
      capability_version: '1.0.0',
      input: {},
      scope: {},
    });
    expect(outcome.status).toBe('SUCCESS');
  });
});

/* ------------------------------------------------------------------ */
/* T26 — NONE UNAFFECTED                                                */
/* ------------------------------------------------------------------ */

describe('T26 — NONE UNAFFECTED: NONE-scoped Import capabilities stay NONE-scoped', () => {
  it('import.file.preview + import.mapping.validate execute with empty scope (no artificial customer scope)', async () => {
    const preview = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'import.file.preview',
      capability_version: '1.0.0',
      input: makeXlsxFile(),
      scope: {},
    });
    expect(preview.status).toBe('SUCCESS');
    const validate = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'import.mapping.validate',
      capability_version: '1.0.0',
      input: [{ sourceColumn: '客户名称', crmField: 'name' }],
      scope: {},
    });
    expect(validate.status).toBe('SUCCESS');
  });
});

/* ------------------------------------------------------------------ */
/* REAL PRODUCT ADVERSARIAL — 双客户真实路径证据（规格 §10）              */
/* ------------------------------------------------------------------ */

describe('REAL PRODUCT ADVERSARIAL — scope=A never returns B and never invokes B-target behavior', () => {
  it('customer.get: scope=customer-1 returns only customer-1; scope=customer-1 + input-target customer-2 fails before execution', async () => {
    const snapshot = snapshotFixture(); // 两个真实客户：customer-1 (Ada) / customer-2 (Ben)
    const context = contextFixture(snapshot);

    const ok = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(ok.status).toBe('SUCCESS');
    if (ok.status === 'SUCCESS') {
      const ids = (ok.payload as SalesAgentToolResult).records.map((r) => (r as { id: string }).id);
      expect(ids).toEqual(['customer-1']);
      expect(ids).not.toContain('customer-2');
      // 同一次执行绝不混合另一个客户的数据。
      expect((ok.payload as SalesAgentToolResult).records.every((r) => (r as { id: string }).id === 'customer-1')).toBe(true);
    }

    const bad = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot, context, customer_id: 'customer-2' },
      scope: { customer_id: 'customer-1' },
    });
    expect(bad.status).toBe('EXECUTION_ERROR');
    if (bad.status === 'EXECUTION_ERROR') {
      expect(bad.error_code).toBe('INVALID_INPUT');
    }
  });

  it('timeline.customer.read: scope=dg-a-jm reads only dg-a-jm records; mismatch executes ZERO SELECTs (spy db)', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    __setDbInstanceForTests(fixture.db);
    try {
      await fixture.db.execute(
        `INSERT INTO follow_up_records (id, customer_id, title, is_completed, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
        ['fu-a', 'dg-a-jm', 'A 的跟进', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z'],
      );
      await fixture.db.execute(
        `INSERT INTO follow_up_records (id, customer_id, title, is_completed, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
        ['fu-b', 'dg-c-other', 'B 的跟进', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z'],
      );

      let selectCount = 0;
      const spyDb: DatabaseLike = {
        execute: async (sql: string, bindings: unknown[] = []) => fixture.db.execute(sql, bindings),
        select: async <T>(sql: string, bindings: unknown[] = []) => {
          selectCount += 1;
          return fixture.db.select<T>(sql, bindings);
        },
      };
      __setDbInstanceForTests(spyDb);

      // 干净路径：scope=dg-a-jm → 只读 dg-a-jm 的数据（真实 SQLite SELECT）。
      const ok = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'timeline.customer.read',
        capability_version: '1.0.0',
        input: {},
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(ok.status).toBe('SUCCESS');
      if (ok.status === 'SUCCESS') {
        const result = ok.payload as { customer_id: string; records: readonly { evidenceId: string }[] };
        expect(result.customer_id).toBe('dg-a-jm');
        expect(result.records.length).toBe(1);
        // 只包含 dg-a-jm 的跟进（fu-a）；绝不包含另一客户 dg-c-other 的 fu-b。
        expect(result.records.map((r) => r.evidenceId)).toEqual(['fu-a']);
        expect(result.records.map((r) => r.evidenceId)).not.toContain('fu-b');
      }
      const selectsAfterOk = selectCount;
      expect(selectsAfterOk).toBeGreaterThan(0);

      // 对抗路径：scope=dg-a-jm + input.customer_id=dg-c-other → 执行前失败，零新增 SELECT。
      const bad = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'timeline.customer.read',
        capability_version: '1.0.0',
        input: { customer_id: 'dg-c-other' },
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(bad.status).toBe('EXECUTION_ERROR');
      if (bad.status === 'EXECUTION_ERROR') {
        expect(bad.error_code).toBe('INVALID_INPUT');
      }
      expect(selectCount).toBe(selectsAfterOk);
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });

  it('battle_card.current.read: scope=cust-a returns only the cust-a card; mismatch fails before execution', async () => {
    const seeded = await openMemoryDbWithCards();
    try {
      const ok = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.current.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock },
        scope: { customer_id: 'cust-a' },
      });
      expect(ok.status).toBe('SUCCESS');
      if (ok.status === 'SUCCESS') {
        const result = ok.payload as BattleCardReadResult<{ id?: string; customer_id?: string }>;
        expect(result.data?.id).toBe('card-cust-a-NEW_LEAD-v1');
        expect(result.data?.customer_id).toBe('cust-a');
        expect(result.data?.id).not.toMatch(/cust-b/);
      }

      const bad = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.current.read',
        capability_version: '1.0.0',
        input: { db: seeded.db, clock, customer_id: 'cust-b' },
        scope: { customer_id: 'cust-a' },
      });
      expect(bad.status).toBe('EXECUTION_ERROR');
      if (bad.status === 'EXECUTION_ERROR') {
        expect(bad.error_code).toBe('INVALID_INPUT');
      }
    } finally {
      seeded.db.close();
    }
  });
});
