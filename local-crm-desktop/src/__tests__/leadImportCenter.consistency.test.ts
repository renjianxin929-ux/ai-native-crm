import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  listLeadImportRowsByBatchId,
  listLeadWorkItems,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { executeLeadImportBatchDecisions } from '../lib/leadWorkbench/decision';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import type { LeadImportDecision, LeadDecisionStatus } from '../lib/leadWorkbench/types';
import type { Customer } from '../lib/types';
import {
  buildLeadImportBatchStats,
  buildLeadImportExecutionConfirmation,
  buildLeadImportPreview,
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

function createWrappedRecordsPayload() {
  return {
    batch_name: 'phase-6k-80-records',
    records: [
      ...Array.from({ length: 59 }, (_, index) => ({
        company_name: `CRM With Lookup ${index + 1}`,
        city: '广州',
        industry: '测试行业',
        score: 85,
        grade: 'S',
        tanji_search_keyword: `CRM With Lookup ${index + 1}`,
        matching_reason: '高分无电话，应该先查重后入库',
      })),
      ...Array.from({ length: 21 }, (_, index) => ({
        company_name: `Lookup First ${index + 1}`,
        city: '中山',
        industry: '测试行业',
        score: 75,
        grade: 'B',
        tanji_search_keyword: `Lookup First ${index + 1}`,
        matching_reason: '70-79 分无电话，应该先查询',
      })),
    ],
  };
}

async function getDecisionCounts(db: DatabaseLike, batchId: string) {
  const rows = await db.select<{ decision: LeadImportDecision; count: number }>(
    'SELECT decision, COUNT(*) as count FROM lead_import_rows WHERE batch_id = ? GROUP BY decision',
    [batchId],
  );
  return Object.fromEntries(rows.map(row => [row.decision, Number(row.count)]));
}

async function getDecisionStatusCounts(db: DatabaseLike, batchId: string) {
  const rows = await db.select<{ decision_status: LeadDecisionStatus; count: number }>(
    'SELECT decision_status, COUNT(*) as count FROM lead_import_rows WHERE batch_id = ? GROUP BY decision_status',
    [batchId],
  );
  return Object.fromEntries(rows.map(row => [row.decision_status, Number(row.count)]));
}

describe('lead import center 80-row consistency', () => {
  it('keeps preview, saved rows, execution, and workbench tasks consistent for 80 wrapped records', async () => {
    const db = await createReadyDb();
    try {
      const preview = buildLeadImportPreview(JSON.stringify(createWrappedRecordsPayload()));
      const previewStats = preview.rows.reduce<Record<string, number>>((counts, row) => {
        if (row.decision) counts[row.decision] = (counts[row.decision] ?? 0) + 1;
        return counts;
      }, {});

      expect(preview.error).toBeNull();
      expect(preview.rows).toHaveLength(80);
      expect(previewStats.CRM_WITH_LOOKUP).toBe(59);
      expect(previewStats.LOOKUP_FIRST).toBe(21);
      expect(previewStats.DIRECT_TO_CRM ?? 0).toBe(0);

      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: preview.batchNameSuggestion!, batch_type: 'AI_DAILY', source_label: null },
        preview.inputRows,
      );
      const batchCount = await db.select<{ count: number }>('SELECT COUNT(*) as count FROM lead_import_batches');
      const savedRowCount = await db.select<{ count: number }>(
        'SELECT COUNT(*) as count FROM lead_import_rows WHERE batch_id = ?',
        [imported.batch.id],
      );
      const selectedRows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      const savedStats = buildLeadImportBatchStats(selectedRows);
      const decisionCounts = await getDecisionCounts(db, imported.batch.id);
      const statusCounts = await getDecisionStatusCounts(db, imported.batch.id);
      const confirmation = buildLeadImportExecutionConfirmation(imported.batch, selectedRows);

      expect(batchCount[0].count).toBe(1);
      expect(imported.batch.total_rows).toBe(80);
      expect(savedRowCount[0].count).toBe(80);
      expect(selectedRows).toHaveLength(80);
      expect(savedStats.decisionCounts.CRM_WITH_LOOKUP).toBe(59);
      expect(savedStats.decisionCounts.LOOKUP_FIRST).toBe(21);
      expect(decisionCounts.CRM_WITH_LOOKUP).toBe(59);
      expect(decisionCounts.LOOKUP_FIRST).toBe(21);
      expect(statusCounts.PENDING).toBe(80);
      expect(confirmation.message).toContain('80');
      expect(confirmation.message).toContain('59');
      expect(confirmation.message).toContain('21');

      const firstResults = await executeLeadImportBatchDecisions(db, imported.batch.id);
      const executedRows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      const customers = await db.select<Customer>('SELECT * FROM customers');
      const workItems = await listLeadWorkItems(db);
      const todoItems = await listLeadWorkItemsByStatus(db, 'TODO');

      expect(firstResults).toHaveLength(80);
      expect(firstResults.every(result => result.status === 'DONE')).toBe(true);
      expect(executedRows.every(row => row.decision_status === 'DONE')).toBe(true);
      expect(customers).toHaveLength(59);
      expect(workItems).toHaveLength(80);
      expect(todoItems).toHaveLength(80);

      const secondResults = await executeLeadImportBatchDecisions(db, imported.batch.id);
      expect(secondResults).toHaveLength(80);
      expect(secondResults.every(result => result.status === 'ALREADY_DONE')).toBe(true);
      expect(await db.select<Customer>('SELECT * FROM customers')).toHaveLength(59);
      expect(await listLeadWorkItems(db)).toHaveLength(80);
    } finally {
      db.close();
    }
  });
});
