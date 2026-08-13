/**
 * V0.2A / A5R — Follow-up Read Capabilities 聚焦契约测试。
 *
 * 覆盖规格 T1–T13：
 *   T1  MANIFEST CONTRACT       每个生产能力符合冻结 A1 CapabilityDefinition
 *   T2  DOMAIN COMPOSITION      通过 A1 扩展缝组合，不编辑 A1 中央文件
 *   T3  INVENTORY TRUTH         仅真实产品能力进入生产 manifest
 *   T4  CUSTOMER FOLLOW-UP READ 客户作用域读取返回正确记录
 *   T5  CROSS-CUSTOMER ISOLATION 客户 A 零客户 B 记录
 *   T6  GLOBAL VS CUSTOMER SCOPE 全局/客户作用域语义区分且真实存在
 *   T7  SINGLE FOLLOW-UP DETAIL 证明单条读取能力不存在（NOT_EXISTING）
 *   T8  RECORD TRUTH            返回字段真实反映持久化记录，无合成状态
 *   T9  NEXT-FOLLOW-UP DISTINCTION Customer.next_follow_up_at 与记录字段分离
 *   T10 ZERO WRITES             读取执行期间零写语句
 *   T11 ZERO MODEL / NETWORK     零模型 / 零 Provider / 零网络
 *   T12 EXISTING PATH PARITY    与现有 db.ts 读取路径语义对齐
 *   T13 UNKNOWN CUSTOMER / INVALID SCOPE 无效作用域 fail closed
 *
 * 集成证据：真实 better-sqlite3 :memory: schema + __setDbInstanceForTests 后门
 * → A5R 生产绑定（真实 db.ts 路径）→ 真实记录 → 客户隔离 → 零写。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapabilityRegistry, type CapabilityDefinition } from '../lib/capabilities';
import {
  FOLLOW_UP_CAPABILITY_IDS,
  FOLLOW_UP_DOMAIN,
  FOLLOW_UP_READ_MANIFEST,
  FOLLOW_UP_READ_VERSION,
} from '../lib/capabilities/followUp';
import {
  FollowUpReadScopeError,
  createBoundFollowUpReadRepository,
  createProductionFollowUpReadRepository,
} from '../lib/capabilities/followUp';
import {
  __setDbInstanceForTests,
  initializeDatabaseSchema,
  listAllFollowUps,
  listFollowUps,
  type DatabaseLike,
} from '../lib/db';
import type { FollowUpRecord } from '../lib/types';

/* ------------------------------------------------------------------ */
/* fixture                                                            */
/* ------------------------------------------------------------------ */

const NOW = '2026-07-12T00:00:00.000Z';

function followUpRow(overrides: Partial<FollowUpRecord> & { id: string; customer_id: string }): FollowUpRecord {
  return {
    title: `跟进记录 ${overrides.id}`,
    contact_channel: null,
    contact_result: null,
    feedback_notes: null,
    intent_assessment: null,
    suggested_grade: null,
    next_action: null,
    next_follow_up_at: null,
    is_completed: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

interface Fixture {
  sqlite: Database.Database;
  db: DatabaseLike;
  /** SQL 语句记录器（仅用于 T10 零写断言）。 */
  executed: string[];
  seed: () => void;
  close: () => void;
}

function createFixture(): Fixture {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const executed: string[] = [];
  const db: DatabaseLike = {
    async execute(sql: string, bindings: unknown[] = []) {
      executed.push(sql);
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: result.changes };
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      executed.push(sql);
      return sqlite.prepare(sql).all(bindings as never[]) as T[];
    },
  };
  return {
    sqlite,
    db,
    executed,
    seed() {
      sqlite
        .prepare('INSERT INTO customers (id,name,customer_grade,stage,intent_level,next_follow_up_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run('customer-a', '客户甲', 'A', 'NEW_LEAD', 'HIGH', '2026-07-20T09:00:00Z', NOW, NOW);
      sqlite
        .prepare('INSERT INTO customers (id,name,customer_grade,stage,intent_level,next_follow_up_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run('customer-b', '客户乙', 'B', 'CONTACTED', 'MEDIUM', '2026-08-01T09:00:00Z', NOW, NOW);
      const insert = sqlite.prepare(
        `INSERT INTO follow_up_records
           (id, customer_id, title, contact_channel, contact_result, feedback_notes,
            intent_assessment, suggested_grade, next_action, next_follow_up_at,
            is_completed, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      // 显式按列顺序传参（不使用 Object.values：键顺序不保证）
      const insertRow = (row: FollowUpRecord): void => {
        insert.run(
          row.id, row.customer_id, row.title, row.contact_channel, row.contact_result,
          row.feedback_notes, row.intent_assessment, row.suggested_grade, row.next_action,
          row.next_follow_up_at, row.is_completed, row.created_at, row.updated_at,
        );
      };
      // 客户 A：2 条（created_at 倒序：a2 在前）
      insertRow(followUpRow({ id: 'fu-a1', customer_id: 'customer-a', title: '跟进甲-1', contact_channel: 'wechat', feedback_notes: '客户询问报价', next_follow_up_at: '2026-07-15T10:00:00Z', created_at: '2026-07-10T08:00:00.000Z', updated_at: '2026-07-10T08:00:00.000Z' }));
      insertRow(followUpRow({ id: 'fu-a2', customer_id: 'customer-a', title: '跟进甲-2', contact_channel: 'phone', contact_result: 'INTERESTED', intent_assessment: 'HIGH', next_follow_up_at: '2026-07-20T09:00:00Z', is_completed: 1, created_at: '2026-07-11T09:00:00.000Z', updated_at: '2026-07-11T09:00:00.000Z' }));
      // 客户 B：2 条
      insertRow(followUpRow({ id: 'fu-b1', customer_id: 'customer-b', title: '跟进乙-1', contact_channel: 'visit', feedback_notes: '客户要求对比方案', created_at: '2026-07-09T08:00:00.000Z', updated_at: '2026-07-09T08:00:00.000Z' }));
      insertRow(followUpRow({ id: 'fu-b2', customer_id: 'customer-b', title: '跟进乙-2', created_at: '2026-07-11T10:00:00.000Z', updated_at: '2026-07-11T10:00:00.000Z' }));
    },
    close() {
      sqlite.close();
    },
  };
}

/** 生产组合根 + 其 fixture 的打包返回（类型显式声明，避免隐式结构漂移）。 */
interface ProductionRepositoryBundle {
  fixture: Fixture;
  repository: ReturnType<typeof createProductionFollowUpReadRepository>;
}

/** 生产组合根（真实 db.ts 路径 + 后门注入的内存 SQLite）。 */
async function productionRepository(): Promise<ProductionRepositoryBundle> {
  const fixture = createFixture();
  await initializeDatabaseSchema(fixture.db);
  __setDbInstanceForTests(fixture.db);
  fixture.seed();
  return { fixture, repository: createProductionFollowUpReadRepository() };
}

let activeFixture: Fixture | null = null;

beforeEach(() => {
  __setDbInstanceForTests(null);
});

afterEach(() => {
  activeFixture?.close();
  activeFixture = null;
  __setDbInstanceForTests(null);
});

/* ------------------------------------------------------------------ */
/* T1 — MANIFEST CONTRACT                                             */
/* ------------------------------------------------------------------ */

describe('T1: manifest contract', () => {
  it('every A5R production capability conforms to the frozen A1 CapabilityDefinition', () => {
    const registry = createCapabilityRegistry(FOLLOW_UP_READ_MANIFEST);
    expect(registry.size()).toBe(2);

    for (const definition of FOLLOW_UP_READ_MANIFEST) {
      const stored = registry.get(definition.id, definition.version);
      expect(stored).toBeDefined();
      // 关键语义显式声明（A1 禁止静默默认）
      expect(stored.effect).toBe('READ');
      expect(stored.data_target).toBe('CRM_STATE');
      expect(stored.risk_level).toBe('LOW');
      expect(stored.authority_policy).toBe('AUTO');
      expect(stored.requires_confirmation).toBe(false);
      expect(stored.idempotency).toBe('SAFE');
      expect(stored.audit_contract).toEqual({
        audit_required: true,
        record_input: true,
        record_output: true,
        record_effect: false,
      });
      // 注册副本深度冻结（A1 变异安全）
      expect(Object.isFrozen(stored)).toBe(true);
      expect(Object.isFrozen(stored.audit_contract)).toBe(true);
    }
  });

  it('uses only frozen A1 vocabulary (no new enums, no intent names as identity)', () => {
    const forbidden = /CUSTOMER_FOLLOWUP_REVIEW|follow_up_get|upcoming_followups|overdue_followups|followup_summary/;
    for (const definition of FOLLOW_UP_READ_MANIFEST) {
      expect(definition.id).not.toMatch(forbidden);
    }
    // 领域身份是真实 Follow-up 读取动作，不是旧 Intent 名
    expect(FOLLOW_UP_CAPABILITY_IDS.customerRead).toBe('follow_up.customer.read');
    expect(FOLLOW_UP_CAPABILITY_IDS.globalRead).toBe('follow_up.global.read');
  });
});

/* ------------------------------------------------------------------ */
/* T2 — DOMAIN COMPOSITION                                            */
/* ------------------------------------------------------------------ */

describe('T2: domain composition', () => {
  it('composes through the A1 extension seam without editing A1 central files', () => {
    const registry = createCapabilityRegistry(FOLLOW_UP_READ_MANIFEST);
    expect(registry.listByDomain(FOLLOW_UP_DOMAIN).map((d) => d.id).sort()).toEqual(
      ['follow_up.customer.read', 'follow_up.global.read'],
    );

    // manifest 与 A1 fixture manifest 可共存组合（无中央 switch / 无集中数组）
    const fixtureManifest: readonly CapabilityDefinition[] = [
      {
        id: 'fixture.other.read',
        version: '1.0.0',
        domain: 'fixture-other',
        description: 'fixture other read',
        input_schema: 'fixture.other.query.v1',
        output_schema: 'fixture.other.result.v1',
        effect: 'READ',
        data_target: 'CRM_FACT',
        risk_level: 'LOW',
        authority_policy: 'AUTO',
        requires_confirmation: false,
        scope_requirement: 'NONE',
        idempotency: 'SAFE',
        executor_ref: 'fixture.executor.read.v1',
        audit_contract: { audit_required: true, record_input: true, record_output: true, record_effect: false },
        error_contract: 'UNSPECIFIED',
      },
    ];
    const combined = createCapabilityRegistry(FOLLOW_UP_READ_MANIFEST, fixtureManifest);
    expect(combined.size()).toBe(3);
    expect(combined.get('follow_up.customer.read', FOLLOW_UP_READ_VERSION).domain).toBe('follow-up');
  });

  it('manifest module has the same zero-dependency boundary as A1 registry (type-only import)', () => {
    const manifestSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/followUp/manifest.ts'), 'utf8');
    const imports = [...manifestSource.matchAll(/import\b[\s\S]*?from '([^']+)';/g)].map((m) => m[1]);
    expect(imports).toEqual(['../types']);
    expect(manifestSource).not.toMatch(/\bswitch\s*\(/);
  });
});

/* ------------------------------------------------------------------ */
/* T3 — INVENTORY TRUTH                                               */
/* ------------------------------------------------------------------ */

describe('T3: inventory truth', () => {
  it('only proven real product capabilities enter the production manifest', () => {
    const ids = FOLLOW_UP_READ_MANIFEST.map((d) => d.id).sort();
    // 审计证明存在的真实产品路径（db.listFollowUps / db.listAllFollowUps + 真实页面）
    expect(ids).toEqual(['follow_up.customer.read', 'follow_up.global.read']);
    // 不存在的产品能力绝不注册：单条读取 NOT_EXISTING；upcoming/overdue/summary 不发明
    const invented = /follow_up_get|upcoming_followups|overdue_followups|followup_summary|follow_up\.single|follow_up\.detail/;
    for (const definition of FOLLOW_UP_READ_MANIFEST) {
      expect(definition.id).not.toMatch(invented);
      expect(definition.description).not.toMatch(/overdue|upcoming/i);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T4 / T5 / T6 / T8 — customer read, isolation, scope, record truth  */
/* ------------------------------------------------------------------ */

describe('T4-T6, T8: customer read through the production path', () => {
  it('T4+T8: returns the correct persisted Follow-up records with truthful fields, newest first', async () => {
    const { fixture, repository } = await productionRepository();
    activeFixture = fixture;

    const records = await repository.listFollowUpsByCustomer('customer-a');
    expect(records).toHaveLength(2);
    // created_at 倒序（与 db.listFollowUps 语义一致）
    expect(records.map((r) => r.id)).toEqual(['fu-a2', 'fu-a1']);
    // 字段真实反映持久化行：无合成完成/状态
    const a2 = records.find((r) => r.id === 'fu-a2')!;
    expect(a2).toMatchObject({
      customer_id: 'customer-a',
      title: '跟进甲-2',
      contact_channel: 'phone',
      contact_result: 'INTERESTED',
      feedback_notes: null,
      intent_assessment: 'HIGH',
      next_follow_up_at: '2026-07-20T09:00:00Z',
      is_completed: 1,
      created_at: '2026-07-11T09:00:00.000Z',
      updated_at: '2026-07-11T09:00:00.000Z',
    });
    const a1 = records.find((r) => r.id === 'fu-a1')!;
    expect(a1).toMatchObject({
      title: '跟进甲-1',
      contact_channel: 'wechat',
      feedback_notes: '客户询问报价',
      is_completed: 0,
      next_follow_up_at: '2026-07-15T10:00:00Z',
    });
  });

  it('T5: customer A receives zero customer B records (cross-customer isolation)', async () => {
    const { fixture, repository } = await productionRepository();
    activeFixture = fixture;

    const a = await repository.listFollowUpsByCustomer('customer-a');
    const b = await repository.listFollowUpsByCustomer('customer-b');

    expect(a.every((r) => r.customer_id === 'customer-a')).toBe(true);
    expect(b.every((r) => r.customer_id === 'customer-b')).toBe(true);
    expect(a.map((r) => r.id)).toEqual(['fu-a2', 'fu-a1']);
    expect(b.map((r) => r.id)).toEqual(['fu-b2', 'fu-b1']);
    expect(new Set([...a, ...b].map((r) => r.id)).size).toBe(4);
  });

  it('T6: global scope is a distinct, real product behavior and scope metadata is truthful', async () => {
    const { fixture, repository } = await productionRepository();
    activeFixture = fixture;

    const globalRecords = await repository.listAllFollowUps();
    expect(globalRecords).toHaveLength(4);
    expect(globalRecords.map((r) => r.id)).toEqual(['fu-b2', 'fu-a2', 'fu-a1', 'fu-b1']); // created_at 倒序

    const customerA = await repository.listFollowUpsByCustomer('customer-a');
    // 全局 ⊇ 客户作用域；scope 元数据区分 CUSTOMER / GLOBAL
    expect(globalRecords.map((r) => r.id)).toEqual(expect.arrayContaining(customerA.map((r) => r.id)));
    const customerDef = FOLLOW_UP_READ_MANIFEST.find((d) => d.id === 'follow_up.customer.read')!;
    const globalDef = FOLLOW_UP_READ_MANIFEST.find((d) => d.id === 'follow_up.global.read')!;
    expect(customerDef.scope_requirement).toBe('CUSTOMER');
    expect(globalDef.scope_requirement).toBe('GLOBAL');
  });
});

/* ------------------------------------------------------------------ */
/* T7 — SINGLE FOLLOW-UP DETAIL (absence proof)                       */
/* ------------------------------------------------------------------ */

describe('T7: single Follow-up detail', () => {
  it('does not exist in the product and is absent from the production manifest (NOT_EXISTING)', () => {
    const dbSource = readFileSync(resolve(process.cwd(), 'src/lib/db.ts'), 'utf8');
    // 现有 db.ts 无单条跟进读取执行路径
    expect(dbSource).not.toMatch(/getFollowUp\b|followUpById\b/);
    // 生产 manifest 不注册单条读取能力
    expect(FOLLOW_UP_READ_MANIFEST.map((d) => d.id)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/follow_up\.(single|detail|get)/)]),
    );
    expect(FOLLOW_UP_READ_MANIFEST).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* T9 — NEXT-FOLLOW-UP DISTINCTION                                    */
/* ------------------------------------------------------------------ */

describe('T9: next_follow_up_at distinction', () => {
  it('Customer.next_follow_up_at is Customer state; the capability reads Follow-up records only', async () => {
    const { fixture, repository } = await productionRepository();
    activeFixture = fixture;

    // customers 表存在独立的 next_follow_up_at 状态字段（Customer 域，A2 归属）
    const customerRow = fixture.sqlite
      .prepare('SELECT next_follow_up_at FROM customers WHERE id = ?')
      .get('customer-a') as { next_follow_up_at: string };
    expect(customerRow.next_follow_up_at).toBe('2026-07-20T09:00:00Z');

    // A5R 输出 = follow_up_records 记录本身；绝不把 Customer 状态字段合成为记录
    const records = await repository.listFollowUpsByCustomer('customer-a');
    expect(records).toHaveLength(2);
    // 输出中每条记录的 next_follow_up_at 是记录字段值，且没有伪造"第 3 条"记录
    expect(records.map((r) => r.id)).not.toContain('synthetic-next-follow-up');
    for (const record of records) {
      expect(Object.prototype.hasOwnProperty.call(record, 'next_follow_up_at')).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* T10 — ZERO WRITES                                                  */
/* ------------------------------------------------------------------ */

describe('T10: zero writes', () => {
  it('reading through the production path executes only SELECT statements', async () => {
    const { fixture, repository } = await productionRepository();
    activeFixture = fixture;
    fixture.executed.length = 0; // 丢弃 schema 初始化期间的 DDL

    await repository.listFollowUpsByCustomer('customer-a');
    await repository.listAllFollowUps();

    const writes = fixture.executed.filter((sql) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql));
    expect(writes).toEqual([]);
    expect(fixture.executed.every((sql) => /^\s*SELECT\b/i.test(sql))).toBe(true);
  });

  it('A5R source never references any CRM write entry point', () => {
    const files = [
      'src/lib/capabilities/followUp/manifest.ts',
      'src/lib/capabilities/followUp/repository.ts',
      'src/lib/capabilities/followUp/production.ts',
      'src/lib/capabilities/followUp/index.ts',
    ];
    const writeTokens =
      /createFollowUp|updateFollowUp|deleteFollowUp|updateCustomer|update_next_follow_up_time|createTask|createVisit|confirmedWrite|approvedCrmWriteBoundary|create_proposal/;
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      // 只检查 import 语句（注释中的架构声明允许提及写入口以说明"绝不调用"）
      const imports = [...source.matchAll(/^import\b[\s\S]*?from '[^']+';/gm)].map((m) => m[0]);
      expect(imports.join('\n'), file).not.toMatch(writeTokens);
    }
    // 生产绑定只 import 现有只读函数
    const productionSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/followUp/production.ts'), 'utf8');
    expect(productionSource).toContain("from '../../db'");
    const productionImports = [...productionSource.matchAll(/^import\b[\s\S]*?from '[^']+';/gm)].map((m) => m[0]);
    expect(productionImports.join('\n')).not.toMatch(/createFollowUp|updateCustomer|createTask|createVisit/);
  });
});

/* ------------------------------------------------------------------ */
/* T11 — ZERO MODEL / NETWORK                                         */
/* ------------------------------------------------------------------ */

describe('T11: zero model / provider / network', () => {
  it('A5R domain modules contain no model / provider / network surface', () => {
    const files = [
      'src/lib/capabilities/followUp/manifest.ts',
      'src/lib/capabilities/followUp/repository.ts',
      'src/lib/capabilities/followUp/production.ts',
      'src/lib/capabilities/followUp/index.ts',
    ];
    const forbidden =
      /fetch\(|XMLHttpRequest|WebSocket|https?:\/\/|firecrawl|deepseek|model_called|model_call|\bLLM\b|agent_reach|web_search/i;
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(forbidden);
    }
    // provider / network 通过 import 边界保证（manifest 仅 type-only '../types'；
    // production 唯一外部依赖是现有 db.ts 只读路径）
    const productionSource = readFileSync(resolve(process.cwd(), 'src/lib/capabilities/followUp/production.ts'), 'utf8');
    const imports = [...productionSource.matchAll(/import\b[\s\S]*?from '([^']+)';/g)].map((m) => m[1]);
    expect(imports.filter((i) => !i.startsWith('./'))).toEqual(['../../db']);
  });
});

/* ------------------------------------------------------------------ */
/* T12 — EXISTING PATH PARITY                                         */
/* ------------------------------------------------------------------ */

describe('T12: existing path parity', () => {
  it('the production binding returns exactly what the existing db.ts path returns', async () => {
    const fixture = createFixture();
    await initializeDatabaseSchema(fixture.db);
    __setDbInstanceForTests(fixture.db);
    fixture.seed();
    activeFixture = fixture;

    const repository = createProductionFollowUpReadRepository();

    // 同一 dbInstance：A5R 生产绑定与现有 db.listFollowUps / db.listAllFollowUps 结果完全一致
    expect(await repository.listFollowUpsByCustomer('customer-a')).toEqual(await listFollowUps('customer-a'));
    expect(await repository.listAllFollowUps()).toEqual(await listAllFollowUps());
  });
});

/* ------------------------------------------------------------------ */
/* T13 — UNKNOWN CUSTOMER / INVALID SCOPE                             */
/* ------------------------------------------------------------------ */

describe('T13: unknown customer / invalid scope fails closed', () => {
  it('missing or blank customer_id throws and never broadens to global scope', async () => {
    const { fixture, repository } = await productionRepository();
    activeFixture = fixture;

    // 独立绑定：记录 listAllFollowUps 是否被意外调用
    const calls: string[] = [];
    const bound = createBoundFollowUpReadRepository({
      listFollowUps: async () => [],
      listAllFollowUps: async () => {
        calls.push('listAllFollowUps');
        return [];
      },
    });

    await expect(bound.listFollowUpsByCustomer('')).rejects.toBeInstanceOf(FollowUpReadScopeError);
    await expect(bound.listFollowUpsByCustomer('   ')).rejects.toBeInstanceOf(FollowUpReadScopeError);
    await expect(bound.listFollowUpsByCustomer(null as unknown as string)).rejects.toBeInstanceOf(FollowUpReadScopeError);
    expect(calls).toEqual([]); // 绝不拓宽为全量读取
    void repository; // 生产路径实例保留（隔离/真值用例已覆盖）
  });
});

/* ------------------------------------------------------------------ */
/* 集成证据汇总                                                        */
/* ------------------------------------------------------------------ */

describe('integration evidence', () => {
  it('persisted SQLite records → A5R capability → real records, isolation, zero writes', async () => {
    const { fixture, repository } = await productionRepository();
    activeFixture = fixture;
    fixture.executed.length = 0;

    const records = await repository.listFollowUpsByCustomer('customer-a');
    const all = await repository.listAllFollowUps();

    expect(records.map((r) => r.id)).toEqual(['fu-a2', 'fu-a1']);
    expect(all).toHaveLength(4);
    expect(fixture.executed.filter((sql) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))).toEqual([]);
    // 持久化记录计数未变（零写 + 记录真值）
    const count = fixture.sqlite.prepare('SELECT COUNT(*) AS c FROM follow_up_records').get() as { c: number };
    expect(count.c).toBe(4);
  });
});
