/**
 * V0.2A / W3-1 Closure 1 — Capability Write Production Integration 契约测试。
 *
 * 证明七个 W3-3 写/草稿/状态迁移能力成为 W3-1 生产执行基础的真实成员：
 *   T1  PRODUCTION REGISTRY 24            T2  ZERO DUPLICATES
 *   T3  PRODUCTION BINDINGS 24            T4  ZERO UNBOUND
 *   T5  WRITE AUTHORITY MATRIX            T6  CONFIRMATION WRITE DOES NOT EXECUTE
 *   T7  STRONG CONFIRMATION DOES NOT EXECUTE
 *   T8  AUTO DRAFT EXECUTES ONLY ITSELF   T9  FOLLOW-UP CREATE BINDING TRUTH
 *   T10 TASK CREATE BINDING TRUTH         T11 NARROW CUSTOMER UPDATE
 *   T12 BATTLE CARD CONFIRM BINDING TRUTH T13 HYPOTHESIS STATUS UPDATE TRUTH
 *   T14 INTELLIGENCE IMPORT CONFIRM TRUTH T15 INPUT VALIDATORS
 *   T16 CUSTOMER SCOPE REQUIRED           T17 CUSTOMER SCOPE / INPUT MATCH
 *   T18 CUSTOMER SCOPE / INPUT MISMATCH   T19 CROSS-CUSTOMER WRITE PROTECTION
 *   T20 CONFIRMATION HANDOFF EXISTS       T21 CONFIRMATION HANDOFF DOES NOT BYPASS HUMAN
 *   T22 EXISTING CONFIRMED RUNTIME REUSED T23 NO OBSERVATION WIRING
 *   T24 NO WAVE 4                         T25 CURRENT 13 REGRESSION
 *   T26 AUTHORITY CANNOT BE BYPASSED
 *
 * 原则：
 * - 只使用测试 DB / 隔离 fixture，绝不触碰真实用户 CRM 数据。
 * - 统一执行全部经 PRODUCTION_CAPABILITY_EXECUTION（Registry → Input → Scope → A10 →
 *   Execute / 确认交接）；"业务执行器调用数"用计数 harness 在绑定层测量（不修改生产）。
 * - 确认类能力：先证明业务执行器调用数 = 0、DB 状态不变；再经**现有**产品确认流
 *   （SalesAgentSession.confirmWriteByRef / battleCardClient.confirmProposal 同构路径）
 *   走 POST_CONFIRM 真实执行器，证明绑定真值。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import {
  createCapabilityBindingRegistry,
  createCapabilityExecutionEngine,
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
import {
  BATTLE_CARD_CONFIRMATION_MECHANISM,
  PRODUCTION_WRITE_BINDINGS,
  SALES_AGENT_CONFIRMATION_MECHANISM,
} from '../lib/capabilities/execution/writeAdapters';
import { evaluateAuthorityPolicy } from '../lib/capabilities/authority';
import type { CapabilityDefinition } from '../lib/capabilities/types';

import { __setDbInstanceForTests, initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { openSalesAgentSqliteFixture } from './salesAgentFunctionalFixture';
import { createBattleCardRepositories, type BattleCardRepositories } from '../lib/battleCard/repository';
import { BATTLE_CARD_SCHEMA_VERSION } from '../lib/battleCard/schema';
import type { BattleCardPayload, CustomerStageCardInput, HypothesisStatus } from '../lib/battleCard/types';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { approvedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { getCanonicalProposal, __resetSessionWriteStateStoreForTests } from '../lib/salesAgentTools/sessionWriteStateStore';
import { SALES_AGENT_APP_CLOCK } from '../lib/salesAgentTools/appClock';
import type { AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';

const NOW = '2026-07-14T12:00:00.000Z';
const BC_NOW = '2026-08-01T12:00:00.000Z';
const clock = () => BC_NOW;

const INTEL_FIXTURE_PATH = resolve(process.cwd(), 'src/__tests__/fixtures/battle-card/guangzhou-dianxiu-appendix-a-raw.txt');

/* ------------------------------------------------------------------ */
/* 内存 Battle Card DB（真实 schema + 双客户卡片 + 假设种子）             */
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

beforeEach(() => {
  __resetSessionWriteStateStoreForTests();
});

afterEach(() => {
  __setDbInstanceForTests(null);
  memoryDb?.close();
  memoryDb = null;
});

async function openMemoryDbWithCards(): Promise<SeededDb> {
  const sqlite = new Database(':memory:');
  const db = new SqliteDatabaseLike(sqlite);
  await initializeDatabaseSchema(db);
  for (const customer of [
    { id: 'cust-a', name: '客户甲', grade: 'A', stage: 'NEW_LEAD', intent: 'HIGH' },
    { id: 'cust-b', name: '客户乙', grade: 'B', stage: 'CONTACTED', intent: 'MEDIUM' },
  ]) {
    await db.execute(
      `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, last_contacted_at, next_action, battle_card_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customer.id, customer.name, customer.grade, customer.stage, customer.intent, null, null, null, 'CONFIRMED', BC_NOW, BC_NOW],
    );
  }
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
  const cardA2 = await insertCard('cust-a', 'NEW_LEAD', 2, 'DRAFT');
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

  // 每个客户一条 PENDING 假设（供 hypothesis.status.update 测试）。
  await db.execute(
    `INSERT INTO customer_hypotheses (id, customer_id, source_import_id, category, statement, rationale, status, applicability, why_it_matters, validation_question, disconfirm_condition, evidence_refs_json, status_audit_json, created_at, updated_at)
     VALUES (?, ?, NULL, 'market', ?, NULL, 'PENDING', 'CONDITIONAL', NULL, NULL, NULL, '[]', '[]', ?, ?)`,
    ['hyp-a-1', 'cust-a', '客户甲假设：关键决策人是采购负责人', BC_NOW, BC_NOW],
  );
  await db.execute(
    `INSERT INTO customer_hypotheses (id, customer_id, source_import_id, category, statement, rationale, status, applicability, why_it_matters, validation_question, disconfirm_condition, evidence_refs_json, status_audit_json, created_at, updated_at)
     VALUES (?, ?, NULL, 'market', ?, NULL, 'PENDING', 'CONDITIONAL', NULL, NULL, NULL, '[]', '[]', ?, ?)`,
    ['hyp-b-1', 'cust-b', '客户乙假设：客户乙的决策链很短', BC_NOW, BC_NOW],
  );

  memoryDb = db;
  return { db, repos };
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

function invoke(engine: { invoke: (invocation: CapabilityInvocation) => Promise<CapabilityExecutionOutcome> }, invocation: CapabilityInvocation) {
  return engine.invoke(invocation);
}

/* ------------------------------------------------------------------ */
/* T1 — PRODUCTION REGISTRY 24                                          */
/* ------------------------------------------------------------------ */

describe('T1 — PRODUCTION REGISTRY 25: production registry contains exactly all frozen 25 capabilities', () => {
  it('registry count is 25 and IDs match the frozen set (13 read + 7 W3-3 write + 1 W4-1 customer.create + 1 W4-2 customer.profile.update + 1 W4-4 customer.delete + 1 W4-3 visit.create + 1 C0 customer.opportunity_amount.update)', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(25);
    expect(PRODUCTION_CAPABILITY_REGISTRY.size()).toBe(25);
    expect(PRODUCTION_CAPABILITY_IDS).toEqual([
      // Wave1/Wave2 读 13
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
      // W3-3 写 7
      'customer.next_follow_up_time.update',
      'follow_up.create',
      'task.create',
      'battle_card.draft.create',
      'battle_card.confirm',
      'battle_card.hypothesis.status.update',
      'battle_card.intelligence_import.confirm',
      // W4-1 新增 1（唯一新身份；customer.create）
      'customer.create',
      // W4-2 新增 1（唯一新身份；customer.profile.update）
      'customer.profile.update',
      // W4-4 新增 1（唯一新身份；customer.delete）
      'customer.delete',
      // W4-3 新增 1（唯一新身份；visit.create）
      'visit.create',
      // C0 新增 1（唯一新身份；customer.opportunity_amount.update）
      'customer.opportunity_amount.update',
    ]);
  });

  it('every frozen W3-3 write identity + W4-1 + W4-2 + W4-4 + W4-3 + C0 resolves with the frozen version 1.0.0', () => {
    for (const id of [
      'follow_up.create',
      'task.create',
      'customer.next_follow_up_time.update',
      'battle_card.draft.create',
      'battle_card.confirm',
      'battle_card.hypothesis.status.update',
      'battle_card.intelligence_import.confirm',
      'customer.create',
      'customer.profile.update',
      'customer.delete',
      'visit.create',
      'customer.opportunity_amount.update',
    ]) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      expect(definition.id).toBe(id);
      expect(definition.version).toBe('1.0.0');
    }
  });
});

/* ------------------------------------------------------------------ */
/* T2 — ZERO DUPLICATES                                                 */
/* ------------------------------------------------------------------ */

describe('T2 — ZERO DUPLICATES: no duplicate id+version in the production registry', () => {
  it('all identity keys are unique', () => {
    const keys = PRODUCTION_CAPABILITY_REGISTRY.list().map((d) => `${d.id}@${d.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(25);
  });
});

/* ------------------------------------------------------------------ */
/* T3 — PRODUCTION BINDINGS 25                                          */
/* ------------------------------------------------------------------ */

describe('T3 — PRODUCTION BINDINGS 25: all 25 executor_ref values resolve', () => {
  it('binding count is 25 and every registered executor_ref resolves exactly once', () => {
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(25);
    expect(PRODUCTION_CAPABILITY_BINDING_REGISTRY.size()).toBe(25);
    for (const definition of PRODUCTION_CAPABILITY_REGISTRY.list()) {
      const binding = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref);
      expect(binding, `executor_ref ${definition.executor_ref} of ${definition.id} must be bound`).toBeDefined();
      expect(binding?.executor_ref).toBe(definition.executor_ref);
    }
  });

  it('the twelve write/destructive bindings are the frozen executor_ref identities', () => {
    expect(PRODUCTION_WRITE_BINDINGS.map((b) => b.executor_ref)).toEqual([
      'salesAgentWriteTool:create_follow_up_record',
      'salesAgentWriteTool:create_task',
      'salesAgentWriteTool:update_next_follow_up_time',
      'salesAgentWriteTool:create_customer',
      'salesAgentWriteTool:update_customer_profile',
      'salesAgentWriteTool:update_opportunity_amount',
      'salesAgentWriteTool:delete_customer',
      'salesAgentWriteTool:create_visit_record',
      'battleCard:generateStageCardDraft',
      'battleCard:confirmStageCard',
      'battleCard:updateHypothesisStatus',
      'battleCard:confirmIntelligenceImport',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* T4 — ZERO UNBOUND                                                    */
/* ------------------------------------------------------------------ */

describe('T4 — ZERO UNBOUND: no declared production capability is unbound', () => {
  it('every production capability has a resolveable executor binding', () => {
    const unbound: string[] = [];
    for (const definition of PRODUCTION_CAPABILITY_REGISTRY.list()) {
      if (PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve(definition.executor_ref) === undefined) {
        unbound.push(definition.id);
      }
    }
    expect(unbound).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* T5 — WRITE AUTHORITY MATRIX                                          */
/* ------------------------------------------------------------------ */

describe('T5 — WRITE AUTHORITY MATRIX: all 11 write/destructive definitions produce their frozen A10 decisions', () => {
  const EXPECTED: Readonly<Record<string, { effect: string; risk: string; authority: string; requiresConfirmation: boolean; decision: string; reason: string }>> = {
    // A10 楼层 6（requires_confirmation=true）先于 POLICY_CONTROLLED 分支 → EXPLICIT_CONFIRMATION_REQUIRED。
    'follow_up.create': { effect: 'WRITE', risk: 'LOW', authority: 'POLICY_CONTROLLED', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    'task.create': { effect: 'WRITE', risk: 'LOW', authority: 'POLICY_CONTROLLED', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    'customer.next_follow_up_time.update': { effect: 'WRITE', risk: 'MEDIUM', authority: 'CONFIRM', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    'customer.create': { effect: 'WRITE', risk: 'MEDIUM', authority: 'POLICY_CONTROLLED', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    'customer.profile.update': { effect: 'WRITE', risk: 'MEDIUM', authority: 'POLICY_CONTROLLED', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    'visit.create': { effect: 'WRITE', risk: 'MEDIUM', authority: 'POLICY_CONTROLLED', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    // customer.delete：effect=DELETE → 楼层 3 先于 STRONG_CONFIRM → REQUIRE_STRONG_CONFIRMATION。
    'customer.delete': { effect: 'DELETE', risk: 'DESTRUCTIVE', authority: 'STRONG_CONFIRM', requiresConfirmation: true, decision: 'REQUIRE_STRONG_CONFIRMATION', reason: 'DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL' },
    'battle_card.draft.create': { effect: 'DRAFT', risk: 'LOW', authority: 'AUTO', requiresConfirmation: false, decision: 'ALLOW_AUTO', reason: 'AUTO_ALLOWED' },
    'battle_card.confirm': { effect: 'WRITE', risk: 'HIGH', authority: 'CONFIRM', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    'battle_card.hypothesis.status.update': { effect: 'WRITE', risk: 'MEDIUM', authority: 'CONFIRM', requiresConfirmation: true, decision: 'REQUIRE_CONFIRMATION', reason: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    'battle_card.intelligence_import.confirm': { effect: 'BULK_WRITE', risk: 'HIGH', authority: 'STRONG_CONFIRM', requiresConfirmation: true, decision: 'REQUIRE_STRONG_CONFIRMATION', reason: 'DESTRUCTIVE_EFFECT_REQUIRES_STRONG_CONTROL' },
  };

  it('A10 decisions and frozen metadata match the W3-3/W4-1/W4-2/W4-4/W4-3 manifests', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get(id, '1.0.0');
      expect(definition.effect).toBe(expected.effect);
      expect(definition.risk_level).toBe(expected.risk);
      expect(definition.authority_policy).toBe(expected.authority);
      expect(definition.requires_confirmation).toBe(expected.requiresConfirmation);
      const decision = evaluateAuthorityPolicy(definition);
      expect(decision.decision, id).toBe(expected.decision);
      expect(decision.reason_code, id).toBe(expected.reason);
      expect(decision.autonomous_allowed).toBe(expected.decision === 'ALLOW_AUTO');
    }
  });

  it('only battle_card.draft.create is AUTO among the eleven writes', () => {
    const auto = PRODUCTION_WRITE_BINDINGS
      .map((b) => PRODUCTION_CAPABILITY_REGISTRY.list().find((d) => d.executor_ref === b.executor_ref))
      .filter((d): d is CapabilityDefinition => d !== undefined)
      .filter((d) => evaluateAuthorityPolicy(d).decision === 'ALLOW_AUTO')
      .map((d) => d.id);
    expect(auto).toEqual(['battle_card.draft.create']);
  });
});

/* ------------------------------------------------------------------ */
/* T6/T7 — CONFIRMATION / STRONG CONFIRMATION WRITES DO NOT EXECUTE     */
/* ------------------------------------------------------------------ */

describe('T6/T7 — CONFIRMATION WRITES DO NOT EXECUTE: business executor call count = 0 before human confirmation', () => {
  it('REQUIRE_CONFIRMATION writes return the structured outcome and never invoke the business executor', async () => {
    const harness = makeWriteCountingHarness();
    const salesFixture = await openSalesAgentSqliteFixture();
    const bc = await openMemoryDbWithCards();
    try {
      const confirmCases: CapabilityInvocation[] = [
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: '跟进' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: '准备报价' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { db: salesFixture.db, next_follow_up_at: '2026-08-10T09:00:00.000Z' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: '新客户' }, scope: {} },
        { capability_id: 'battle_card.confirm', capability_version: '1.0.0', input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2 }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: BC_NOW }, scope: { customer_id: 'cust-a' } },
      ];
      for (const invocation of confirmCases) {
        const outcome = await invoke(harness.engine, invocation);
        expect(outcome.status, `${invocation.capability_id} must be confirmation-required`).toBe('CONFIRMATION_REQUIRED');
        const definition = PRODUCTION_CAPABILITY_REGISTRY.get(invocation.capability_id, invocation.capability_version);
        expect(harness.callsFor(definition.executor_ref), `${invocation.capability_id} business executor must not run`).toBe(0);
      }
    } finally {
      salesFixture.close();
      bc.db.close();
    }
  });

  it('REQUIRE_STRONG_CONFIRMATION (intelligence import) returns STRONG outcome and never invokes the business executor', async () => {
    const harness = makeWriteCountingHarness();
    const bc = await openMemoryDbWithCards();
    try {
      const raw = readFileSync(INTEL_FIXTURE_PATH, 'utf8');
      const outcome = await invoke(harness.engine, {
        capability_id: 'battle_card.intelligence_import.confirm',
        capability_version: '1.0.0',
        input: { db: bc.db, raw_content: raw },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      const definition = PRODUCTION_CAPABILITY_REGISTRY.get('battle_card.intelligence_import.confirm', '1.0.0');
      expect(harness.callsFor(definition.executor_ref)).toBe(0);
    } finally {
      bc.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T8 — AUTO DRAFT EXECUTES ONLY ITSELF                                 */
/* ------------------------------------------------------------------ */

describe('T8 — AUTO DRAFT EXECUTES ONLY ITSELF: battle_card.draft.create runs exactly once with append-only DRAFT semantics', () => {
  it('produces exactly one new DRAFT row; never confirms; never changes current_stage_card_id', async () => {
    const seeded = await openMemoryDbWithCards();
    try {
      const before = await seeded.db.select<{ id: string; card_status: string }>('SELECT id, card_status FROM customer_stage_cards WHERE customer_id = ?', ['cust-a']);
      expect(before).toHaveLength(2);
      const beforeCustomer = (await seeded.db.select<{ current_stage_card_id: string | null; battle_card_status: string | null }>('SELECT current_stage_card_id, battle_card_status FROM customers WHERE id = ?', ['cust-a']))[0];
      expect(beforeCustomer?.current_stage_card_id).toBe('card-cust-a-NEW_LEAD-v1');

      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.draft.create',
        capability_version: '1.0.0',
        input: { db: seeded.db, stage_code: 'NEW_LEAD' },
        scope: { customer_id: 'cust-a' },
      });

      expect(outcome.status).toBe('SUCCESS');
      if (outcome.status === 'SUCCESS') {
        expect(outcome.authority_decision.decision).toBe('ALLOW_AUTO');
        const card = outcome.payload as { id: string; customer_id: string; card_status: string; stage_code: string };
        expect(card.card_status).toBe('DRAFT');
        expect(card.customer_id).toBe('cust-a');
        expect(card.stage_code).toBe('NEW_LEAD');
      }

      const after = await seeded.db.select<{ id: string; card_status: string }>('SELECT id, card_status FROM customer_stage_cards WHERE customer_id = ? ORDER BY version ASC', ['cust-a']);
      expect(after).toHaveLength(3); // 恰好新增一行
      const newRows = after.filter((row) => !before.some((oldRow) => oldRow.id === row.id));
      expect(newRows).toHaveLength(1);
      expect(newRows[0]?.card_status).toBe('DRAFT'); // append-only DRAFT
      const confirmedCount = after.filter((row) => row.card_status === 'CONFIRMED').length;
      expect(confirmedCount).toBe(1); // 只有原有 v1 是 CONFIRMED；未确认任何卡
      const afterCustomer = (await seeded.db.select<{ current_stage_card_id: string | null; battle_card_status: string | null }>('SELECT current_stage_card_id, battle_card_status FROM customers WHERE id = ?', ['cust-a']))[0];
      expect(afterCustomer?.current_stage_card_id).toBe('card-cust-a-NEW_LEAD-v1'); // 指针未变（未确认）
      expect(afterCustomer?.battle_card_status).toBe('DRAFT'); // 草稿指示器按产品语义更新
    } finally {
      seeded.db.close();
    }
  });

  it('draft binding never routes to confirm or hypothesis executors (executor identity separation)', () => {
    const draft = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve('battleCard:generateStageCardDraft');
    const confirm = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve('battleCard:confirmStageCard');
    const hypothesis = PRODUCTION_CAPABILITY_BINDING_REGISTRY.resolve('battleCard:updateHypothesisStatus');
    expect(draft?.execute).not.toBe(confirm?.execute);
    expect(draft?.execute).not.toBe(hypothesis?.execute);
  });
});

/* ------------------------------------------------------------------ */
/* 确认类绑定真值：handoff → 现有确认流 → 真实 POST_CONFIRM 执行器         */
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

describe('T9 — FOLLOW-UP CREATE BINDING TRUTH: handoff registers the real proposal; post-confirm existing executor creates the follow-up row', () => {
  it('pre-confirm DB unchanged; existing confirmWriteByRef flow creates exactly one follow_up_records row for the scope customer', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    __setDbInstanceForTests(fixture.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'follow_up.create',
        capability_version: '1.0.0',
        input: { title: '确认后的跟进记录', feedback_notes: '客户反馈良好', next_follow_up_at: '2026-08-05T09:00:00.000Z' },
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        expect(outcome.confirmation_handoff?.mechanism).toBe(SALES_AGENT_CONFIRMATION_MECHANISM);
        expect(outcome.confirmation_handoff?.proposal_id).toBeTruthy();
      }
      // 业务执行器调用数 = 0（统一执行路径不产生任何写入）
      const before = await fixture.db.select<{ id: string }>('SELECT id FROM follow_up_records WHERE customer_id = ?', ['dg-a-jm']);
      expect(before).toHaveLength(0);

      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff.proposal_id, 'dg-a-jm');
      expect(proposal).not.toBeNull();
      expect(proposal?.tool_id).toBe('create_follow_up_record');
      expect(proposal?.customer_id).toBe('dg-a-jm');
      expect(proposal?.proposed_values.title).toBe('确认后的跟进记录');
      expect(proposal?.proposed_values.feedback_notes).toBe('客户反馈良好');

      // POST_CONFIRM：现有产品确认流（consumeExactConfirmation → approvedCrmWriteBoundary → db.createFollowUp）
      const result = await confirmViaExistingFlow(proposal!);
      expect(result.fields).toEqual(['title', 'feedback_notes', 'next_follow_up_at']);
      const after = await fixture.db.select<{ id: string; title: string; customer_id: string }>('SELECT id, title, customer_id FROM follow_up_records WHERE customer_id = ?', ['dg-a-jm']);
      expect(after).toHaveLength(1);
      expect(after[0]?.customer_id).toBe('dg-a-jm');
      expect(after[0]?.title).toBe('确认后的跟进记录');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

describe('T10 — TASK CREATE BINDING TRUTH: post-confirm existing executor creates the task row', () => {
  it('pre-confirm DB unchanged; confirmWriteByRef creates exactly one tasks row with status OPEN', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    __setDbInstanceForTests(fixture.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'task.create',
        capability_version: '1.0.0',
        input: { title: '准备客户报价', due_at: '2026-07-20T00:00:00.000Z' },
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const before = await fixture.db.select<{ id: string }>('SELECT id FROM tasks WHERE customer_id = ?', ['dg-a-jm']);
      expect(before).toHaveLength(0);

      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff.proposal_id, 'dg-a-jm');
      expect(proposal?.tool_id).toBe('create_task');
      expect(proposal?.proposed_values.status).toBe('OPEN');
      expect(proposal?.proposed_values.title).toBe('准备客户报价');

      await confirmViaExistingFlow(proposal!);
      const after = await fixture.db.select<{ id: string; title: string; customer_id: string; status: string }>('SELECT id, title, customer_id, status FROM tasks WHERE customer_id = ?', ['dg-a-jm']);
      expect(after).toHaveLength(1);
      expect(after[0]?.customer_id).toBe('dg-a-jm');
      expect(after[0]?.status).toBe('OPEN');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

describe('T11 — NARROW CUSTOMER UPDATE: customer.next_follow_up_time.update mutates only next_follow_up_at', () => {
  it('proposal carries only next_follow_up_at; post-confirm changes only the scheduling field', async () => {
    const fixture = await openSalesAgentSqliteFixture();
    __setDbInstanceForTests(fixture.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'customer.next_follow_up_time.update',
        capability_version: '1.0.0',
        input: { db: fixture.db, next_follow_up_at: '2026-08-10T09:00:00.000Z' },
        scope: { customer_id: 'dg-a-jm' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff.proposal_id, 'dg-a-jm');
      expect(proposal).not.toBeNull();
      expect(proposal?.proposed_values).toEqual({ next_follow_up_at: '2026-08-10T09:00:00.000Z' }); // 窄语义：唯一字段
      expect(proposal?.current_values).toHaveProperty('next_follow_up_at'); // 携带当前存储值

      await confirmViaExistingFlow(proposal!);
      const customer = (await fixture.db.select<{ next_follow_up_at: string | null; name: string; stage: string; customer_grade: string }>('SELECT next_follow_up_at, name, stage, customer_grade FROM customers WHERE id = ?', ['dg-a-jm']))[0];
      expect(customer?.next_follow_up_at).toBe('2026-08-10T09:00:00.000Z');
      expect(customer?.name).toBe('东莞 JM 新能源科技有限公司'); // 其它字段不变
      expect(customer?.stage).toBe('CONTACTED');
      expect(customer?.customer_grade).toBe('A');
    } finally {
      __setDbInstanceForTests(null);
      fixture.close();
    }
  });
});

describe('T12 — BATTLE CARD CONFIRM BINDING TRUTH: handoff → existing confirm flow → DRAFT→CONFIRMED + canonical pointer update', () => {
  it('pre-confirm card stays DRAFT; post-confirm confirms exactly the target card and updates current_stage_card_id', async () => {
    const seeded = await openMemoryDbWithCards();
    __setDbInstanceForTests(seeded.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.confirm',
        capability_version: '1.0.0',
        input: { db: seeded.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2 },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        expect(outcome.confirmation_handoff?.mechanism).toBe(BATTLE_CARD_CONFIRMATION_MECHANISM);
      }
      const pre = (await seeded.db.select<{ card_status: string }>('SELECT card_status FROM customer_stage_cards WHERE id = ?', ['card-cust-a-NEW_LEAD-v2']))[0];
      expect(pre?.card_status).toBe('DRAFT'); // 确认前无业务变更

      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff.proposal_id, 'cust-a');
      expect(proposal?.tool_id).toBe('confirm_stage_card');
      expect(proposal?.proposed_values.card_id).toBe('card-cust-a-NEW_LEAD-v2');

      await confirmViaExistingFlow(proposal!);
      const post = (await seeded.db.select<{ card_status: string }>('SELECT card_status FROM customer_stage_cards WHERE id = ?', ['card-cust-a-NEW_LEAD-v2']))[0];
      expect(post?.card_status).toBe('CONFIRMED');
      const customer = (await seeded.db.select<{ current_stage_card_id: string | null }>('SELECT current_stage_card_id FROM customers WHERE id = ?', ['cust-a']))[0];
      expect(customer?.current_stage_card_id).toBe('card-cust-a-NEW_LEAD-v2');
      // 其它客户不受影响
      const other = (await seeded.db.select<{ current_stage_card_id: string | null }>('SELECT current_stage_card_id FROM customers WHERE id = ?', ['cust-b']))[0];
      expect(other?.current_stage_card_id).toBe('card-cust-b-CONTACTED-v1');
    } finally {
      __setDbInstanceForTests(null);
      seeded.db.close();
    }
  });
});

describe('T13 — HYPOTHESIS STATUS UPDATE TRUTH: only the real status transition semantic runs post-confirm', () => {
  it('pre-confirm hypothesis unchanged; post-confirm status transitions with append-only audit', async () => {
    const seeded = await openMemoryDbWithCards();
    __setDbInstanceForTests(seeded.db);
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.hypothesis.status.update',
        capability_version: '1.0.0',
        input: { db: seeded.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', reason: '客户已确认', expected_version: BC_NOW },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
      const pre = (await seeded.db.select<{ status: string; status_audit_json: string }>('SELECT status, status_audit_json FROM customer_hypotheses WHERE id = ?', ['hyp-a-1']))[0];
      expect(pre?.status).toBe('PENDING');
      expect(JSON.parse(pre?.status_audit_json ?? '[]')).toHaveLength(0);

      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff.proposal_id, 'cust-a');
      expect(proposal?.tool_id).toBe('update_hypothesis_status');
      expect(proposal?.proposed_values.hypothesis_id).toBe('hyp-a-1');
      expect(proposal?.proposed_values.new_status).toBe('CONFIRMED');

      await confirmViaExistingFlow(proposal!);
      const post = (await seeded.db.select<{ status: string; status_audit_json: string; resolved_at: string | null }>('SELECT status, status_audit_json, resolved_at FROM customer_hypotheses WHERE id = ?', ['hyp-a-1']))[0];
      expect(post?.status).toBe('CONFIRMED');
      expect(JSON.parse(post?.status_audit_json ?? '[]')).toHaveLength(1); // 追加审计
      expect(post?.resolved_at).toBeTruthy(); // 终态写 resolved_at
      // REJECTED 不删除：语义上假设行仍在
      const stillThere = await seeded.db.select<{ id: string }>('SELECT id FROM customer_hypotheses WHERE id = ?', ['hyp-a-1']);
      expect(stillThere).toHaveLength(1);
    } finally {
      __setDbInstanceForTests(null);
      seeded.db.close();
    }
  });
});

describe('T14 — INTELLIGENCE IMPORT CONFIRM TRUTH: BULK_WRITE strong-confirm handoff preserved; post-confirm writes multi-record', () => {
  it('pre-confirm zero business writes; post-confirm creates the import row (multi-record atomic semantic)', async () => {
    const seeded = await openMemoryDbWithCards();
    __setDbInstanceForTests(seeded.db);
    try {
      const raw = readFileSync(INTEL_FIXTURE_PATH, 'utf8');
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.intelligence_import.confirm',
        capability_version: '1.0.0',
        input: { db: seeded.db, raw_content: raw, keep_fact_ids: [], keep_hypothesis_ids: [] },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
      if (outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
        expect(outcome.confirmation_handoff?.mechanism).toBe(BATTLE_CARD_CONFIRMATION_MECHANISM);
      }
      // PRE_CONFIRM_BUSINESS_EXECUTOR_CALLS = 0：导入/事实/假设表均无新行
      const preImports = await seeded.db.select<{ id: string }>('SELECT id FROM intelligence_imports WHERE customer_id = ?', ['cust-a']);
      expect(preImports).toHaveLength(0);

      const proposal = getCanonicalProposal((outcome as { confirmation_handoff: { proposal_id: string } }).confirmation_handoff.proposal_id, 'cust-a');
      expect(proposal?.tool_id).toBe('confirm_battle_intelligence_import');
      expect(proposal?.proposed_values.raw_content).toBe(raw);

      await confirmViaExistingFlow(proposal!);
      const postImports = await seeded.db.select<{ id: string; parse_status: string; customer_id: string | null }>('SELECT id, parse_status, customer_id FROM intelligence_imports WHERE customer_id = ?', ['cust-a']);
      expect(postImports.length).toBeGreaterThanOrEqual(1); // 一条导入行（parse_status=CONFIRMED）
      expect(postImports[0]?.parse_status).toBe('CONFIRMED');
      expect(postImports[0]?.customer_id).toBe('cust-a');
    } finally {
      __setDbInstanceForTests(null);
      seeded.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T15 — INPUT VALIDATORS                                               */
/* ------------------------------------------------------------------ */

describe('T15 — INPUT VALIDATORS: invalid write input fails before business executor (INVALID_INPUT)', () => {
  it('every write capability rejects malformed / unknown-field input with INVALID_INPUT and zero executor calls', async () => {
    const harness = makeWriteCountingHarness();
    const salesFixture = await openSalesAgentSqliteFixture();
    const bc = await openMemoryDbWithCards();
    try {
      const invalidCases: CapabilityInvocation[] = [
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: '' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: 'x', unknown_field: 1 }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: 42 }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: 'x', status: 'DONE' }, scope: { customer_id: 'dg-a-jm' } }, // 冻结语义仅 OPEN（status 字段拒绝）
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { db: salesFixture.db, next_follow_up_at: '' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { next_follow_up_at: '2026-08-01T00:00:00.000Z' }, scope: { customer_id: 'dg-a-jm' } }, // 缺 db
        { capability_id: 'customer.create', capability_version: '1.0.0', input: {}, scope: {} }, // 缺 name
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: '' }, scope: {} }, // 空 name
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: 'x', stage: 'PAID' }, scope: {} }, // 系统字段拒绝
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: 'x', intent_level: 'BOGUS' }, scope: {} }, // 错误枚举
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: 'x', is_key_decision_maker: 2 }, scope: {} }, // 错误表示
        { capability_id: 'battle_card.draft.create', capability_version: '1.0.0', input: { db: bc.db, stage_code: 'NOT_A_STAGE' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.confirm', capability_version: '1.0.0', input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: '2' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'BOGUS', expected_version: BC_NOW }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: '' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.intelligence_import.confirm', capability_version: '1.0.0', input: { db: bc.db, raw_content: '' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.intelligence_import.confirm', capability_version: '1.0.0', input: { db: bc.db, raw_content: 'x', fact_verifications: 'not-an-array' }, scope: { customer_id: 'cust-a' } },
      ];
      for (const invocation of invalidCases) {
        const outcome = await invoke(harness.engine, invocation);
        expect(outcome.status, `${invocation.capability_id} must fail closed`).toBe('EXECUTION_ERROR');
        if (outcome.status === 'EXECUTION_ERROR') {
          expect(outcome.error_code, `${invocation.capability_id} must fail in the input layer`).toBe('INVALID_INPUT');
        }
        const definition = PRODUCTION_CAPABILITY_REGISTRY.get(invocation.capability_id, invocation.capability_version);
        expect(harness.callsFor(definition.executor_ref), `${invocation.capability_id} executor must not run on invalid input`).toBe(0);
      }
    } finally {
      salesFixture.close();
      bc.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T16 — CUSTOMER SCOPE REQUIRED                                        */
/* ------------------------------------------------------------------ */

describe('T16 — CUSTOMER SCOPE REQUIRED: every CUSTOMER write without valid scope fails closed (INVALID_SCOPE)', () => {
  it('all seven writes fail INVALID_SCOPE when scope is missing/blank', async () => {
    const salesFixture = await openSalesAgentSqliteFixture();
    const bc = await openMemoryDbWithCards();
    try {
      const cases: CapabilityInvocation[] = [
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: 'x' }, scope: {} },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: 'x' }, scope: {} },
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { db: salesFixture.db, next_follow_up_at: '2026-08-01T00:00:00.000Z' }, scope: {} },
        { capability_id: 'battle_card.draft.create', capability_version: '1.0.0', input: { db: bc.db, stage_code: 'NEW_LEAD' }, scope: {} },
        { capability_id: 'battle_card.confirm', capability_version: '1.0.0', input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2 }, scope: {} },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: BC_NOW }, scope: {} },
        { capability_id: 'battle_card.intelligence_import.confirm', capability_version: '1.0.0', input: { db: bc.db, raw_content: 'x' }, scope: {} },
      ];
      for (const invocation of cases) {
        const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke(invocation);
        expect(outcome.status, `${invocation.capability_id} must fail closed without customer scope`).toBe('EXECUTION_ERROR');
        if (outcome.status === 'EXECUTION_ERROR') {
          expect(outcome.error_code, `${invocation.capability_id}`).toBe('INVALID_SCOPE');
        }
      }
    } finally {
      salesFixture.close();
      bc.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T17 — CUSTOMER SCOPE / INPUT MATCH                                   */
/* ------------------------------------------------------------------ */

describe('T17 — CUSTOMER SCOPE / INPUT MATCH: scope=A + input selector=A is permitted to reach authority evaluation', () => {
  it('confirm-capability: scope=cust-a + input.customer_id=cust-a → CONFIRMATION_REQUIRED (authority evaluated)', async () => {
    const bc = await openMemoryDbWithCards();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.confirm',
        capability_version: '1.0.0',
        input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2, customer_id: 'cust-a' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
    } finally {
      bc.db.close();
    }
  });

  it('draft AUTO: scope=cust-a + input.customer_id=cust-a → SUCCESS with effective customer from scope', async () => {
    const bc = await openMemoryDbWithCards();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.draft.create',
        capability_version: '1.0.0',
        input: { db: bc.db, stage_code: 'NEW_LEAD', customer_id: 'cust-a' },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('SUCCESS');
      if (outcome.status === 'SUCCESS') {
        expect((outcome.payload as { customer_id: string }).customer_id).toBe('cust-a');
      }
    } finally {
      bc.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T18 — CUSTOMER SCOPE / INPUT MISMATCH                                */
/* ------------------------------------------------------------------ */

describe('T18 — CUSTOMER SCOPE / INPUT MISMATCH: scope=A + input selector=B fails closed before execution', () => {
  it('all seven writes reject scope/input customer mismatch with INVALID_INPUT and zero executor calls', async () => {
    const harness = makeWriteCountingHarness();
    const salesFixture = await openSalesAgentSqliteFixture();
    const bc = await openMemoryDbWithCards();
    try {
      const cases: CapabilityInvocation[] = [
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: 'x', customer_id: 'other-customer' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: 'x', customerId: 'other-customer' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { db: salesFixture.db, next_follow_up_at: '2026-08-01T00:00:00.000Z', customer_id: 'other-customer' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: 'x', customer_id: 'other-customer' }, scope: {} }, // 目标身份注入拒绝
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: 'x', customerId: 'other-customer' }, scope: {} }, // 目标身份注入拒绝（别名）
        { capability_id: 'battle_card.draft.create', capability_version: '1.0.0', input: { db: bc.db, stage_code: 'NEW_LEAD', customer_id: 'cust-b' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.confirm', capability_version: '1.0.0', input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2, customer_id: 'cust-b' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: BC_NOW, customer_id: 'cust-b' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.intelligence_import.confirm', capability_version: '1.0.0', input: { db: bc.db, raw_content: 'x', customer_id: 'cust-b' }, scope: { customer_id: 'cust-a' } },
      ];
      for (const invocation of cases) {
        const outcome = await invoke(harness.engine, invocation);
        expect(outcome.status, `${invocation.capability_id} must fail closed on mismatch`).toBe('EXECUTION_ERROR');
        if (outcome.status === 'EXECUTION_ERROR') {
          expect(outcome.error_code, `${invocation.capability_id} mismatch must fail in the input layer`).toBe('INVALID_INPUT');
        }
        const definition = PRODUCTION_CAPABILITY_REGISTRY.get(invocation.capability_id, invocation.capability_version);
        expect(harness.callsFor(definition.executor_ref), `${invocation.capability_id} executor must not run on mismatch`).toBe(0);
      }
    } finally {
      salesFixture.close();
      bc.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T19 — CROSS-CUSTOMER WRITE PROTECTION                                */
/* ------------------------------------------------------------------ */

describe('T19 — CROSS-CUSTOMER WRITE PROTECTION: by-ID target ownership is proven; no write for A can mutate B', () => {
  it('battle_card.confirm with cust-b card under scope cust-a fails at handoff ownership proof; B card untouched', async () => {
    const seeded = await openMemoryDbWithCards();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.confirm',
        capability_version: '1.0.0',
        input: { db: seeded.db, card_id: 'card-cust-b-CONTACTED-v2', expected_version: 2 },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT'); // 所有权不符 → 输入层 fail-closed
        expect(outcome.message).toMatch(/belongs to customer cust-b/);
      }
      // 未注册提案：现有机制中没有可被确认的 artifact
      const cardB = (await seeded.db.select<{ card_status: string }>('SELECT card_status FROM customer_stage_cards WHERE id = ?', ['card-cust-b-CONTACTED-v2']))[0];
      expect(cardB?.card_status).toBe('DRAFT');
      const customerB = (await seeded.db.select<{ current_stage_card_id: string | null }>('SELECT current_stage_card_id FROM customers WHERE id = ?', ['cust-b']))[0];
      expect(customerB?.current_stage_card_id).toBe('card-cust-b-CONTACTED-v1');
    } finally {
      seeded.db.close();
    }
  });

  it('battle_card.hypothesis.status.update with cust-b hypothesis under scope cust-a fails at handoff ownership proof', async () => {
    const seeded = await openMemoryDbWithCards();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.hypothesis.status.update',
        capability_version: '1.0.0',
        input: { db: seeded.db, hypothesis_id: 'hyp-b-1', new_status: 'CONFIRMED', expected_version: BC_NOW },
        scope: { customer_id: 'cust-a' },
      });
      expect(outcome.status).toBe('EXECUTION_ERROR');
      if (outcome.status === 'EXECUTION_ERROR') {
        expect(outcome.error_code).toBe('INVALID_INPUT');
      }
      const hypB = (await seeded.db.select<{ status: string }>('SELECT status FROM customer_hypotheses WHERE id = ?', ['hyp-b-1']))[0];
      expect(hypB?.status).toBe('PENDING'); // 未发生任何变更
    } finally {
      seeded.db.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T20/T21 — CONFIRMATION HANDOFF                                       */
/* ------------------------------------------------------------------ */

describe('T20 — CONFIRMATION HANDOFF EXISTS: every confirmation-required write produces a truthful existing-mechanism handoff without business mutation', () => {
  it('all six confirmation-required capabilities produce confirmation_handoff { mechanism, proposal_id }', async () => {
    const salesFixture = await openSalesAgentSqliteFixture();
    const bc = await openMemoryDbWithCards();
    try {
      const cases: CapabilityInvocation[] = [
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: 'x' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: 'x' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { db: salesFixture.db, next_follow_up_at: '2026-08-01T00:00:00.000Z' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: 'x' }, scope: {} },
        { capability_id: 'battle_card.confirm', capability_version: '1.0.0', input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2 }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: BC_NOW }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.intelligence_import.confirm', capability_version: '1.0.0', input: { db: bc.db, raw_content: 'x' }, scope: { customer_id: 'cust-a' } },
      ];
      for (const invocation of cases) {
        const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke(invocation);
        expect(['CONFIRMATION_REQUIRED', 'STRONG_CONFIRMATION_REQUIRED'], invocation.capability_id).toContain(outcome.status);
        if (outcome.status === 'CONFIRMATION_REQUIRED' || outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
          expect(outcome.confirmation_handoff, `${invocation.capability_id} must expose a handoff`).toBeDefined();
          expect(outcome.confirmation_handoff?.proposal_id).toBeTruthy();
          expect([SALES_AGENT_CONFIRMATION_MECHANISM, BATTLE_CARD_CONFIRMATION_MECHANISM]).toContain(outcome.confirmation_handoff?.mechanism);
          // 提案可在现有机制中读回（说明交接进的是现有 store，不是凭空产物）
          const customerId = invocation.scope.customer_id ?? '';
          expect(getCanonicalProposal(outcome.confirmation_handoff!.proposal_id, customerId)).not.toBeNull();
        }
      }
    } finally {
      salesFixture.close();
      bc.db.close();
    }
  });
});

describe('T21 — CONFIRMATION HANDOFF DOES NOT BYPASS HUMAN: handoff registers a proposal only; no business mutation occurs', () => {
  it('after handoff, all CRM tables remain unchanged (zero business writes before human confirmation)', async () => {
    const salesFixture = await openSalesAgentSqliteFixture();
    const bc = await openMemoryDbWithCards();
    try {
      const counts = {
        customers: await salesFixture.db.select<{ id: string }>('SELECT id FROM customers'),
        followUps: await salesFixture.db.select<{ id: string }>('SELECT id FROM follow_up_records WHERE customer_id = ?', ['dg-a-jm']),
        tasks: await salesFixture.db.select<{ id: string }>('SELECT id FROM tasks WHERE customer_id = ?', ['dg-a-jm']),
        cards: await bc.db.select<{ id: string }>('SELECT id FROM customer_stage_cards WHERE customer_id = ?', ['cust-a']),
        hypotheses: await bc.db.select<{ id: string }>('SELECT id FROM customer_hypotheses WHERE customer_id = ?', ['cust-a']),
        imports: await bc.db.select<{ id: string }>('SELECT id FROM intelligence_imports WHERE customer_id = ?', ['cust-a']),
      };
      const cases: CapabilityInvocation[] = [
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: 'x' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: 'x' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { db: salesFixture.db, next_follow_up_at: '2026-08-01T00:00:00.000Z' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.create', capability_version: '1.0.0', input: { name: 'x' }, scope: {} },
        { capability_id: 'battle_card.confirm', capability_version: '1.0.0', input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2 }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: BC_NOW }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.intelligence_import.confirm', capability_version: '1.0.0', input: { db: bc.db, raw_content: 'x' }, scope: { customer_id: 'cust-a' } },
      ];
      for (const invocation of cases) {
        await PRODUCTION_CAPABILITY_EXECUTION.invoke(invocation);
      }
      expect(await salesFixture.db.select<{ id: string }>('SELECT id FROM customers')).toHaveLength(counts.customers.length);
      expect(await salesFixture.db.select<{ id: string }>('SELECT id FROM follow_up_records WHERE customer_id = ?', ['dg-a-jm'])).toHaveLength(counts.followUps.length);
      expect(await salesFixture.db.select<{ id: string }>('SELECT id FROM tasks WHERE customer_id = ?', ['dg-a-jm'])).toHaveLength(counts.tasks.length);
      expect(await bc.db.select<{ id: string }>('SELECT id FROM customer_stage_cards WHERE customer_id = ?', ['cust-a'])).toHaveLength(counts.cards.length);
      expect(await bc.db.select<{ id: string }>('SELECT id FROM customer_hypotheses WHERE customer_id = ?', ['cust-a'])).toHaveLength(counts.hypotheses.length);
      expect(await bc.db.select<{ id: string }>('SELECT id FROM intelligence_imports WHERE customer_id = ?', ['cust-a'])).toHaveLength(counts.imports.length);
    } finally {
      salesFixture.close();
      bc.db.close();
    }
  });

  it('handoff artifacts contain no sensitive business payload (only mechanism + proposal_id)', async () => {
    const salesFixture = await openSalesAgentSqliteFixture();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'follow_up.create',
        capability_version: '1.0.0',
        input: { title: '机密跟进内容不应出现在结果负载中' },
        scope: { customer_id: 'dg-a-jm' },
      });
      if (outcome.status === 'CONFIRMATION_REQUIRED' || outcome.status === 'STRONG_CONFIRMATION_REQUIRED') {
        const handoff = outcome.confirmation_handoff;
        expect(handoff).toBeDefined();
        const keys = Object.keys(handoff ?? {}).sort();
        expect(keys).toEqual(['mechanism', 'proposal_id']);
        expect(JSON.stringify(outcome)).not.toContain('机密跟进内容');
      }
    } finally {
      salesFixture.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T22 — EXISTING CONFIRMED RUNTIME REUSED                              */
/* ------------------------------------------------------------------ */

describe('T22 — EXISTING CONFIRMED RUNTIME REUSED: no second confirmation store/runtime introduced', () => {
  it('writeAdapters handoffs reuse the existing canonical-proposal store (sessionWriteStateStore)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/writeAdapters.ts'), 'utf8');
    expect(source).toContain("from '../../salesAgentTools/confirmedWrite'");
    expect(source).toContain("from '../../salesAgentTools/sessionWriteStateStore'");
    expect(source).toContain('registerCanonicalProposal');
    expect(source).toContain('buildWriteProposal');
    // 不创建任何新的确认/提案存储：无 localStorage / IndexedDB / 新 Map 存储 / 新表
    expect(source).not.toMatch(/localStorage|indexedDB|createProposalTable|new Map<string, [^)]*proposal/i);
  });

  it('the handoff artifact is a canonical proposal in the existing store, not a new one', async () => {
    const salesFixture = await openSalesAgentSqliteFixture();
    try {
      const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'task.create',
        capability_version: '1.0.0',
        input: { title: '复用现有机制的提案' },
        scope: { customer_id: 'dg-a-jm' },
      });
      if (outcome.status === 'CONFIRMATION_REQUIRED') {
        const proposal = getCanonicalProposal(outcome.confirmation_handoff!.proposal_id, 'dg-a-jm');
        expect(proposal?.proposal_hash).toMatch(/^[0-9a-f]{64}$/); // 现有 SHA-256 canonical snapshot
        expect(proposal?.status).toBe('awaiting_confirmation');
      }
    } finally {
      salesFixture.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* T23 — OBSERVATION WIRING (Closure 2)                                 */
/* ------------------------------------------------------------------ */

describe('T23 — OBSERVATION WIRING: Closure 2 wires W3-2 through one bridge while write adapters stay observation-free', () => {
  it('write adapters do not import observation/** and do not carry invocation_id (write semantics untouched)', () => {
    const files = [
      'src/lib/capabilities/execution/writeAdapters.ts',
      'src/lib/capabilities/execution/binding.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, `${file} must not import observation`).not.toMatch(/from ['"]\.\.\/\.\.\/observation|from ['"]\.\.\/observation/);
      expect(source, `${file} must not reference invocation_id`).not.toMatch(/invocation_id/);
    }
  });

  it('Closure 2: engine/contract carry invocation_id and production composes the observation bridge (W3-2 event generation, no persistence)', () => {
    const engineSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/engine.ts'), 'utf8');
    const contractSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/contract.ts'), 'utf8');
    const productionSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/production.ts'), 'utf8');
    const bridgeSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/observationBridge.ts'), 'utf8');
    expect(engineSource).toMatch(/invocation_id/);
    expect(contractSource).toMatch(/invocation_id/);
    expect(productionSource).toMatch(/createObservationBridge/);
    expect(bridgeSource).toMatch(/from '\.\.\/observation'/);
    // 桥是执行层内唯一的 W3-2 集成点：engine 本身不得 import W3-2。
    expect(engineSource).not.toMatch(/from ['"]\.\.\/\.\.\/observation|from ['"]\.\.\/observation/);
    // W3-2 冻结文件未被修改（桥只消费，不改契约）。
    expect(bridgeSource).not.toMatch(/ObservationEventType\s*=|OBSERVATION_EVENT_TYPES\s*=/);
  });
});

/* ------------------------------------------------------------------ */
/* T24 — WAVE-4 IDENTITIES                                              */
/* ------------------------------------------------------------------ */

describe('T24 — WAVE-4 IDENTITIES: customer.create + customer.profile.update + customer.delete + visit.create registered; visit.update / visit.delete / import.execute / customer.update remain absent', () => {
  it('registry contains exactly 25 capabilities; the only Wave-4 identities are create / profile.update / delete / visit.create, and C0 adds customer.opportunity_amount.update', () => {
    const ids = PRODUCTION_CAPABILITY_REGISTRY.list().map((d) => d.id);
    expect(ids).toContain('customer.create');
    expect(ids).toContain('customer.profile.update');
    expect(ids).toContain('customer.delete');
    expect(ids).toContain('visit.create');
    expect(ids).toContain('customer.opportunity_amount.update');
    // customer.delete 是 W4-4 唯一新身份，且是唯一 DELETE 能力
    expect(PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.id === 'customer.delete')).toHaveLength(1);
    // visit.create 是 W4-3 唯一新身份，且恰出现一次
    expect(PRODUCTION_CAPABILITY_REGISTRY.list().filter((d) => d.id === 'visit.create')).toHaveLength(1);
    expect(ids).not.toContain('visit.update');
    expect(ids).not.toContain('visit.delete');
    expect(ids).not.toContain('import.execute');
    expect(ids).not.toContain('customer.update');
    expect(ids.length).toBe(25);
  });
});

/* ------------------------------------------------------------------ */
/* T25 — CURRENT 13 REGRESSION                                          */
/* ------------------------------------------------------------------ */

describe('T25 — CURRENT 13 REGRESSION: representative READ/ANALYZE capabilities still execute normally', () => {
  it('customer.get / battle_card.current.read / follow_up.global.read / import.mapping.validate all SUCCESS', async () => {
    const snapshotFixture = {
      kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT' as const,
      version: 'v1',
      snapshot_id: 'write-integration-fixture',
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
    const context = { kind: 'CRM_CONTEXT_SNAPSHOT' as const, profile_id: 'foreign_trade_geo', captured_at: NOW, time_window: { from: '2026-07-01T00:00:00.000Z', to: NOW }, customers: [], accounts: [], interactions: [] };

    const customerGet = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
      capability_id: 'customer.get',
      capability_version: '1.0.0',
      input: { snapshot: snapshotFixture, context },
      scope: { customer_id: 'customer-1' },
    });
    expect(customerGet.status).toBe('SUCCESS');

    const bc = await openMemoryDbWithCards();
    try {
      const battleRead = await PRODUCTION_CAPABILITY_EXECUTION.invoke({
        capability_id: 'battle_card.current.read',
        capability_version: '1.0.0',
        input: { db: bc.db, clock },
        scope: { customer_id: 'cust-a' },
      });
      expect(battleRead.status).toBe('SUCCESS');
    } finally {
      bc.db.close();
    }

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
  });
});

/* ------------------------------------------------------------------ */
/* T26 — AUTHORITY CANNOT BE BYPASSED                                   */
/* ------------------------------------------------------------------ */

describe('T26 — AUTHORITY CANNOT BE BYPASSED: all production unified execution entry points remain A10-first', () => {
  it('every write invocation outcome carries the A10 decision that governed it; confirmation-required writes never SUCCESS', async () => {
    const salesFixture = await openSalesAgentSqliteFixture();
    const bc = await openMemoryDbWithCards();
    try {
      const cases: CapabilityInvocation[] = [
        { capability_id: 'follow_up.create', capability_version: '1.0.0', input: { title: 'x' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'task.create', capability_version: '1.0.0', input: { title: 'x' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'customer.next_follow_up_time.update', capability_version: '1.0.0', input: { db: salesFixture.db, next_follow_up_at: '2026-08-01T00:00:00.000Z' }, scope: { customer_id: 'dg-a-jm' } },
        { capability_id: 'battle_card.draft.create', capability_version: '1.0.0', input: { db: bc.db, stage_code: 'NEW_LEAD' }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.confirm', capability_version: '1.0.0', input: { db: bc.db, card_id: 'card-cust-a-NEW_LEAD-v2', expected_version: 2 }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.hypothesis.status.update', capability_version: '1.0.0', input: { db: bc.db, hypothesis_id: 'hyp-a-1', new_status: 'CONFIRMED', expected_version: BC_NOW }, scope: { customer_id: 'cust-a' } },
        { capability_id: 'battle_card.intelligence_import.confirm', capability_version: '1.0.0', input: { db: bc.db, raw_content: 'x' }, scope: { customer_id: 'cust-a' } },
      ];
      for (const invocation of cases) {
        const outcome = await PRODUCTION_CAPABILITY_EXECUTION.invoke(invocation);
        // 每个结果都携带 A10 决策（权威先于执行）
        if (outcome.status === 'SUCCESS' || outcome.status === 'CONFIRMATION_REQUIRED' || outcome.status === 'STRONG_CONFIRMATION_REQUIRED' || outcome.status === 'AUTONOMY_DENIED') {
          expect(outcome.authority_decision.capability_id, invocation.capability_id).toBe(invocation.capability_id);
        }
        const definition = PRODUCTION_CAPABILITY_REGISTRY.get(invocation.capability_id, invocation.capability_version);
        const decision = evaluateAuthorityPolicy(definition);
        if (decision.decision === 'REQUIRE_CONFIRMATION') {
          expect(outcome.status).toBe('CONFIRMATION_REQUIRED');
        } else if (decision.decision === 'REQUIRE_STRONG_CONFIRMATION') {
          expect(outcome.status).toBe('STRONG_CONFIRMATION_REQUIRED');
        } else if (decision.decision === 'ALLOW_AUTO') {
          expect(outcome.status).toBe('SUCCESS');
        }
      }
    } finally {
      salesFixture.close();
      bc.db.close();
    }
  });

  it('static: the engine still evaluates A10 before the only executor call site', () => {
    const engineSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/execution/engine.ts'), 'utf8');
    expect(engineSource).toMatch(/evaluateAuthorityPolicy/);
    expect(engineSource.indexOf('evaluateAuthorityPolicy')).toBeLessThan(engineSource.indexOf('binding.execute(validatedInput'));
  });
});
