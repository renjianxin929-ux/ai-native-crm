import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  listLeadImportBatches,
  listLeadImportRowsByBatchId,
} from '../lib/leadWorkbench/db';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import {
  buildLeadImportBatchStats,
  buildLeadImportPreview,
  LEAD_IMPORT_CENTER_ACTION_LABELS,
} from '../pages/LeadImportCenterPage';

function createSqliteDb(): DatabaseLike & { close(): void } {
  const sqlite = new Database(':memory:');

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

async function createReadyDb() {
  const db = createSqliteDb();
  await ensureBaseSchema(db);
  await ensureLeadWorkbenchSchema(db);
  return db;
}

describe('lead import center preview', () => {
  it('parses JSON array and uses lead importer defaults for decisions', () => {
    const preview = buildLeadImportPreview(JSON.stringify([
      { company_name: 'Phone Co', mobile: '13800138000', score: 10 },
      { company_name: 'High Score Co', score: 80 },
      { company_name: 'Lookup Co', score: 75 },
      { company_name: 'Reserve Co', score: 60 },
    ]));

    expect(preview.error).toBeNull();
    expect(preview.rows.map(row => row.decision)).toEqual([
      'DIRECT_TO_CRM',
      'CRM_WITH_LOOKUP',
      'LOOKUP_FIRST',
      'RESERVE',
    ]);
    expect(preview.inputRows).toHaveLength(4);
  });

  it('marks blank company names as preview row errors', () => {
    const preview = buildLeadImportPreview(JSON.stringify([
      { company_name: '', mobile: '13800138000', score: 90 },
      { company_name: 'Valid Co', score: 80 },
    ]));

    expect(preview.error).toBeNull();
    expect(preview.rows[0].error).toContain('company_name is required');
    expect(preview.rows[0].decision).toBeNull();
    expect(preview.rows[1].decision).toBe('CRM_WITH_LOOKUP');
  });

  it('returns a clear error for invalid JSON', () => {
    const preview = buildLeadImportPreview('[not-json');

    expect(preview.rows).toHaveLength(0);
    expect(preview.inputRows).toHaveLength(0);
    expect(preview.error).toContain('JSON');
  });

  it('lists saved batches and reads selected batch rows without side effects', async () => {
    const db = await createReadyDb();
    try {
      const first = await importLeadRowsToBatch(
        db,
        { batch_name: 'First saved batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'First Co', mobile: '13800138000', score: 10 }],
      );
      const second = await importLeadRowsToBatch(
        db,
        { batch_name: 'Second saved batch', batch_type: 'AI_DAILY', source_label: null },
        [
          { company_name: 'Second Lookup Co', score: 80 },
          { company_name: 'Second Reserve Co', score: 20 },
        ],
      );

      const batches = await listLeadImportBatches(db);
      const selectedRows = await listLeadImportRowsByBatchId(db, second.batch.id);

      expect(batches).toHaveLength(2);
      expect(batches[0]).toMatchObject({
        id: second.batch.id,
        batch_name: 'Second saved batch',
        batch_type: 'AI_DAILY',
        total_rows: 2,
      });
      expect(batches[1].id).toBe(first.batch.id);
      expect(selectedRows.map(row => row.company_name)).toEqual(['Second Lookup Co', 'Second Reserve Co']);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('summarizes decision and decision_status counts for batch detail rows', () => {
    const preview = buildLeadImportPreview(JSON.stringify([
      { company_name: 'Direct Co', mobile: '13800138000', score: 10 },
      { company_name: 'Crm Lookup Co', score: 80 },
      { company_name: 'Lookup First Co', score: 75 },
      { company_name: 'Reserve Co', score: 20 },
      { company_name: 'Ignore Co', score: 20 },
    ]));
    const rows = preview.rows.map((row, index) => ({
      id: `row-${index}`,
      batch_id: 'batch-1',
      row_index: index,
      raw_data_json: '{}',
      company_name: row.company_name ?? '',
      city: row.city,
      industry: row.industry,
      website: null,
      contact_name: null,
      mobile: row.mobile,
      tel: row.tel,
      email: null,
      score: row.score,
      grade: row.grade,
      tanji_search_keyword: null,
      matching_reason: null,
      priority_contact_role: null,
      source_evidence: null,
      decision: index === 4 ? 'IGNORE' : row.decision!,
      decision_status: ['PENDING', 'EXECUTING', 'DONE', 'FAILED', 'PENDING'][index],
      created_customer_id: index === 2 ? 'customer-1' : null,
      created_work_item_id: index === 3 ? 'work-item-1' : null,
      error_message: index === 3 ? 'failed once' : null,
      created_at: '2026-06-14T00:00:00.000Z',
      updated_at: '2026-06-14T00:00:00.000Z',
    }));

    const stats = buildLeadImportBatchStats(rows);

    expect(stats.decisionCounts).toEqual({
      DIRECT_TO_CRM: 1,
      CRM_WITH_LOOKUP: 1,
      LOOKUP_FIRST: 1,
      RESERVE: 1,
      IGNORE: 1,
    });
    expect(stats.statusCounts).toEqual({
      PENDING: 2,
      EXECUTING: 1,
      DONE: 1,
      FAILED: 1,
    });
  });

  it('does not expose decision execution action labels', () => {
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).toEqual(['解析预览', '保存为导入批次']);
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).not.toContain('执行分流');
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).not.toContain('导入 CRM');
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).not.toContain('创建作业任务');
  });
});
