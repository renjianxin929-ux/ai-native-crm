/**
 * Agent B — Import 生命周期 focused tests（测试矩阵 B）。
 * Preview 零写入 / Confirm 精确写入 / Cancel 零写入 / 幂等 / 候选客户 / 事务回滚 / 原始材料保留。
 */
import { describe, expect, it } from 'vitest';

import {
  cancelIntelligenceImport,
  confirmIntelligenceImport,
  previewIntelligenceImport,
} from '../lib/battleCard/importService';
import { createBattleCardRepositories } from '../lib/battleCard/repository';
import { CLOCK, createSchema, createSqliteDb, GOLDEN_SAMPLE_TINSOL, seedCustomer } from './battleCard.fixtures';

describe('preview is read-only', () => {
  it('writes zero rows', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });

      expect(preview.writes).toBe(0);
      expect(preview.content_hash.length).toBe(64);
      expect(preview.draft.extracted_facts.length).toBeGreaterThan(0);

      const rows = await db.select<{ id: string }>('SELECT id FROM intelligence_imports');
      const facts = await db.select<{ id: string }>('SELECT id FROM reviewed_facts');
      const hypotheses = await db.select<{ id: string }>('SELECT id FROM customer_hypotheses');
      expect(rows).toHaveLength(0);
      expect(facts).toHaveLength(0);
      expect(hypotheses).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('confirm writes precisely', () => {
  it('writes import + selected facts + selected hypotheses in one transaction', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      const keepFactIds = preview.draft.extracted_facts.slice(0, 2).map(fact => fact.fact_id);
      const keepHypothesisIds = preview.draft.extracted_hypotheses.slice(0, 3).map(hypothesis => hypothesis.hypothesis_id);

      const result = await confirmIntelligenceImport(preview, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: keepFactIds,
        keep_hypothesis_ids: keepHypothesisIds,
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });

      expect(result.facts_written).toBe(2);
      expect(result.hypotheses_written).toBe(3);
      expect(result.deduped).toBe(false);

      const importRow = await repos.imports.get(result.import_id);
      expect(importRow?.parse_status).toBe('CONFIRMED');
      expect(importRow?.customer_id).toBe('cust-tinsol');
      expect(importRow?.raw_content).toBe(GOLDEN_SAMPLE_TINSOL); // 原始材料永久保留

      const facts = await repos.facts.listByCustomer('cust-tinsol');
      expect(facts).toHaveLength(2);
      // 新契约：keep 仅候选（PENDING），不默认 VERIFIED；显式核实才 VERIFIED
      expect(facts.every(fact => fact.verification_status === 'PENDING')).toBe(true);
      expect(facts.every(fact => fact.source_import_id === result.import_id)).toBe(true);

      const hypotheses = await repos.hypotheses.listByCustomer('cust-tinsol');
      expect(hypotheses).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it('explicit fact_verifications promote facts to VERIFIED', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);
      const repos = createBattleCardRepositories(db, CLOCK);

      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      const keepFactIds = preview.draft.extracted_facts.slice(0, 2).map(fact => fact.fact_id);
      const verified = keepFactIds[0]!;

      const result = await confirmIntelligenceImport(preview, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: keepFactIds,
        keep_hypothesis_ids: [],
        fact_verifications: [
          { fact_id: verified, decision: 'VERIFY', applicable_scope: '80+ 国家版本', evidence_refs: ['import:官方活动案例'] },
        ],
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });

      const facts = await repos.facts.listByCustomer('cust-tinsol');
      expect(facts).toHaveLength(2);
      const verifiedFact = facts.find(fact => fact.id.includes(verified.replace(/^fact-company-/, 'fact-')));
      const pendingFacts = facts.filter(fact => fact.verification_status === 'PENDING');
      expect(pendingFacts).toHaveLength(1);
      // 显式核实的为 VERIFIED，其余保持 PENDING
      const verifiedRows = facts.filter(fact => fact.verification_status === 'VERIFIED');
      expect(verifiedRows).toHaveLength(1);
      void verifiedFact;
      void result;
    } finally {
      db.close();
    }
  });

  it('same content hash is not imported twice (idempotent)', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);

      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      const first = await confirmIntelligenceImport(preview, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
        keep_hypothesis_ids: [],
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });

      const previewAgain = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      expect(previewAgain.duplicate_of).toBe(first.import_id);

      const second = await confirmIntelligenceImport(previewAgain, {
        customer_id: 'cust-tinsol',
        keep_fact_ids: previewAgain.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
        keep_hypothesis_ids: [],
      }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });

      expect(second.deduped).toBe(true);
      expect(second.import_id).toBe(first.import_id);

      const imports = await repos(db).imports.listByCustomer('cust-tinsol');
      expect(imports).toHaveLength(1);
      const facts = await repos(db).facts.listByCustomer('cust-tinsol');
      expect(facts).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('does not guess customer_id: candidate import stays unbound', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);

      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      // 人工未选定客户
      const result = await confirmIntelligenceImport(preview, {}, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });

      expect(result.customer_id).toBeNull();
      expect(result.facts_written).toBe(0);
      expect(result.hypotheses_written).toBe(0);

      const importRow = await repos(db).imports.get(result.import_id);
      expect(importRow?.customer_id).toBeNull();
      expect(importRow?.raw_content).toBe(GOLDEN_SAMPLE_TINSOL);
      expect(await repos(db).facts.listByCustomer('cust-tinsol')).toHaveLength(0);
      expect(await repos(db).hypotheses.listByCustomer('cust-tinsol')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rolls back everything when the transaction fails midway', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      await seedCustomer(db);

      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      // 保留一个不存在的 fact_id 触发内部逻辑错误（不存在于 draft → 正常跳过）……
      // 改用注入损坏的 repository：插入事实时抛错
      const repos = createBattleCardRepositories(db, CLOCK);
      const brokenFacts = {
        ...repos.facts,
        insert: async () => { throw new Error('mid-transaction failure'); },
      };
      const brokenRepos = { ...repos, facts: brokenFacts };

      await expect(
        confirmIntelligenceImport(preview, {
          customer_id: 'cust-tinsol',
          keep_fact_ids: preview.draft.extracted_facts.slice(0, 1).map(fact => fact.fact_id),
          keep_hypothesis_ids: [],
        }, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE', repos: brokenRepos }),
      ).rejects.toThrow('mid-transaction failure');

      // 回滚：导入行、事实、假设全部为零
      expect(await repos.imports.listByCustomer('cust-tinsol')).toHaveLength(0);
      expect(await repos.facts.listByCustomer('cust-tinsol')).toHaveLength(0);
      expect(await repos.hypotheses.listByCustomer('cust-tinsol')).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('cancel is zero-write', () => {
  it('produces no business data', async () => {
    const db = createSqliteDb();
    try {
      await createSchema(db);
      const preview = await previewIntelligenceImport(GOLDEN_SAMPLE_TINSOL, { db, clock: CLOCK, source_system: 'FEISHU_BTABLE' });
      const result = await cancelIntelligenceImport(preview);

      expect(result.cancelled).toBe(true);
      expect(result.writes).toBe(0);
      expect(await db.select('SELECT id FROM intelligence_imports')).toHaveLength(0);
      expect(await db.select('SELECT id FROM reviewed_facts')).toHaveLength(0);
      expect(await db.select('SELECT id FROM customer_hypotheses')).toHaveLength(0);
      expect(await db.select('SELECT id FROM customer_stage_cards')).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

function repos(db: ReturnType<typeof createSqliteDb>) {
  return createBattleCardRepositories(db, CLOCK);
}
