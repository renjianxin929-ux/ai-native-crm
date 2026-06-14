import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  listLeadImportBatches,
  listLeadImportRowsByBatchId,
} from '../lib/leadWorkbench/db';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import type { LeadImportBatch, LeadImportRow } from '../lib/leadWorkbench/types';
import {
  buildLeadImportBatchStats,
  buildLeadImportExecutionConfirmation,
  buildLeadImportExecutionSummary,
  buildLeadImportPreview,
  executeLeadImportBatchFromCenter,
  getLeadImportBatchExecutionState,
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
    const rows = [
      createLeadRow({ decision: 'DIRECT_TO_CRM', decision_status: 'PENDING' }),
      createLeadRow({ decision: 'CRM_WITH_LOOKUP', decision_status: 'EXECUTING' }),
      createLeadRow({ decision: 'LOOKUP_FIRST', decision_status: 'DONE', created_customer_id: 'customer-1' }),
      createLeadRow({ decision: 'RESERVE', decision_status: 'FAILED', created_work_item_id: 'work-item-1' }),
      createLeadRow({ decision: 'IGNORE', decision_status: 'PENDING' }),
    ];

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

  it('exposes only the allowed import center action labels', () => {
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).toEqual(['解析预览', '保存为导入批次', '执行分流']);
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).not.toContain('导入 CRM');
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).not.toContain('创建作业任务');
  });

  it('shows execution as available when a saved batch has pending or failed rows', () => {
    const rows = [
      createLeadRow({ decision: 'DIRECT_TO_CRM', decision_status: 'PENDING' }),
      createLeadRow({ decision: 'LOOKUP_FIRST', decision_status: 'FAILED' }),
    ];

    expect(getLeadImportBatchExecutionState(rows)).toEqual({
      canExecute: true,
      label: '执行分流',
      executableRows: 2,
    });
  });

  it('disables execution when every row is already done', () => {
    const rows = [
      createLeadRow({ decision_status: 'DONE' }),
      createLeadRow({ decision: 'CRM_WITH_LOOKUP', decision_status: 'DONE' }),
    ];

    expect(getLeadImportBatchExecutionState(rows)).toEqual({
      canExecute: false,
      label: '已完成/不可重复执行',
      executableRows: 0,
    });
  });

  it('builds a confirmation message with batch and decision counts', () => {
    const batch = createBatch({ batch_name: 'Confirm batch', total_rows: 5 });
    const rows = [
      createLeadRow({ decision: 'DIRECT_TO_CRM' }),
      createLeadRow({ decision: 'CRM_WITH_LOOKUP' }),
      createLeadRow({ decision: 'LOOKUP_FIRST' }),
      createLeadRow({ decision: 'RESERVE' }),
      createLeadRow({ decision: 'IGNORE' }),
    ];

    const confirmation = buildLeadImportExecutionConfirmation(batch, rows);

    expect(confirmation.message).toContain('Confirm batch');
    expect(confirmation.message).toContain('total_rows: 5');
    expect(confirmation.message).toContain('DIRECT_TO_CRM: 1');
    expect(confirmation.message).toContain('CRM_WITH_LOOKUP: 1');
    expect(confirmation.message).toContain('LOOKUP_FIRST: 1');
    expect(confirmation.message).toContain('RESERVE: 1');
    expect(confirmation.message).toContain('IGNORE: 1');
    expect(confirmation.message).toContain('执行后可能创建 CRM 客户和获客任务');
  });

  it('does not call executeLeadImportBatchDecisions when confirmation is cancelled', async () => {
    const db = await createReadyDb();
    let executeCalls = 0;
    try {
      const batch = createBatch();
      const rows = [createLeadRow()];

      const result = await executeLeadImportBatchFromCenter({
        db,
        batch,
        rows,
        confirm: () => false,
        execute: async () => {
          executeCalls += 1;
          return [];
        },
        loadRows: async () => rows,
      });

      expect(result.status).toBe('CANCELLED');
      expect(executeCalls).toBe(0);
    } finally {
      db.close();
    }
  });

  it('calls executeLeadImportBatchDecisions after confirmation and returns refreshed summary', async () => {
    const db = await createReadyDb();
    let executeCalls = 0;
    let loadRowsCalls = 0;
    try {
      const batch = createBatch();
      const beforeRows = [
        createLeadRow({ id: 'row-1', decision: 'DIRECT_TO_CRM', decision_status: 'PENDING' }),
        createLeadRow({ id: 'row-2', decision: 'LOOKUP_FIRST', decision_status: 'PENDING' }),
      ];
      const afterRows = [
        createLeadRow({
          id: 'row-1',
          decision: 'DIRECT_TO_CRM',
          decision_status: 'DONE',
          created_customer_id: 'customer-1',
        }),
        createLeadRow({
          id: 'row-2',
          decision: 'LOOKUP_FIRST',
          decision_status: 'DONE',
          created_work_item_id: 'work-item-1',
        }),
      ];

      const result = await executeLeadImportBatchFromCenter({
        db,
        batch,
        rows: beforeRows,
        confirm: () => true,
        execute: async (_db, batchId) => {
          executeCalls += 1;
          expect(batchId).toBe(batch.id);
          return [
            { status: 'DONE', importRowId: 'row-1' },
            { status: 'DONE', importRowId: 'row-2', workItemId: 'work-item-1' },
          ];
        },
        loadRows: async (_db, batchId) => {
          loadRowsCalls += 1;
          expect(batchId).toBe(batch.id);
          return afterRows;
        },
      });

      expect(result.status).toBe('EXECUTED');
      expect(executeCalls).toBe(1);
      expect(loadRowsCalls).toBe(1);
      expect(result.rows).toBe(afterRows);
      expect(result.summary).toEqual({
        doneCount: 2,
        failedCount: 0,
        createdCustomerCount: 1,
        createdWorkItemCount: 1,
      });
    } finally {
      db.close();
    }
  });

  it('summarizes execution DONE / FAILED and created records from refreshed rows', () => {
    const beforeRows = [
      createLeadRow({ id: 'row-1', decision_status: 'PENDING' }),
      createLeadRow({ id: 'row-2', decision_status: 'FAILED' }),
      createLeadRow({ id: 'row-3', decision_status: 'DONE', created_customer_id: 'existing-customer' }),
    ];
    const afterRows = [
      createLeadRow({ id: 'row-1', decision_status: 'DONE', created_customer_id: 'new-customer' }),
      createLeadRow({ id: 'row-2', decision_status: 'FAILED' }),
      createLeadRow({ id: 'row-3', decision_status: 'DONE', created_customer_id: 'existing-customer' }),
      createLeadRow({ id: 'row-4', decision_status: 'DONE', created_work_item_id: 'new-work-item' }),
    ];

    expect(buildLeadImportExecutionSummary(beforeRows, afterRows)).toEqual({
      doneCount: 3,
      failedCount: 1,
      createdCustomerCount: 1,
      createdWorkItemCount: 1,
    });
  });
});

function createBatch(overrides: Partial<LeadImportBatch> = {}): LeadImportBatch {
  return {
    id: 'batch-1',
    batch_name: 'Batch One',
    batch_type: 'AI_DAILY',
    source_label: null,
    total_rows: 1,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function createLeadRow(overrides: Partial<LeadImportRow> = {}): LeadImportRow {
  return {
    id: 'row-1',
    batch_id: 'batch-1',
    row_index: 0,
    raw_data_json: '{}',
    company_name: 'Lead Co',
    city: null,
    industry: null,
    website: null,
    contact_name: null,
    mobile: null,
    tel: null,
    email: null,
    score: null,
    grade: null,
    tanji_search_keyword: null,
    matching_reason: null,
    priority_contact_role: null,
    source_evidence: null,
    decision: 'DIRECT_TO_CRM',
    decision_status: 'PENDING',
    created_customer_id: null,
    created_work_item_id: null,
    error_message: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}
