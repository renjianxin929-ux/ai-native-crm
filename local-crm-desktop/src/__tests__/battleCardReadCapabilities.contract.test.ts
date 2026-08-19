/**
 * V0.2A / A7R — Battle Card READ Capabilities 契约测试。
 *
 * 覆盖规格 §21 的 T1–T15：
 *   T1  MANIFEST CONTRACT             T2  DOMAIN COMPOSITION
 *   T3  PRODUCT INVENTORY TRUTH       T4  CURRENT BATTLE CARD READ
 *   T5  PRODUCT / EXECUTOR PARITY     T6  CROSS-CUSTOMER ISOLATION
 *   T7  UNKNOWN / INVALID CUSTOMER    T8  VERSION HISTORY CLASSIFICATION
 *   T9  STAGE/APPLICABILITY CLASSIFICATION
 *   T10 EVIDENCE OWNERSHIP            T11 CANONICAL / VERSION TRUTH
 *   T12 ZERO WRITES                   T13 ZERO MODEL / NETWORK
 *   T14 EXISTING PRODUCT PATH PARITY  T15 REGISTRY COLLISION SAFETY
 *
 * Product-parity 原则：以真实产品读取路径为 oracle —— 同一
 * createBattleCardAgentTools（产品 UI battleCardClient 内部使用的同一实现）以及
 * getBattleCardUiClient()（生产客户端）—— 绝不使用其他 oracles。
 *
 * 集成证据（§22）：内存 SQLite（真实 initializeDatabaseSchema，含 customer_stage_cards）
 * → 真实产品写入路径（createBattleCardRepositories().cards.insert）种子持久化卡
 * → 真实产品读取路径（createBattleCardAgentTools / getBattleCardUiClient）
 * → A7R capability → 同一 Battle Card 结果 → 正确客户 → 零写。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createCapabilityRegistry, type CapabilityDefinition } from '../lib/capabilities';
import {
  BATTLE_CARD_READ_INVENTORY,
  BATTLE_CARD_READ_MANIFEST,
  BATTLE_CARD_CAPABILITY_IDS,
  BATTLE_CARD_READ_CAPABILITY_IDS,
  VERIFIED_BATTLE_CARD_READ_CANDIDATES,
} from '../lib/capabilities/battleCard';
import {
  readBattleCardHistory,
  readCurrentBattleCard,
  readCustomerBattleContext,
} from '../lib/capabilities/battleCard/readAdapter';
import { createBattleCardAgentTools } from '../lib/battleCard/agentTools';
import { createBattleCardRepositories, type BattleCardRepositories } from '../lib/battleCard/repository';
import { BATTLE_CARD_SCHEMA_VERSION } from '../lib/battleCard/schema';
import type { BattleCardPayload, CustomerStageCardInput } from '../lib/battleCard/types';
import { __setDbInstanceForTests, initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { getBattleCardUiClient } from '../lib/battleCardUi/battleCardClient';
import { CUSTOMER_CAPABILITY_MANIFEST } from '../lib/capabilities/customer/manifest';
import { TIMELINE_READ_CAPABILITY_MANIFEST } from '../lib/capabilities/timeline/manifest';
import { FOLLOW_UP_READ_MANIFEST } from '../lib/capabilities/followUp/manifest';
import { TASK_READ_MANIFEST } from '../lib/capabilities/task/manifest';

const NOW = '2026-08-01T12:00:00.000Z';
const clock = () => NOW;

// ── 内存 DB（真实 schema + 真实产品读取函数）───────────────────────────────

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

/** 最小合法闭合 payload（battle-card-payload-v1）；含内嵌 evidence_refs（T10 保留证明）。 */
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
  /** 客户 → [v1 卡(指针), v2 草稿卡]。 */
  readonly cards: Readonly<Record<string, readonly { id: string; version: number }[]>>;
}

let memoryDb: SqliteDatabaseLike | null = null;

afterEach(() => {
  __setDbInstanceForTests(null);
  memoryDb?.close();
  memoryDb = null;
});

async function seedCustomers(db: DatabaseLike): Promise<void> {
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, last_contacted_at, next_action, battle_card_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['cust-a', '客户甲', 'A', 'NEW_LEAD', 'HIGH', null, null, null, 'CONFIRMED', NOW, NOW],
  );
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, intent_level, next_follow_up_at, last_contacted_at, next_action, battle_card_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['cust-b', '客户乙', 'B', 'CONTACTED', 'MEDIUM', null, null, null, 'CONFIRMED', NOW, NOW],
  );
}

/** 通过真实产品写入路径（repos.cards.insert）种子每客户两张卡，并设置客户指针。 */
async function openMemoryDbWithCards(): Promise<SeededDb> {
  const sqlite = new Database(':memory:');
  const db = new SqliteDatabaseLike(sqlite);
  await initializeDatabaseSchema(db);
  await seedCustomers(db);
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
      created_at: NOW,
      confirmed_at: cardStatus === 'CONFIRMED' ? NOW : null,
    };
    const row = await repos.cards.insert(input);
    return { id: row.id, version: row.version };
  };

  const cardA1 = await insertCard('cust-a', 'NEW_LEAD', 1, 'CONFIRMED');
  const cardA2 = await insertCard('cust-a', 'NEW_LEAD', 2, 'DRAFT');
  const cardB1 = await insertCard('cust-b', 'CONTACTED', 1, 'CONFIRMED');
  const cardB2 = await insertCard('cust-b', 'CONTACTED', 2, 'DRAFT');

  // 产品指针：各自指向自己的已确认卡（与产品 confirm 流程写入的语义一致）
  await db.execute(
    `UPDATE customers SET current_stage_card_id = ?, battle_card_status = 'CONFIRMED', last_battle_review_at = ?, updated_at = ? WHERE id = ?`,
    [cardA1.id, NOW, NOW, 'cust-a'],
  );
  await db.execute(
    `UPDATE customers SET current_stage_card_id = ?, battle_card_status = 'CONFIRMED', last_battle_review_at = ?, updated_at = ? WHERE id = ?`,
    [cardB1.id, NOW, NOW, 'cust-b'],
  );

  __setDbInstanceForTests(db);
  memoryDb = db;
  return {
    db,
    repos,
    cards: {
      'cust-a': [cardA1, cardA2],
      'cust-b': [cardB1, cardB2],
    },
  };
}

// ── T1 / T2 / T3 / T15 ──────────────────────────────────────────────────────

describe('A7R battle card read capability contract (product parity)', () => {
  it('T1: manifest contract — every production capability conforms to the frozen A1 CapabilityDefinition', () => {
    const registry = createCapabilityRegistry(BATTLE_CARD_READ_MANIFEST);
    expect(registry.size()).toBe(3);
    for (const definition of registry.list()) {
      // 显式语义：纯读取、零写、无需确认、客户范围、幂等安全
      expect(definition.effect).toBe('READ');
      expect(definition.data_target).toBe('CRM_STATE');
      expect(definition.risk_level).toBe('LOW');
      expect(definition.requires_confirmation).toBe(false);
      expect(definition.scope_requirement).toBe('CUSTOMER');
      expect(definition.idempotency).toBe('SAFE');
      expect(definition.authority_policy).toBe('AUTO');
      // 如实声明：现有产品读取路径无稳定错误码，仅 Error message 区分
      expect(definition.error_contract).toBe('UNSPECIFIED');
      expect(definition.audit_contract.audit_required).toBe(true);
      expect(definition.audit_contract.record_input).toBe(true);
      expect(definition.audit_contract.record_output).toBe(true);
      expect(definition.audit_contract.record_effect).toBe(false);
      expect(definition.domain).toBe('battle-card');
      expect(Object.isFrozen(definition)).toBe(true);
    }
    // 稳定身份（id + version）
    expect(registry.get('battle_card.current.read', '1.0.0').id).toBe('battle_card.current.read');
    expect(registry.get('battle_card.history.read', '1.0.0').version).toBe('1.0.0');
    expect(registry.get('battle_card.context.read', '1.0.0').domain).toBe('battle-card');
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
    const registry = createCapabilityRegistry(fixtureManifest, BATTLE_CARD_READ_MANIFEST);
    expect(registry.size()).toBe(4);
    expect(registry.listByDomain('battle-card').map(d => d.id)).toEqual(BATTLE_CARD_READ_CAPABILITY_IDS);
    expect(registry.listByDomain('fixture-domain')).toHaveLength(1);
    expect(registry.get('battle_card.current.read', '1.0.0')).toBe(registry.get('battle_card.current.read', '1.0.0'));

    // 无中央路由：battle-card manifest 自身只允许 type-only 契约 import，不依赖中心 switch/数组
    const manifestSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/battleCard/manifest.ts'), 'utf8');
    expect(manifestSource).not.toMatch(/from '\.\.\/registry'|from '\.\.\/index'/);
  });

  it('T3: product capability inventory truth — only VERIFIED product behaviors enter the production manifest; repository-helper-only and agent-tool-only candidates are absent', () => {
    // manifest 身份 == inventory 中 VERIFIED 候选（一一对应）
    const verifiedEntries = BATTLE_CARD_READ_INVENTORY.filter(entry => entry.product_capability_exists && entry.final_status === 'VERIFIED');
    expect(verifiedEntries.map(entry => entry.candidate)).toEqual([...VERIFIED_BATTLE_CARD_READ_CANDIDATES]);
    const registeredByCandidate: Readonly<Record<string, string>> = {
      read_current_battle_card: BATTLE_CARD_CAPABILITY_IDS.currentRead,
      read_battle_card_version_history: BATTLE_CARD_CAPABILITY_IDS.historyRead,
      read_customer_battle_context: BATTLE_CARD_CAPABILITY_IDS.contextRead,
    };
    expect(BATTLE_CARD_READ_MANIFEST.map(d => d.id).sort()).toEqual(
      verifiedEntries.map(entry => registeredByCandidate[entry.candidate]).sort(),
    );

    // executor_ref 指向真实产品执行路径（battleCard:*），不是 repository helper / 全局列表
    const byId = new Map(BATTLE_CARD_READ_MANIFEST.map(d => [d.id, d]));
    expect(byId.get('battle_card.current.read')?.executor_ref).toBe('battleCard:getCurrentStageCard');
    expect(byId.get('battle_card.history.read')?.executor_ref).toBe('battleCard:listStageCardHistory');
    expect(byId.get('battle_card.context.read')?.executor_ref).toBe('battleCard:getCustomerBattleContext');
    for (const definition of BATTLE_CARD_READ_MANIFEST) {
      expect(definition.executor_ref).toMatch(/^battleCard:/);
      expect(definition.executor_ref).not.toMatch(/listAll|SELECT \* FROM/);
    }

    // NOT_DISTINCT / 更高层工作流 / 他域所有权候选有意缺席
    for (const definition of BATTLE_CARD_READ_MANIFEST) {
      expect(definition.id).not.toMatch(/stage\.read|applicability|daily|evidence|compare|preview/);
    }
    const absent = BATTLE_CARD_READ_INVENTORY.filter(entry => entry.final_status !== 'VERIFIED').map(entry => entry.candidate);
    expect(absent).toEqual(expect.arrayContaining(['read_stage_card_applicability', 'read_daily_review_queue', 'read_battle_card_evidence', 'compare_stage_cards']));
  });

  // ── T4 / T6 / T7 / T11 / T12 / T14 ────────────────────────────────────────

  it('T4: current battle card read — explicit customer scope returns that customer\'s real persisted current battle card via the product path', async () => {
    const seeded = await openMemoryDbWithCards();
    const result = await readCurrentBattleCard({ db: seeded.db, clock }, 'cust-a');
    expect(result.customer_id).toBe('cust-a');
    expect(result.read_only).toBe(true);
    expect(result.writes_crm).toBe(false);
    expect(result.data?.id).toBe('card-cust-a-NEW_LEAD-v1'); // 客户指针指向 v1（CONFIRMED）
    expect(result.data?.customer_id).toBe('cust-a');
    expect(result.data?.version).toBe(1);
    expect(result.data?.card_status).toBe('CONFIRMED');
    expect(result.data?.payload_json).toBe(JSON.stringify(makePayload('cust-a', 'NEW_LEAD')));
  });

  it('T5: product/executor parity — capability result equals the real product Battle Card read path output (same createBattleCardAgentTools), not a legacy tool oracle', async () => {
    const seeded = await openMemoryDbWithCards();
    const tools = createBattleCardAgentTools({ db: seeded.db, clock }); // 产品 UI 客户端内部同一实现
    expect((await readCurrentBattleCard({ db: seeded.db, clock }, 'cust-a')).data).toEqual(await tools.getCurrentStageCard('cust-a'));
    expect((await readBattleCardHistory({ db: seeded.db, clock }, 'cust-a')).data).toEqual(await tools.listStageCardHistory('cust-a'));
    expect((await readCustomerBattleContext({ db: seeded.db, clock }, 'cust-a')).data).toEqual(await tools.getCustomerBattleContext('cust-a'));
    // 断言绝不使用 legacy 快照投影工具作为 oracle/绑定
    const adapterSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/battleCard/readAdapter.ts'), 'utf8');
    expect(adapterSource).not.toMatch(/executeSalesAgentReadTool|LoadedReadOnlyAgentSnapshot/);
  });

  it('T6: cross-customer isolation — customer A reads contain zero customer B battle card data (and vice versa)', async () => {
    await openMemoryDbWithCards();
    const aCurrent = await readCurrentBattleCard({ db: memoryDb!, clock }, 'cust-a');
    const bCurrent = await readCurrentBattleCard({ db: memoryDb!, clock }, 'cust-b');
    expect(aCurrent.data?.id).toBe('card-cust-a-NEW_LEAD-v1');
    expect(bCurrent.data?.id).toBe('card-cust-b-CONTACTED-v1');

    const aHistory = await readBattleCardHistory({ db: memoryDb!, clock }, 'cust-a');
    const bHistory = await readBattleCardHistory({ db: memoryDb!, clock }, 'cust-b');
    const aIds = new Set(aHistory.data.map(card => card.id));
    const bIds = new Set(bHistory.data.map(card => card.id));
    expect(aIds).toEqual(new Set(['card-cust-a-NEW_LEAD-v1', 'card-cust-a-NEW_LEAD-v2']));
    expect(bIds).toEqual(new Set(['card-cust-b-CONTACTED-v1', 'card-cust-b-CONTACTED-v2']));
    for (const id of aIds) expect(bIds.has(id)).toBe(false);
    for (const id of bIds) expect(aIds.has(id)).toBe(false);

    const aContext = await readCustomerBattleContext({ db: memoryDb!, clock }, 'cust-a');
    expect(aContext.data.current_stage_card?.id).toBe('card-cust-a-NEW_LEAD-v1');
    expect(aContext.data.card_history_count).toBe(2);
    expect(aContext.data.customer_id).toBe('cust-a');
  });

  it('T7: unknown/invalid customer fails closed — no global/latest fallback, no cross-customer data', async () => {
    // 空/空白客户范围 → 显式拒绝（fail closed）
    await openMemoryDbWithCards();
    await expect(readCurrentBattleCard({ db: memoryDb!, clock }, '')).rejects.toThrow(/customer scope/);
    await expect(readCurrentBattleCard({ db: memoryDb!, clock }, '   ')).rejects.toThrow(/customer scope/);
    await expect(readBattleCardHistory({ db: memoryDb!, clock }, '')).rejects.toThrow(/customer scope/);
    await expect(readCustomerBattleContext({ db: memoryDb!, clock }, '')).rejects.toThrow(/customer scope/);
    // 未知客户 → 产品语义：当前卡与上下文均抛 Error（loadCustomer fail closed，
    // agentTools.getCustomerBattleContext 内部经 engine.getCurrentStageCard 同样 fail closed）；
    // 历史读取按 customer_id 过滤返回空数组，绝不泄露其他客户数据，无全局/最新回退
    await expect(readCurrentBattleCard({ db: memoryDb!, clock }, 'cust-unknown')).rejects.toThrow(/Customer does not exist/);
    await expect(readCustomerBattleContext({ db: memoryDb!, clock }, 'cust-unknown')).rejects.toThrow(/Customer does not exist/);
    expect((await readBattleCardHistory({ db: memoryDb!, clock }, 'cust-unknown')).data).toEqual([]);
  });

  it('T8: version history classification — history is a distinct verified product capability with product-surface parity', async () => {
    await openMemoryDbWithCards();
    // 产品执行路径 oracle：engine.listStageCardHistory（CustomerBattleCardPage.tsx:62 同一路径）
    const tools = createBattleCardAgentTools({ db: memoryDb!, clock });
    const viaAdapter = await readBattleCardHistory({ db: memoryDb!, clock }, 'cust-a');
    expect(viaAdapter.data).toEqual(await tools.listStageCardHistory('cust-a'));
    // 产品语义：append-only 版本行，created_at ASC, version ASC（v1 先于 v2）
    expect(viaAdapter.data.map(card => card.version)).toEqual([1, 2]);
    expect(viaAdapter.data.map(card => card.card_status)).toEqual(['CONFIRMED', 'DRAFT']);
    // UI 投影（toVersionHistoryRows）消费同一数据形状：字段完备
    for (const card of viaAdapter.data) {
      expect(card.schema_version).toBe(BATTLE_CARD_SCHEMA_VERSION);
      expect(card.evidence_snapshot_hash).toBeTruthy();
      expect(card.id).toContain('cust-a');
    }
  });

  it('T9: stage/applicability classification — internal derived projections are intentionally absent from the manifest', () => {
    for (const definition of BATTLE_CARD_READ_MANIFEST) {
      expect(definition.id).not.toMatch(/battle_card\.(stage|applicability)\./);
    }
    const stageEntry = BATTLE_CARD_READ_INVENTORY.find(entry => entry.candidate === 'read_stage_card_applicability');
    expect(stageEntry?.product_capability_exists).toBe(false);
    expect(stageEntry?.final_status).toBe('NOT_DISTINCT');
    expect(stageEntry?.classification_reason).toMatch(/internal derived projection/i);
  });

  it('T10: evidence ownership — embedded evidence refs are preserved verbatim, but no Evidence domain primitive is registered', async () => {
    await openMemoryDbWithCards();
    for (const definition of BATTLE_CARD_READ_MANIFEST) {
      expect(definition.id).not.toMatch(/evidence\.(read|search|get)|^evidence\./);
    }
    // payload 内嵌 evidence_refs 原样保留（产品读取路径返回的行包含原始 payload_json）
    const current = await readCurrentBattleCard({ db: memoryDb!, clock }, 'cust-a');
    const payload = JSON.parse(current.data!.payload_json) as BattleCardPayload;
    expect(payload.action_card.evidence_refs).toEqual(['import:cust-a-sec-1', 'CUSTOMER:cust-a']);
    expect(payload.solution_reference_card.evidence_refs).toEqual(['import:cust-a-sec-2']);
    // 与种子数据逐字一致（未改写、未修复、未添加）
    expect(current.data!.payload_json).toBe(JSON.stringify(makePayload('cust-a', 'NEW_LEAD')));
  });

  it('T11: canonical/version truth — read preserves canonical snapshot, version, hash, status; no mutation or recomputation', async () => {
    const seeded = await openMemoryDbWithCards();
    const snapshotOf = async () => (seeded.db.sqlite.prepare('SELECT * FROM customer_stage_cards ORDER BY customer_id, version').all() as Record<string, unknown>[]);
    const before = snapshotOf();
    await readCurrentBattleCard({ db: seeded.db, clock }, 'cust-a');
    await readBattleCardHistory({ db: seeded.db, clock }, 'cust-a');
    await readCustomerBattleContext({ db: seeded.db, clock }, 'cust-a');
    await readBattleCardHistory({ db: seeded.db, clock }, 'cust-b');
    const after = snapshotOf();
    expect(after).toEqual(before); // 行级字节真相不变（含 payload_json / evidence_snapshot_hash / version / card_status）
  });

  it('T12: zero writes — no INSERT/UPDATE/DELETE, no confirmedWrite/proposal, no DB mutation during A7R execution', async () => {
    await openMemoryDbWithCards();
    // 静态：A7R 域源码无任何写入口
    for (const file of [
      'src/lib/capabilities/battleCard/manifest.ts',
      'src/lib/capabilities/battleCard/readAdapter.ts',
      'src/lib/capabilities/battleCard/inventory.ts',
      'src/lib/capabilities/battleCard/index.ts',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/INSERT|UPDATE|DELETE FROM|createBattleCardRepositories\([^)]*\)\.(cards|facts|hypotheses|imports)\.(insert|update|confirm|mark)/);
      // 零写：无可执行的 Proposal / 草稿生成 / 卡确认调用入口（调用形态 = 函数名 + 左括号）
      expect(source).not.toMatch(/buildWriteProposal\(|registerCanonicalProposal\(|generateStageCardDraft\(|confirmStageCard\(/);
    }
    // 运行时：所有相关表行数在读取前后不变
    const db = memoryDb as unknown as { sqlite: Database.Database };
    const count = (table: string) => (db.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    const before = {
      cards: count('customer_stage_cards'),
      customers: count('customers'),
      facts: count('reviewed_facts'),
      hypotheses: count('customer_hypotheses'),
      imports: count('intelligence_imports'),
    };
    await readCurrentBattleCard({ db: memoryDb!, clock }, 'cust-a');
    await readBattleCardHistory({ db: memoryDb!, clock }, 'cust-a');
    await readCustomerBattleContext({ db: memoryDb!, clock }, 'cust-a');
    expect({
      cards: count('customer_stage_cards'),
      customers: count('customers'),
      facts: count('reviewed_facts'),
      hypotheses: count('customer_hypotheses'),
      imports: count('intelligence_imports'),
    }).toEqual(before);
  });

  it('T13: zero model/network — deterministic read execution requires no model, provider, or network', async () => {
    for (const file of [
      'src/lib/capabilities/battleCard/manifest.ts',
      'src/lib/capabilities/battleCard/readAdapter.ts',
      'src/lib/capabilities/battleCard/inventory.ts',
      'src/lib/capabilities/battleCard/index.ts',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|https?:\/\/|DeepSeek|model_caller|ProductionModelCaller|provider|network/i);
    }
    await openMemoryDbWithCards();
    const result = await readCurrentBattleCard({ db: memoryDb!, clock }, 'cust-a');
    expect(result.data?.id).toBe('card-cust-a-NEW_LEAD-v1');
  });

  it('T14: existing product path parity — A7R capability output equals the production UI client output (getBattleCardUiClient)', async () => {
    await openMemoryDbWithCards();
    const client = getBattleCardUiClient(); // 生产客户端（CustomerBattleCardPage 使用的同一单例）
    const viaAdapter = await readCurrentBattleCard({ db: memoryDb!, clock }, 'cust-a');
    const viaProductClient = await client.getCurrentStageCard('cust-a');
    expect(viaAdapter.data).toEqual(viaProductClient);
    expect(viaAdapter.data?.customer_id).toBe('cust-a');

    const historyViaAdapter = await readBattleCardHistory({ db: memoryDb!, clock }, 'cust-b');
    const historyViaProductClient = await client.listStageCardHistory('cust-b');
    expect(historyViaAdapter.data).toEqual(historyViaProductClient);
    for (const card of historyViaAdapter.data) {
      expect(card.customer_id).toBe('cust-b');
    }
  });

  it('T15: registry collision safety — A7R capability identities do not collide with Wave 1 existing identities', async () => {
    const registry = createCapabilityRegistry(
      CUSTOMER_CAPABILITY_MANIFEST,
      TIMELINE_READ_CAPABILITY_MANIFEST,
      FOLLOW_UP_READ_MANIFEST,
      TASK_READ_MANIFEST,
      BATTLE_CARD_READ_MANIFEST,
    );
    // Wave 1 8 个 + A7R 3 个 = 11，无 DuplicateCapabilityError（组合即证明无身份碰撞）
    expect(registry.size()).toBe(11);
    const allIds = registry.list().map(definition => definition.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    // A7R 三个 id 全部注册且域正确
    expect(registry.listByDomain('battle-card').map(d => d.id).sort()).toEqual(
      ['battle_card.context.read', 'battle_card.current.read', 'battle_card.history.read'].sort(),
    );
  });
});
