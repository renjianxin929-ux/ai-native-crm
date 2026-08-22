/**
 * V0.2A / A4R — Timeline / Interaction READ Capabilities 契约测试。
 *
 * 覆盖规格 §20 的 T1–T13（Targeted Product-Parity Closure 版）：
 *   T1  MANIFEST CONTRACT         T2  DOMAIN COMPOSITION
 *   T3  INVENTORY TRUTH           T4  CUSTOMER TIMELINE
 *   T5  CROSS-CUSTOMER ISOLATION  T6  INTERACTION / VISIT READ
 *   T7  TIMELINE ORDERING         T8  PROVENANCE
 *   T9  SUMMARIZE CLASSIFICATION  T10 ZERO WRITES
 *   T11 ZERO PROVIDER / NETWORK   T12 EXISTING PATH PARITY
 *   T13 UNKNOWN / INVALID SCOPE
 *
 * Product-parity 原则：T12 以真实产品读取路径（db.ts listFollowUps / listVisits →
 * buildCustomerTimeline）为 oracle，不以 legacy agent 工具（快照投影）为 oracle；
 * legacy 工具的语义 mismatch 单独记录为 LEGACY_AGENT_TOOL_SEMANTIC_MISMATCH 证据。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import type { ContextSnapshot } from '../lib/context/types';
import { createCapabilityRegistry, type CapabilityDefinition } from '../lib/capabilities';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/timeline/manifest';
import { readCustomerTimeline, readCustomerVisits } from '../lib/capabilities/timeline/readAdapter';
import { executeSalesAgentReadTool } from '../lib/salesAgentTools/registry';
import { __setDbInstanceForTests, initializeDatabaseSchema, listFollowUps, listVisits, type DatabaseLike } from '../lib/db';
import type { FollowUpRecord, VisitRecord } from '../lib/types';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { buildCustomerTimeline } from '../lib/salesWorkspace/customerIntelligence';

const NOW = '2026-07-12T00:00:00.000Z';

// ── 内存 DB（真实 schema + 真实 db.ts 读取函数）───────────────────────────────

class SqliteDatabaseLike implements DatabaseLike {
  constructor(private readonly sqlite: Database.Database) {}
  async execute(sql: string, bindings: unknown[] = []): Promise<{ rowsAffected: number }> {
    const info = this.sqlite.prepare(sql).run(...bindings);
    return { rowsAffected: info.changes };
  }
  async select<T>(sql: string, bindings: unknown[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...bindings) as T[];
  }
  close(): void { this.sqlite.close(); }
}

const followUp = (overrides: Partial<FollowUpRecord>): FollowUpRecord => ({
  id: 'fu-1', customer_id: 'customer-1', title: '跟进价格', contact_channel: 'wechat', contact_result: null,
  feedback_notes: '客户询问价格', intent_assessment: 'HIGH', suggested_grade: 'A', next_action: null,
  next_follow_up_at: null, is_completed: 1, created_at: '2026-07-10T00:00:00.000Z', updated_at: '2026-07-11T00:00:00.000Z', ...overrides,
});

const visit = (overrides: Partial<VisitRecord>): VisitRecord => ({
  id: 'visit-1', customer_id: 'customer-1', title: '面访演示', visited_at: '2026-07-08T00:00:00.000Z', visit_notes: '演示顺利',
  customer_concerns: null, intent_after_visit: 'HIGH', visit_outcome: 'POSITIVE', next_action: null,
  expected_contract_at: null, created_at: '2026-07-09T00:00:00.000Z', updated_at: '2026-07-09T00:00:00.000Z', ...overrides,
});

let memoryDb: SqliteDatabaseLike | null = null;

afterEach(() => {
  __setDbInstanceForTests(null);
  memoryDb?.close();
  memoryDb = null;
});

async function openMemoryDbWithRecords(): Promise<SqliteDatabaseLike> {
  const sqlite = new Database(':memory:');
  const db = new SqliteDatabaseLike(sqlite);
  await initializeDatabaseSchema(db);
  // 外键引用先决条件：customers 行
  await db.execute('INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['customer-1', 'Ada', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z']);
  await db.execute('INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', ['customer-2', 'Bob', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z']);
  // customer-1：1 条跟进 + 1 条面访；customer-2：1 条面访（隔离哨兵）
  await db.execute('INSERT INTO follow_up_records (id, customer_id, title, contact_channel, contact_result, feedback_notes, intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['fu-1', 'customer-1', '跟进价格', 'wechat', null, '客户询问价格', 'HIGH', 'A', null, null, 1, '2026-07-10T00:00:00.000Z', '2026-07-11T00:00:00.000Z']);
  await db.execute('INSERT INTO follow_up_records (id, customer_id, title, contact_channel, contact_result, feedback_notes, intent_assessment, suggested_grade, next_action, next_follow_up_at, is_completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['fu-future', 'customer-1', '周三联系', null, null, '周三联系', null, null, null, null, 0, '2026-08-17T10:14:00+08:00', '2026-08-17T10:14:00+08:00']);
  await db.execute('INSERT INTO visit_records (id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit, visit_outcome, next_action, expected_contract_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['visit-1', 'customer-1', '面访演示', '2026-07-08T00:00:00.000Z', '演示顺利', null, 'HIGH', 'POSITIVE', null, null, '2026-07-09T00:00:00.000Z', '2026-07-09T00:00:00.000Z']);
  await db.execute('INSERT INTO visit_records (id, customer_id, title, visited_at, visit_notes, customer_concerns, intent_after_visit, visit_outcome, next_action, expected_contract_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['visit-2', 'customer-2', '客户 B 面访', '2026-07-07T00:00:00.000Z', 'B 记录', null, 'MEDIUM', 'NEUTRAL', null, null, '2026-07-08T00:00:00.000Z', '2026-07-08T00:00:00.000Z']);
  __setDbInstanceForTests(db);
  memoryDb = db;
  return db;
}

// ── legacy agent 工具快照（仅用于 LEGACY_AGENT_TOOL_SEMANTIC_MISMATCH 证据）──

function makeSnapshot(tasks: readonly { id: string; customer_id: string; title: string }[], workItems: readonly { id: string; customer_id: string | null; company_name: string }[]): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'a4r-legacy-evidence',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: NOW,
    context: { active_profile_id: 'foreign_trade_geo', now: NOW },
    customers: [{ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer' as const, id: 'customer-1', label: 'Ada', synthetic: false as const, persisted: true as const } }],
    tasks: tasks.map(t => ({ id: t.id, customer_id: t.customer_id, title: t.title, due_at: null, status: 'TODO' as const, priority: 1, evidence_ref: { type: 'task' as const, id: t.id, label: t.title, synthetic: false as const, persisted: true as const } })),
    work_items: workItems.map(w => ({ id: w.id, customer_id: w.customer_id, company_name: w.company_name, status: 'ACTIVE', priority: 1, updated_at: NOW, lookup_goal: null, evidence_ref: { type: 'lead_work_item' as const, id: w.id, label: w.company_name, synthetic: false as const, persisted: true as const } })),
    collected_leads: [],
    replay_evidence: [],
    import_rows: [],
    capture_events: [],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
}

const legacyContext: ContextSnapshot = buildContextSnapshot({
  snapshotId: 'a4r-legacy-evidence',
  capturedAt: NOW,
  timeWindow: { from: '2026-07-01T00:00:00.000Z', to: NOW },
  customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: NOW, evidenceIds: ['customer-1'] }],
  accounts: [],
  interactions: [],
});

// ── T1 / T2 ──────────────────────────────────────────────────────────────────

describe('A4R timeline read capability contract (product parity)', () => {
  it('T1: manifest contract — every production capability conforms to the frozen A1 CapabilityDefinition', () => {
    const registry = createCapabilityRegistry(TIMELINE_READ_CAPABILITY_MANIFEST);
    expect(registry.size()).toBe(2);
    for (const definition of registry.list()) {
      // 显式语义：纯读取、零写、无需确认、客户范围、幂等安全
      expect(definition.effect).toBe('READ');
      expect(definition.data_target).toBe('CRM_FACT');
      expect(definition.risk_level).toBe('LOW');
      expect(definition.requires_confirmation).toBe(false);
      expect(definition.scope_requirement).toBe('CUSTOMER');
      expect(definition.idempotency).toBe('SAFE');
      expect(definition.authority_policy).toBe('AUTO');
      // 如实声明：现有产品读取函数无稳定错误码，仅 Error message 区分
      expect(definition.error_contract).toBe('UNSPECIFIED');
      expect(definition.audit_contract.audit_required).toBe(true);
      expect(definition.domain).toBe('timeline');
      expect(Object.isFrozen(definition)).toBe(true);
    }
    // 稳定身份（id + version）
    expect(registry.get('timeline.customer.read', '1.0.0').id).toBe('timeline.customer.read');
    expect(registry.get('timeline.visit.read', '1.0.0').version).toBe('1.0.0');
  });

  it('T2: domain composition — manifest composes through the A1 extension seam without central registry/types/index changes', () => {
    const fixtureManifest: readonly CapabilityDefinition[] = [
      {
        id: 'fixture.read', version: '1.0.0', domain: 'fixture-domain',
        description: 'fixture read', input_schema: 'i.v1', output_schema: 'o.v1',
        effect: 'READ', data_target: 'CRM_FACT', risk_level: 'LOW', authority_policy: 'AUTO',
        requires_confirmation: false, scope_requirement: 'CUSTOMER', idempotency: 'SAFE',
        executor_ref: 'fixture.executor', audit_contract: { audit_required: true, record_input: true, record_output: true, record_effect: false },
        error_contract: 'UNSPECIFIED',
      },
    ];
    const registry = createCapabilityRegistry(fixtureManifest, TIMELINE_READ_CAPABILITY_MANIFEST);
    expect(registry.size()).toBe(3);
    expect(registry.listByDomain('timeline').map(d => d.id)).toEqual(['timeline.customer.read', 'timeline.visit.read']);
    expect(registry.listByDomain('fixture-domain')).toHaveLength(1);
    expect(registry.get('timeline.customer.read', '1.0.0')).toBe(registry.get('timeline.customer.read', '1.0.0'));

    // 无中央路由：timeline manifest 自身只允许 type-only 契约 import，不依赖中心 switch/数组
    const manifestSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/timeline/manifest.ts'), 'utf8');
    expect(manifestSource).not.toMatch(/from '\.\.\/registry'|from '\.\.\/index'/);
  });

  it('T3: inventory truth — executor_ref resolves to the real current product read path, never a legacy agent tool or a global list', () => {
    const byId = new Map(TIMELINE_READ_CAPABILITY_MANIFEST.map(d => [d.id, d]));
    const customerRead = byId.get('timeline.customer.read');
    const visitRead = byId.get('timeline.visit.read');
    expect(customerRead?.executor_ref).toBe('crm:listFollowUps+listVisits→buildCustomerTimeline');
    expect(visitRead?.executor_ref).toBe('crm:listVisits');
    for (const definition of TIMELINE_READ_CAPABILITY_MANIFEST) {
      // 不绑定 legacy agent 工具（快照投影，语义 mismatch）
      expect(definition.executor_ref).not.toMatch(/get_customer_timeline|list_customer_followups|list_customer_visits|salesAgentTool:/);
      // 全局列表函数绝不作为客户范围能力暴露
      expect(definition.executor_ref).not.toMatch(/listAllVisits|listAllFollowUps/);
      expect(definition.executor_ref).toMatch(/^crm:/);
    }
    // 真实产品函数确实存在且导出（可复用性静态证据）
    const dbSource = readFileSync(resolve(process.cwd(), 'src/lib/db.ts'), 'utf8');
    expect(dbSource).toMatch(/export async function listVisits\(customerId: string\)/);
    expect(dbSource).toMatch(/export async function listFollowUps\(customerId: string\)/);
    expect(dbSource).toMatch(/sortByInstantDesc/);
  });

  // ── T4 / T5 / T13 ──────────────────────────────────────────────────────────

  it('T4: customer timeline — explicit customer scope returns the real product Timeline projection for that customer', async () => {
    await openMemoryDbWithRecords();
    const result = await readCustomerTimeline({ customer_id: 'customer-1' });
    expect(result.read_only).toBe(true);
    expect(result.writes_crm).toBe(false);
    const ids = result.records.map(item => item.id);
    expect(ids).toEqual(expect.arrayContaining(['follow-up:fu-1', 'visit:visit-1']));
    expect(ids).not.toContain('follow-up:fu-future');
    expect(ids).not.toContain('visit:visit-2'); // customer-2 哨兵
    // 产品投影字段保留
    const visitItem = result.records.find(item => item.id === 'visit:visit-1');
    expect(visitItem).toMatchObject({ kind: 'meeting', evidenceId: 'visit-1', occurredAt: '2026-07-08T00:00:00.000Z' });
  });

  it('T5: cross-customer isolation — customer A reads contain zero customer B records (and vice versa), via the real product read path', async () => {
    await openMemoryDbWithRecords();
    const a = await readCustomerTimeline({ customer_id: 'customer-1' });
    const b = await readCustomerTimeline({ customer_id: 'customer-2' });
    const aIds = new Set(a.records.map(item => item.id));
    const bIds = new Set(b.records.map(item => item.id));
    expect(aIds).toContain('follow-up:fu-1');
    expect(aIds).toContain('visit:visit-1');
    expect(bIds).toContain('visit:visit-2');
    for (const id of aIds) expect(bIds.has(id)).toBe(false);
    for (const id of bIds) expect(aIds.has(id)).toBe(false);
    // Visit 读取同样隔离
    const aVisits = await readCustomerVisits({ customer_id: 'customer-1' });
    expect(aVisits.records.map(v => v.id)).toEqual(['visit-1']);
  });

  it('T6: interaction/visit read — real product Visit read function (db.ts listVisits) is the executor', async () => {
    await openMemoryDbWithRecords();
    const viaAdapter = await readCustomerVisits({ customer_id: 'customer-1' });
    const viaProduct = await listVisits('customer-1');
    expect(viaAdapter.records).toEqual(viaProduct); // 同一真实产品函数
    expect(viaAdapter.records[0]?.customer_id).toBe('customer-1');
    expect(viaAdapter.evidence_refs).toEqual(['visit-1']);
    // DB 行数在读取前后不变（零写）
    const db = memoryDb as unknown as { sqlite: Database.Database };
    const count = () => (db.sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records').get() as { c: number }).c;
    expect(count()).toBe(2);
    await readCustomerVisits({ customer_id: 'customer-1' });
    expect(count()).toBe(2);
  });

  it('T7: timeline ordering — adapter output equals the real product projection order (occurredAt desc)', async () => {
    await openMemoryDbWithRecords();
    const result = await readCustomerTimeline({ customer_id: 'customer-1' });
    // 产品 UI 同一投影的独立计算
    const [followUps, visits] = await Promise.all([listFollowUps('customer-1'), listVisits('customer-1')]);
    const productTimeline = buildCustomerTimeline(followUps, visits);
    expect(result.records).toEqual(productTimeline);
    // 排序语义：occurredAt 降序（follow-up 用 updated_at；visit 用 visited_at || updated_at）
    const occurred = result.records.map(item => item.occurredAt);
    expect([...occurred].sort((a, b) => b.localeCompare(a))).toEqual(occurred);
    const nullVisitedAt = buildCustomerTimeline([followUp()], [visit({ id: 'visit-x', visited_at: null, updated_at: '2026-07-06T00:00:00.000Z' })]);
    expect(nullVisitedAt.find(item => item.id === 'visit:visit-x')?.occurredAt).toBe('2026-07-06T00:00:00.000Z'); // visited_at 为 null 时回退 updated_at
  });

  it('T8: provenance — evidence/source/record identity is preserved, never fabricated', async () => {
    await openMemoryDbWithRecords();
    const result = await readCustomerTimeline({ customer_id: 'customer-1' });
    // evidence_refs = 投影保留的 evidenceId = 真实记录 ID
    expect(result.evidence_refs).toEqual(expect.arrayContaining(['fu-1', 'visit-1']));
    for (const item of result.records) {
      expect(item.evidenceId).toBeTruthy();
    }
    // 与真实产品路径的 provenance 一致
    const [followUps, visits] = await Promise.all([listFollowUps('customer-1'), listVisits('customer-1')]);
    expect(result.evidence_refs).toEqual(buildCustomerTimeline(followUps, visits).map(item => item.evidenceId));
  });

  it('T9: summarize classification — INTERACTION_SUMMARY is model-bound intent behavior, absent from the deterministic read manifest', () => {
    for (const definition of TIMELINE_READ_CAPABILITY_MANIFEST) {
      expect(definition.id.toLowerCase()).not.toMatch(/summar|interaction\.summary/);
      expect(definition.effect).not.toBe('ANALYZE');
    }
    const matrixSource = readFileSync(resolve(process.cwd(), 'src/lib/productionAi/capabilityRoutingMatrix.ts'), 'utf8');
    const interactionSummaryLine = matrixSource.split('\n').find(line => line.includes("intent: 'INTERACTION_SUMMARY'"));
    expect(interactionSummaryLine).toBeTruthy();
    expect(interactionSummaryLine).toMatch(/execution_mode: 'REAL_TEXT_MODEL'/);
    expect(interactionSummaryLine).toMatch(/requires_real_model: true/);
    const projectionSource = readFileSync(resolve(process.cwd(), 'src/lib/productionAi/localDeterministicProjection.ts'), 'utf8');
    expect(projectionSource).toMatch(/非 AI 推理/);
  });

  it('T10: zero writes — no INSERT/UPDATE/DELETE, no confirmedWrite, no create* call across A4R execution', async () => {
    await openMemoryDbWithRecords();
    for (const file of ['src/lib/capabilities/timeline/manifest.ts', 'src/lib/capabilities/timeline/readAdapter.ts', 'src/lib/capabilities/timeline/index.ts']) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/INSERT|UPDATE|DELETE FROM|createVisit|createFollowUp|createTask|confirmedWrite|execute\(/);
    }
    const db = memoryDb as unknown as { sqlite: Database.Database };
    const counts = () => ({
      visits: (db.sqlite.prepare('SELECT COUNT(*) AS c FROM visit_records').get() as { c: number }).c,
      followUps: (db.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get() as { c: number }).c,
    });
    const before = counts();
    await readCustomerTimeline({ customer_id: 'customer-1' });
    await readCustomerVisits({ customer_id: 'customer-1' });
    expect(counts()).toEqual(before);
  });

  it('T11: zero provider/network — deterministic read execution requires no model, provider, or network', async () => {
    for (const file of ['src/lib/capabilities/timeline/manifest.ts', 'src/lib/capabilities/timeline/readAdapter.ts', 'src/lib/capabilities/timeline/index.ts']) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|https?:\/\/|DeepSeek|model_caller|ProductionModelCaller|provider|network/i);
    }
    await openMemoryDbWithRecords();
    const result = await readCustomerTimeline({ customer_id: 'customer-1' });
    expect(result.records.length).toBeGreaterThan(0);
  });

  it('T12: existing path parity — A4R capability output equals the real product read path output (not legacy agent tool parity)', async () => {
    await openMemoryDbWithRecords();
    // (a) timeline.customer.read == 真实产品 Timeline 路径（listFollowUps + listVisits → buildCustomerTimeline）
    const viaAdapter = await readCustomerTimeline({ customer_id: 'customer-1' });
    const [followUps, visits] = await Promise.all([listFollowUps('customer-1'), listVisits('customer-1')]);
    const productTimeline = buildCustomerTimeline(followUps, visits);
    expect(viaAdapter.records).toEqual(productTimeline);
    expect(viaAdapter.evidence_refs).toEqual(productTimeline.map(item => item.evidenceId));
    // (b) timeline.visit.read == 真实产品 Visit 读取（db.ts listVisits）
    expect((await readCustomerVisits({ customer_id: 'customer-1' })).records).toEqual(await listVisits('customer-1'));
    // (c) LEGACY_AGENT_TOOL_SEMANTIC_MISMATCH 证据：legacy get_customer_timeline 快照投影
    //     不含真实产品记录（fu-1 / visit-1），与产品路径输出不同——A4R 未以 legacy 为 oracle
    const legacySnapshot = makeSnapshot([{ id: 'task-a1', customer_id: 'customer-1', title: 'A1 报价' }], [{ id: 'work-a1', customer_id: 'customer-1', company_name: 'Ada Co' }]);
    // (c) legacy snapshot tools are retired from the production runtime
    expect(() => executeSalesAgentReadTool('get_customer_timeline', { customer_id: 'customer-1', snapshot: legacySnapshot, context: legacyContext })).toThrow(/LEGACY_WRONG_TIMELINE_RUNTIME_RETIRED/);
    expect(() => executeSalesAgentReadTool('list_customer_followups', { customer_id: 'customer-1', snapshot: legacySnapshot, context: legacyContext })).toThrow(/LEGACY_WRONG_TIMELINE_RUNTIME_RETIRED/);
    expect(() => executeSalesAgentReadTool('list_customer_visits', { customer_id: 'customer-1', snapshot: legacySnapshot, context: legacyContext })).toThrow(/LEGACY_WRONG_TIMELINE_RUNTIME_RETIRED/);
  });

  it('T13: unknown/invalid scope fails closed — no accidental global read', async () => {
    // 空/空白客户范围 → 显式拒绝（fail closed）
    await expect(readCustomerTimeline({ customer_id: '' })).rejects.toThrow(/customer scope/);
    await expect(readCustomerTimeline({ customer_id: '   ' })).rejects.toThrow(/customer scope/);
    await expect(readCustomerVisits({ customer_id: '' })).rejects.toThrow(/customer scope/);
    // 未知客户 → 真实产品函数语义：空数组，绝不返回其他客户数据
    await openMemoryDbWithRecords();
    expect((await readCustomerTimeline({ customer_id: 'customer-unknown' })).records).toEqual([]);
    expect((await readCustomerVisits({ customer_id: 'customer-unknown' })).records).toEqual([]);
    expect(await listVisits('customer-unknown')).toEqual([]);
    expect(await listFollowUps('customer-unknown')).toEqual([]);
    // 全局列表函数从未作为 executor 进入 manifest（静态证明无全局读取暴露）
    for (const definition of TIMELINE_READ_CAPABILITY_MANIFEST) {
      expect(definition.executor_ref).not.toMatch(/listAllVisits|listAllFollowUps/);
    }
  });
});
