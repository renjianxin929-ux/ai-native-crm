/**
 * Agent C — 数据隔离 focused tests（测试矩阵 G）。
 * 生产 DB 文件级指纹前后不变 / E2E DB 可写 / Migration 幂等可重建 / quick_check=ok。
 * 所有数据库测试只使用隔离 identifier 或临时数据库，禁止打开正常生产 personal-crm.db。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { previewIntelligenceImport, confirmIntelligenceImport } from '../lib/battleCard/importService';
import { CLOCK, createSchema, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function openFileDb(path: string): DatabaseLike & { close(): void } {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  return {
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

const PRODUCTION_DB_CANDIDATES = [
  process.env.APPDATA ? join(process.env.APPDATA, 'com.localcrm.desktop', 'personal-crm.db') : null,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'com.localcrm.desktop', 'personal-crm.db') : null,
].filter((path): path is string => Boolean(path));

describe('production DB isolation', () => {
  it('battle card code never touches the production database file (file-level fingerprint)', async () => {
    const productionDb = PRODUCTION_DB_CANDIDATES.find(existsSync);
    if (!productionDb) {
      // 测试机无生产 DB 时，验证模块不硬编码任何生产路径
      const source = readFileSync(new URL('../lib/battleCard/repository.ts', import.meta.url), 'utf8')
        + readFileSync(new URL('../lib/battleCard/importService.ts', import.meta.url), 'utf8');
      expect(source).not.toContain('personal-crm.db');
      return;
    }

    const before = {
      hash: sha256File(productionDb),
      size: statSync(productionDb).size,
      mtime: statSync(productionDb).mtimeMs,
    };

    // 跑一轮完整 battle card 流程（全内存，与生产文件无关）
    const memDb = new Database(':memory:');
    try {
      const dbLike: DatabaseLike = {
        async execute(sql, bindings = []) { const r = memDb.prepare(sql).run(bindings as never[]); return { rowsAffected: r.changes }; },
        async select<T>(sql, bindings = []) { return memDb.prepare(sql).all(bindings as never[]) as T[]; },
      };
      await initializeDatabaseSchema(dbLike);
      await seedCustomer(dbLike);
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db: dbLike, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      await confirmIntelligenceImport(preview, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
        keep_hypothesis_ids: [],
      }, { db: dbLike, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
    } finally {
      memDb.close();
    }

    const after = {
      hash: sha256File(productionDb),
      size: statSync(productionDb).size,
      mtime: statSync(productionDb).mtimeMs,
    };
    expect(after.hash).toBe(before.hash);
    expect(after.size).toBe(before.size);
    expect(after.mtime).toBe(before.mtime);
  });

  it('never opens the production database in any battle card module', async () => {
    for (const modulePath of [
      '../lib/battleCard/repository.ts',
      '../lib/battleCard/importService.ts',
      '../lib/battleCard/stageCardEngine.ts',
      '../lib/battleCard/dailyReview.ts',
      '../lib/battleCard/agentTools.ts',
      '../lib/battleCard/schema.ts',
    ]) {
      const source = readFileSync(new URL(modulePath, import.meta.url), 'utf8');
      expect(source).not.toContain('personal-crm.db');
      expect(source).not.toContain('appDataDir');
      expect(source).not.toContain("Database.load('sqlite:");
    }
  });
});

describe('E2E database is writable and persistent', () => {
  it('full lifecycle on a file-backed E2E database survives reopen', async () => {
    const dbPath = join(tmpdir(), `bc-v1-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
    try {
      // 写入阶段
      const db = openFileDb(dbPath);
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-e2e', grade: 'B', next_action: 'CONTACT_AGAIN' });
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      const result = await confirmIntelligenceImport(preview, {
        customer_id: 'cust-e2e',
        keep_fact_ids: preview.draft.extracted_facts.slice(0, 2).map(fact => fact.fact_id),
        keep_hypothesis_ids: preview.draft.extracted_hypotheses.slice(0, 2).map(hypothesis => hypothesis.hypothesis_id),
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      const repos = createBattleCardRepositories(db, CLOCK);
      expect((await repos.facts.listByCustomer('cust-e2e')).length).toBe(2);
      const quickCheck = await db.select<{ quick_check: string }>('PRAGMA quick_check');
      expect(quickCheck[0]?.quick_check).toBe('ok');
      db.close();

      // 重开验证持久化
      const reopened = openFileDb(dbPath);
      const reposAfter = createBattleCardRepositories(reopened, CLOCK);
      expect(await reposAfter.imports.get(result.import_id)).not.toBeNull();
      expect((await reposAfter.facts.listByCustomer('cust-e2e')).length).toBe(2);
      expect((await reposAfter.hypotheses.listByCustomer('cust-e2e')).length).toBe(2);
      const quickCheckAfter = await reopened.select<{ quick_check: string }>('PRAGMA quick_check');
      expect(quickCheckAfter[0]?.quick_check).toBe('ok');
      reopened.close();
    } finally {
      try { await import('node:fs').then(fs => fs.promises.unlink(dbPath)); } catch { /* ignore */ }
    }
  });
});

describe('migration recoverability', () => {
  it('schema can be dropped and rebuilt idempotently (recoverable migration)', async () => {
    const db = openFileDb(':memory:');
    try {
      await createSchema(db);
      await createSchema(db); // 幂等
      // 破坏性重建：模拟灾难恢复路径
      await db.execute('DROP TABLE customer_stage_cards');
      await db.execute('DROP TABLE customer_hypotheses');
      await db.execute('DROP TABLE reviewed_facts');
      await db.execute('DROP TABLE intelligence_imports');
      await createSchema(db); // 重建
      const rows = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('intelligence_imports', 'reviewed_facts', 'customer_hypotheses', 'customer_stage_cards')",
      );
      expect(rows).toHaveLength(4);
      // 重建后可继续写入
      await seedCustomer(db, { id: 'cust-rebuild', grade: 'C' });
      const repos = createBattleCardRepositories(db, CLOCK);
      const preview = await previewIntelligenceImport('# 主体与公开事实\n重建后客户（SYNTHETIC）\n\n# 来源\nSYNTHETIC', { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      await confirmIntelligenceImport(preview, {
        customer_id: 'cust-rebuild',
        keep_fact_ids: preview.draft.extracted_facts.map(fact => fact.fact_id),
        keep_hypothesis_ids: [],
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      expect((await repos.facts.listByCustomer('cust-rebuild')).length).toBe(1);
    } finally {
      db.close();
    }
  });

  it('migration never drops existing tables or columns (old customers intact)', async () => {
    const db = openFileDb(':memory:');
    try {
      await createSchema(db);
      await seedCustomer(db, { id: 'cust-legacy', grade: 'A', stage: 'VISITED', next_action: 'SEND_CONTRACT' });
      await db.execute(
        `INSERT INTO follow_up_records (id, customer_id, title, is_completed, created_at, updated_at)
         VALUES ('fu-legacy', 'cust-legacy', '老跟进', 0, ?, ?)`, [CLOCK(), CLOCK()],
      );
      const legacyColumnsBefore = (await db.select<{ name: string }>('PRAGMA table_info(customers)')).map(column => column.name);

      // 重复跑全量 schema 初始化
      await createSchema(db);
      await createSchema(db);

      const legacy = await db.select<{ id: string; stage: string; next_action: string | null }>('SELECT id, stage, next_action FROM customers WHERE id = ?', ['cust-legacy']);
      expect(legacy[0]?.stage).toBe('VISITED');
      expect(legacy[0]?.next_action).toBe('SEND_CONTRACT');
      const legacyColumnsAfter = (await db.select<{ name: string }>('PRAGMA table_info(customers)')).map(column => column.name);
      // 旧列全部保留，新列只是追加
      for (const column of legacyColumnsBefore) {
        expect(legacyColumnsAfter).toContain(column);
      }
      expect((await db.select('SELECT id FROM follow_up_records WHERE id = ?', ['fu-legacy']))).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
