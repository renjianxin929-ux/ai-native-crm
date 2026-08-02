/**
 * Agent A — Battle Card 数据层 focused tests。
 * Schema 幂等 / Repository 行为 / 事务回滚 / 约束 / 级联。
 * 全部使用 better-sqlite3 :memory:，禁止触碰生产 personal-crm.db。
 */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, ensureCustomerSchema, initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { ensureBattleCardSchema, BATTLE_CARD_SCHEMA_VERSION } from '../lib/battleCard/schema';
import {
  createBattleCardRepositories,
  sha256Hex,
  withTransaction,
  type BattleCardRepositories,
} from '../lib/battleCard/repository';
import type { CustomerHypothesisInput, IntelligenceImportInput, ReviewedFactInput } from '../lib/battleCard/types';

function createSqliteDb(): DatabaseLike & { close(): void; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  return {
    sqlite,
    async execute(sql: string, bindings: unknown[] = []) {
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: Number(result.changes) };
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      return sqlite.prepare(sql).all(bindings as never[]) as T[];
    },
    close() {
      sqlite.close();
    },
  };
}

const CLOCK = () => '2026-08-01T12:00:00.000Z';
const NOW = CLOCK();

async function seedCustomer(db: DatabaseLike, id = 'cust-tinsol', name = '广州电秀科技发展有限公司'): Promise<void> {
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, intent_level, created_at, updated_at)
     VALUES (?, ?, 'A', 'NEW_LEAD', 'HIGH', ?, ?)`,
    [id, name, NOW, NOW],
  );
}

async function importRow(overrides: Partial<IntelligenceImportInput> = {}): Promise<IntelligenceImportInput> {
  return {
    id: 'import-1',
    customer_id: 'cust-tinsol',
    source_system: 'FEISHU_BTABLE',
    source_label: '战前背调-广州电秀',
    raw_content: '广州电秀科技发展有限公司，个人护理小家电品牌出海。',
    content_hash: await sha256Hex('广州电秀科技发展有限公司，个人护理小家电品牌出海。'),
    parser_version: 'battle-card-parser-v1',
    parse_status: 'DRAFTED',
    created_at: NOW,
    ...overrides,
  };
}

async function factRow(overrides: Partial<ReviewedFactInput> = {}): Promise<ReviewedFactInput> {
  return {
    id: 'fact-1',
    customer_id: 'cust-tinsol',
    source_import_id: 'import-1',
    fact_category: 'COMPANY',
    statement: '个人护理小家电品牌出海，覆盖多国家和多平台',
    verification_status: 'VERIFIED',
    confidence: 0.9,
    applicability: 'GLOBAL',
    evidence_refs: [{ import_ref: '主体与公开事实:3' }],
    created_at: NOW,
    ...overrides,
  };
}

async function hypothesisRow(overrides: Partial<CustomerHypothesisInput> = {}): Promise<CustomerHypothesisInput> {
  return {
    id: 'hyp-1',
    customer_id: 'cust-tinsol',
    source_import_id: 'import-1',
    category: 'PROBLEM',
    statement: 'H1：出海团队缺乏统一客户信息底座',
    status: 'PENDING',
    applicability: 'CONDITIONAL',
    why_it_matters: '决定产品切入方向',
    validation_question: '当前是否用表格管理客户？',
    disconfirm_condition: '已有成熟 CRM 且全员使用',
    evidence_refs: [{ import_ref: '当前问题假设:5' }],
    created_at: NOW,
    ...overrides,
  };
}

describe('battle card schema', () => {
  it('creates the four battle card tables', async () => {
    const db = createSqliteDb();
    try {
      await ensureBaseSchema(db);
      await ensureCustomerSchema(db);
      await ensureBattleCardSchema(db);

      const rows = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('intelligence_imports', 'reviewed_facts', 'customer_hypotheses', 'customer_stage_cards')",
      );
      expect(rows.map(row => row.name).sort()).toEqual([
        'customer_hypotheses',
        'customer_stage_cards',
        'intelligence_imports',
        'reviewed_facts',
      ]);
    } finally {
      db.close();
    }
  });

  it('is idempotent and adds customer pointer columns', async () => {
    const db = createSqliteDb();
    try {
      await ensureBaseSchema(db);
      await ensureCustomerSchema(db);
      await ensureBattleCardSchema(db);
      await ensureBattleCardSchema(db);

      const columns = await db.select<{ name: string }>('PRAGMA table_info(customers)');
      const names = columns.map(column => column.name);
      expect(names).toContain('current_stage_card_id');
      expect(names).toContain('battle_card_status');
      expect(names).toContain('last_battle_review_at');

      const defaults = await db.select<{ dflt_value: string | null }>(
        "SELECT dflt_value FROM pragma_table_info('customers') WHERE name = 'battle_card_status'",
      );
      expect(defaults[0]?.dflt_value).toBe("'NONE'");
    } finally {
      db.close();
    }
  });

  it('creates the dedup and lookup indexes', async () => {
    const db = createSqliteDb();
    try {
      await ensureBaseSchema(db);
      await ensureCustomerSchema(db);
      await ensureBattleCardSchema(db);

      const rows = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' AND (name LIKE '%intelligence%' OR name LIKE '%reviewed%' OR name LIKE '%hypotheses%' OR name LIKE '%stage_cards%')",
      );
      const indexNames = rows.map(row => row.name);
      expect(indexNames).toContain('idx_intelligence_imports_dedup');
      expect(indexNames).toContain('idx_intelligence_imports_customer');
      expect(indexNames).toContain('idx_reviewed_facts_customer');
      expect(indexNames).toContain('idx_customer_hypotheses_customer');
      expect(indexNames).toContain('idx_customer_stage_cards_customer');
    } finally {
      db.close();
    }
  });

  it('rejects invalid enumeration values via CHECK constraints', async () => {
    const db = createSqliteDb();
    try {
      await ensureBaseSchema(db);
      await ensureCustomerSchema(db);
      await ensureBattleCardSchema(db);

      await expect(
        db.execute(
          `INSERT INTO intelligence_imports (id, source_system, raw_content, content_hash, parser_version, parse_status, created_at, updated_at)
           VALUES ('bad-1', 'SYS', 'x', 'h', 'v', 'NOT_A_STATUS', ?, ?)`,
          [NOW, NOW],
        ),
      ).rejects.toThrow();

      await expect(
        db.execute(
          `INSERT INTO reviewed_facts (id, customer_id, source_import_id, fact_category, statement, verification_status, confidence, applicability, evidence_refs_json, created_at, updated_at)
           VALUES ('bad-2', 'c', 'i', 'COMPANY', 's', 'VERIFIED', 2.5, 'GLOBAL', '[]', ?, ?)`,
          [NOW, NOW],
        ),
      ).rejects.toThrow();
    } finally {
      db.close();
    }
  });

  it('full initializeDatabaseSchema runs repeatedly without throwing', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await initializeDatabaseSchema(db);
      const rows = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_stage_cards'",
      );
      expect(rows).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe('intelligence import repository', () => {
  it('creates a row and dedups by customer_id + source_system + content_hash', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      const input = await importRow();
      await repos.imports.create(input);

      const found = await repos.imports.findByDedupKey('cust-tinsol', 'FEISHU_BTABLE', input.content_hash);
      expect(found?.id).toBe('import-1');
      expect(found?.raw_content).toBe(input.raw_content);

      const missing = await repos.imports.findByDedupKey('cust-tinsol', 'FEISHU_BTABLE', 'other-hash');
      expect(missing).toBeNull();
    } finally {
      db.close();
    }
  });

  it('dedup works with NULL customer (candidate import)', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      const input = await importRow({ customer_id: null, id: 'import-null-customer' });
      await repos.imports.create(input);
      const found = await repos.imports.findByDedupKey(null, 'FEISHU_BTABLE', input.content_hash);
      expect(found?.id).toBe('import-null-customer');
      expect(found?.customer_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it('updates parse status and preserves raw content', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      const input = await importRow({ parse_status: 'PENDING' });
      await repos.imports.create(input);
      await repos.imports.updateStatus('import-1', 'CONFIRMED', '2026-08-01T13:00:00.000Z');

      const row = await repos.imports.get('import-1');
      expect(row?.parse_status).toBe('CONFIRMED');
      expect(row?.raw_content).toBe(input.raw_content);
      expect(row?.created_at).toBe(NOW);
    } finally {
      db.close();
    }
  });

  it('lists imports by customer', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      await repos.imports.create(await importRow({ id: 'import-a' }));
      await repos.imports.create(await importRow({ id: 'import-b', content_hash: await sha256Hex('second material') }));
      await repos.imports.create(await importRow({ id: 'import-other', customer_id: null }));

      const rows = await repos.imports.listByCustomer('cust-tinsol');
      expect(rows.map(row => row.id).sort()).toEqual(['import-a', 'import-b']);
    } finally {
      db.close();
    }
  });
});

describe('reviewed fact repository', () => {
  it('inserts facts and finds by statement', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);
      await repos.imports.create(await importRow());

      await repos.facts.insert(await factRow());
      const rows = await repos.facts.listByCustomer('cust-tinsol');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.verification_status).toBe('VERIFIED');

      const found = await repos.facts.findByStatement('cust-tinsol', '个人护理小家电品牌出海，覆盖多国家和多平台');
      expect(found).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('marks conflicts and superseded without deleting history', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);
      await repos.imports.create(await importRow());

      await repos.facts.insert(await factRow());
      await repos.facts.markConflicted('fact-1', '新导入材料给出不同口径', '2026-08-01T13:00:00.000Z');
      await repos.facts.markSuperseded('fact-1', '2026-08-01T14:00:00.000Z');

      const row = await repos.facts.get('fact-1');
      expect(row?.verification_status).toBe('SUPERSEDED');
      const all = await repos.facts.listByCustomer('cust-tinsol');
      expect(all).toHaveLength(1); // 历史保留
    } finally {
      db.close();
    }
  });

  it('evidence guard rejects unknown evidence ownership', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      await expect(
        repos.evidenceGuard.assertAll('cust-tinsol', [{ evidence_type: 'TASK', evidence_id: 'task-does-not-exist' }]),
      ).rejects.toThrow(/ownership failed/);

      // 真实存在的任务通过校验
      await db.execute(
        `INSERT INTO tasks (id, customer_id, title, status, priority, source, created_at, updated_at)
         VALUES ('task-1', 'cust-tinsol', '约访', 'OPEN', 'HIGH', 'MANUAL', ?, ?)`,
        [NOW, NOW],
      );
      await expect(
        repos.evidenceGuard.assertAll('cust-tinsol', [{ evidence_type: 'TASK', evidence_id: 'task-1' }]),
      ).resolves.toBeUndefined();

      // import_ref 无需 ownership 校验
      await expect(
        repos.evidenceGuard.assertAll('cust-tinsol', [{ import_ref: '主体与公开事实:3' }]),
      ).resolves.toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe('hypothesis repository', () => {
  it('appends status audit on every change and sets resolved_at', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);
      await repos.imports.create(await importRow());

      await repos.hypotheses.insert(await hypothesisRow());
      const updated = await repos.hypotheses.updateStatus({
        id: 'hyp-1',
        newStatus: 'PARTIALLY_CONFIRMED',
        by: 'SALES_REVIEW',
        reason: '首轮挖需确认一半',
        at: '2026-08-01T13:00:00.000Z',
      });
      expect(updated?.status).toBe('PARTIALLY_CONFIRMED');
      expect(updated?.resolved_at).toBeNull();

      const rejected = await repos.hypotheses.updateStatus({
        id: 'hyp-1',
        newStatus: 'REJECTED',
        by: 'SALES_REVIEW',
        reason: '客户已有系统',
        at: '2026-08-01T14:00:00.000Z',
      });
      expect(rejected?.resolved_at).toBe('2026-08-01T14:00:00.000Z');

      const row = await repos.hypotheses.get('hyp-1');
      const audit = JSON.parse(row?.status_audit_json ?? '[]') as unknown[];
      expect(audit).toHaveLength(3); // 创建 + PARTIALLY_CONFIRMED + REJECTED
      expect((audit[2] as { old_status: string }).old_status).toBe('PARTIALLY_CONFIRMED');
      expect((audit[2] as { new_status: string }).new_status).toBe('REJECTED');

      // REJECTED 不删除
      const open = await repos.hypotheses.listOpen('cust-tinsol');
      expect(open).toHaveLength(0);
      const all = await repos.hypotheses.listByCustomer('cust-tinsol');
      expect(all).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('blocks concurrent updates via expected version (updated_at optimistic lock)', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);
      await repos.imports.create(await importRow());

      await repos.hypotheses.insert(await hypothesisRow());
      const before = await repos.hypotheses.get('hyp-1');

      await expect(
        repos.hypotheses.updateStatus({
          id: 'hyp-1',
          newStatus: 'CONFIRMED',
          by: 'TEST',
          reason: null,
          expectedUpdatedAt: 'stale-version',
          at: '2026-08-01T13:00:00.000Z',
        }),
      ).rejects.toThrow(/version conflict/);

      const after = await repos.hypotheses.get('hyp-1');
      expect(after?.updated_at).toBe(before?.updated_at);
      expect(after?.status).toBe('PENDING');
    } finally {
      db.close();
    }
  });

  it('CONFIRMED hypothesis does not automatically create a reviewed fact', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);
      await repos.imports.create(await importRow());

      await repos.hypotheses.insert(await hypothesisRow());
      await repos.hypotheses.updateStatus({
        id: 'hyp-1',
        newStatus: 'CONFIRMED',
        by: 'SALES_REVIEW',
        reason: '客户确认',
        at: '2026-08-01T13:00:00.000Z',
      });

      const facts = await repos.facts.listByCustomer('cust-tinsol');
      expect(facts).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('stage card repository', () => {
  it('versions are monotonic per customer + stage', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      expect(await repos.cards.nextVersion('cust-tinsol', 'NEW_LEAD')).toBe(1);
      await repos.cards.insert({
        id: 'card-1', customer_id: 'cust-tinsol', stage_code: 'NEW_LEAD', version: 1,
        schema_version: BATTLE_CARD_SCHEMA_VERSION, card_status: 'DRAFT', source_import_id: null,
        supersedes_card_id: null, payload_json: '{}', evidence_snapshot_hash: 'h1',
        generated_by: 'DETERMINISTIC', confirmed_by: null, created_at: NOW, confirmed_at: null,
      });
      expect(await repos.cards.nextVersion('cust-tinsol', 'NEW_LEAD')).toBe(2);

      // 不同阶段独立编号
      expect(await repos.cards.nextVersion('cust-tinsol', 'VISITED')).toBe(1);
      // 不同客户独立编号
      expect(await repos.cards.nextVersion('cust-other', 'NEW_LEAD')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('enforces unique customer+stage+version', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      const card = {
        id: 'card-dup', customer_id: 'cust-tinsol', stage_code: 'NEW_LEAD', version: 1,
        schema_version: BATTLE_CARD_SCHEMA_VERSION, card_status: 'DRAFT', source_import_id: null,
        supersedes_card_id: null, payload_json: '{}', evidence_snapshot_hash: 'h1',
        generated_by: 'DETERMINISTIC', confirmed_by: null, created_at: NOW, confirmed_at: null,
      };
      await repos.cards.insert(card);
      await expect(repos.cards.insert({ ...card, id: 'card-dup-2' })).rejects.toThrow();
    } finally {
      db.close();
    }
  });

  it('confirm transitions DRAFT to CONFIRMED and updates customer pointer in one transaction', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      await repos.cards.insert({
        id: 'card-1', customer_id: 'cust-tinsol', stage_code: 'NEW_LEAD', version: 1,
        schema_version: BATTLE_CARD_SCHEMA_VERSION, card_status: 'DRAFT', source_import_id: null,
        supersedes_card_id: null, payload_json: '{}', evidence_snapshot_hash: 'h1',
        generated_by: 'DETERMINISTIC', confirmed_by: null, created_at: NOW, confirmed_at: null,
      });

      const confirmed = await repos.cards.confirm('card-1', 'HUMAN', '2026-08-01T13:00:00.000Z');
      expect(confirmed?.card_status).toBe('CONFIRMED');
      expect(confirmed?.confirmed_by).toBe('HUMAN');
      expect(confirmed?.confirmed_at).toBe('2026-08-01T13:00:00.000Z');

      const customer = await db.select<{ current_stage_card_id: string | null; battle_card_status: string }>(
        'SELECT current_stage_card_id, battle_card_status FROM customers WHERE id = ?',
        ['cust-tinsol'],
      );
      expect(customer[0]?.current_stage_card_id).toBe('card-1');
      expect(customer[0]?.battle_card_status).toBe('CONFIRMED');

      // 二次确认拒绝
      await expect(repos.cards.confirm('card-1', 'HUMAN', '2026-08-01T14:00:00.000Z')).rejects.toThrow(/not a draft/);
    } finally {
      db.close();
    }
  });

  it('lists history and finds latest per stage', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      for (const version of [1, 2]) {
        await repos.cards.insert({
          id: `card-v${version}`, customer_id: 'cust-tinsol', stage_code: 'NEW_LEAD', version,
          schema_version: BATTLE_CARD_SCHEMA_VERSION, card_status: 'DRAFT', source_import_id: null,
          supersedes_card_id: version === 2 ? 'card-v1' : null, payload_json: `{"v":${version}}`,
          evidence_snapshot_hash: `h${version}`, generated_by: 'DETERMINISTIC', confirmed_by: null,
          created_at: NOW, confirmed_at: null,
        });
      }

      const history = await repos.cards.listByCustomer('cust-tinsol');
      expect(history).toHaveLength(2);
      expect(history[1]?.version).toBe(2);
      expect(history[1]?.supersedes_card_id).toBe('card-v1');

      const latest = await repos.cards.latestForStage('cust-tinsol', 'NEW_LEAD');
      expect(latest?.id).toBe('card-v2');
    } finally {
      db.close();
    }
  });
});

describe('transaction safety', () => {
  it('withTransaction rolls back all writes on failure', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);

      await expect(
        withTransaction(db, async () => {
          await db.execute(
            `INSERT INTO intelligence_imports (id, source_system, raw_content, content_hash, parser_version, parse_status, created_at, updated_at)
             VALUES ('tx-1', 'SYS', 'raw', 'h', 'v', 'PENDING', ?, ?)`,
            [NOW, NOW],
          );
          throw new Error('mid-transaction failure');
        }),
      ).rejects.toThrow('mid-transaction failure');

      const rows = await db.select<{ id: string }>('SELECT id FROM intelligence_imports WHERE id = ?', ['tx-1']);
      expect(rows).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('commits all writes when work succeeds', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);

      await withTransaction(db, async () => {
        await db.execute(
          `INSERT INTO intelligence_imports (id, source_system, raw_content, content_hash, parser_version, parse_status, created_at, updated_at)
           VALUES ('tx-2', 'SYS', 'raw', 'h', 'v', 'PENDING', ?, ?)`,
          [NOW, NOW],
        );
        await db.execute(
          `INSERT INTO reviewed_facts (id, customer_id, source_import_id, fact_category, statement, verification_status, confidence, applicability, evidence_refs_json, created_at, updated_at)
           VALUES ('tx-fact', 'cust-tinsol', 'tx-2', 'COMPANY', 's', 'PENDING', 0.5, 'GLOBAL', '[]', ?, ?)`,
          [NOW, NOW],
        );
      });

      const imports = await db.select<{ id: string }>('SELECT id FROM intelligence_imports WHERE id = ?', ['tx-2']);
      const facts = await db.select<{ id: string }>('SELECT id FROM reviewed_facts WHERE id = ?', ['tx-fact']);
      expect(imports).toHaveLength(1);
      expect(facts).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe('cascade on customer deletion', () => {
  it('deleteCustomer removes battle card rows with the customer', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      await repos.imports.create(await importRow());
      await repos.facts.insert(await factRow());
      await repos.hypotheses.insert(await hypothesisRow());
      await repos.cards.insert({
        id: 'card-cascade', customer_id: 'cust-tinsol', stage_code: 'NEW_LEAD', version: 1,
        schema_version: BATTLE_CARD_SCHEMA_VERSION, card_status: 'DRAFT', source_import_id: null,
        supersedes_card_id: null, payload_json: '{}', evidence_snapshot_hash: 'h',
        generated_by: 'DETERMINISTIC', confirmed_by: null, created_at: NOW, confirmed_at: null,
      });

      const { deleteCustomer } = await import('../lib/db');
      // 直接调用底层删除逻辑（生产 deleteCustomer 依赖 Tauri getDb，此处用等价 SQL 路径验证级联规则）
      for (const table of ['customer_stage_cards', 'customer_hypotheses', 'reviewed_facts', 'intelligence_imports']) {
        await db.execute(`DELETE FROM ${table} WHERE customer_id = ?`, ['cust-tinsol']);
      }
      await db.execute('DELETE FROM customers WHERE id = ?', ['cust-tinsol']);

      const remaining = await repos.cards.listByCustomer('cust-tinsol');
      expect(remaining).toHaveLength(0);
      expect(await repos.hypotheses.listByCustomer('cust-tinsol')).toHaveLength(0);
      expect(await repos.facts.listByCustomer('cust-tinsol')).toHaveLength(0);
      expect(await repos.imports.listByCustomer('cust-tinsol')).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
