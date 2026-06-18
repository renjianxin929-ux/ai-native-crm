import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  listLeadImportBatches,
  listLeadImportRowsByBatchId,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { executeLeadImportBatchDecisions } from '../lib/leadWorkbench/decision';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import type { LeadImportBatch, LeadImportRow } from '../lib/leadWorkbench/types';
import type { Customer } from '../lib/types';
import {
  buildLeadImportBatchStats,
  buildLeadImportExecutionConfirmation,
  buildLeadImportExecutionSummary,
  buildLeadImportPreview,
  buildLeadImportSaveConfirmation,
  executeLeadImportBatchFromCenter,
  getLeadImportBatchExecutionState,
  refreshLeadImportBatchBrowser,
  LEAD_IMPORT_CENTER_ACTION_LABELS,
  LEAD_IMPORT_SAMPLE_JSON,
  formatLeadBatchTypeLabel,
  formatLeadDecisionLabel,
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
  it('sample JSON covers direct, crm-with-lookup, and lookup-first rows', () => {
    const preview = buildLeadImportPreview(LEAD_IMPORT_SAMPLE_JSON);

    expect(preview.error).toBeNull();
    expect(preview.rows).toHaveLength(3);
    expect(preview.rows.map(row => row.decision)).toEqual([
      'DIRECT_TO_CRM',
      'CRM_WITH_LOOKUP',
      'LOOKUP_FIRST',
    ]);
  });

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

  it('parses wrapped objects with records arrays and exposes a batch_name suggestion', () => {
    const preview = buildLeadImportPreview(JSON.stringify({
      batch_name: 'today_incremental_geo_export_leads',
      date: '2026-06-16',
      scope_note: 'real exported payload',
      review_status: 'ready',
      records: [
        { company_name: 'Wrapped Phone Co', mobile: '13800138000', score: 10 },
        { company_name: 'Wrapped Lookup Co', score: 81 },
      ],
    }));

    expect(preview.error).toBeNull();
    expect(preview.batchNameSuggestion).toBe('today_incremental_geo_export_leads');
    expect(preview.rows.map(row => row.company_name)).toEqual(['Wrapped Phone Co', 'Wrapped Lookup Co']);
    expect(preview.rows.map(row => row.decision)).toEqual(['DIRECT_TO_CRM', 'CRM_WITH_LOOKUP']);
    expect(preview.inputRows).toHaveLength(2);
  });

  it('keeps wrapped records executable from preview through saved rows and workbench tasks', async () => {
    const db = await createReadyDb();
    const preview = buildLeadImportPreview(JSON.stringify({
      batch_name: '6.16mingdan',
      records: [
        {
          company_name: '广州BEN包装机械有限公司',
          city: '广州',
          industry: '灌装/贴标/包装设备',
          mobile: '13800138001',
          score: 82,
          grade: 'A',
          tanji_search_keyword: '广州BEN包装机械有限公司',
          matching_reason: '测试：有电话，应该直接入库',
        },
        {
          company_name: '广州高分待查样例',
          city: '广州',
          industry: '照明工程',
          score: 86,
          grade: 'S',
          tanji_search_keyword: '广州高分待查样例',
          matching_reason: '测试：高分无电话，应该先查重后入库',
        },
        {
          company_name: '中山优先查询样例',
          city: '中山',
          industry: '五金',
          score: 75,
          grade: 'B',
          tanji_search_keyword: '中山优先查询样例',
          matching_reason: '测试：70-79 分无电话，应该先查询',
        },
      ],
    }));

    try {
      expect(preview.error).toBeNull();
      expect(preview.batchNameSuggestion).toBe('6.16mingdan');
      expect(preview.rows.map(row => row.decision)).toEqual([
        'DIRECT_TO_CRM',
        'CRM_WITH_LOOKUP',
        'LOOKUP_FIRST',
      ]);

      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: preview.batchNameSuggestion!, batch_type: 'AI_DAILY', source_label: null },
        preview.inputRows,
      );
      const savedRows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      const savedStats = buildLeadImportBatchStats(savedRows);

      expect(savedRows).toHaveLength(3);
      expect(savedRows.map(row => row.decision)).toEqual([
        'DIRECT_TO_CRM',
        'CRM_WITH_LOOKUP',
        'LOOKUP_FIRST',
      ]);
      expect(savedRows.every(row => row.decision_status === 'PENDING')).toBe(true);
      expect(savedStats.decisionCounts).toMatchObject({
        DIRECT_TO_CRM: 1,
        CRM_WITH_LOOKUP: 1,
        LOOKUP_FIRST: 1,
      });
      expect(savedStats.statusCounts.PENDING).toBe(3);
      expect(getLeadImportBatchExecutionState(savedRows, imported.batch.total_rows)).toMatchObject({
        canExecute: true,
        label: '执行分流，会创建 CRM 客户/获客任务',
        executableRows: 3,
      });

      const firstResults = await executeLeadImportBatchDecisions(db, imported.batch.id);
      const executedRows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      const customers = await db.select<Customer>('SELECT * FROM customers ORDER BY name ASC');
      const todoTasks = await listLeadWorkItemsByStatus(db, 'TODO');

      expect(firstResults.every(result => result.status === 'DONE')).toBe(true);
      expect(customers.map(customer => customer.name)).toEqual([
        '广州BEN包装机械有限公司',
        '广州高分待查样例',
      ]);
      expect(todoTasks.map(item => item.company_name).sort()).toEqual([
        '中山优先查询样例',
        '广州高分待查样例',
      ]);
      expect(executedRows.find(row => row.company_name === '广州BEN包装机械有限公司')).toMatchObject({
        decision: 'DIRECT_TO_CRM',
        decision_status: 'DONE',
        created_work_item_id: null,
      });
      expect(executedRows.find(row => row.company_name === '广州高分待查样例')).toMatchObject({
        decision: 'CRM_WITH_LOOKUP',
        decision_status: 'DONE',
      });
      expect(executedRows.find(row => row.company_name === '中山优先查询样例')).toMatchObject({
        decision: 'LOOKUP_FIRST',
        decision_status: 'DONE',
        created_customer_id: null,
      });

      const secondResults = await executeLeadImportBatchDecisions(db, imported.batch.id);
      expect(secondResults.every(result => result.status === 'ALREADY_DONE')).toBe(true);
      expect(await db.select<Customer>('SELECT * FROM customers')).toHaveLength(2);
      expect(await listLeadWorkItemsByStatus(db, 'TODO')).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('returns a concrete parse error for invalid JSON', () => {
    const preview = buildLeadImportPreview('[not-json');

    expect(preview.rows).toHaveLength(0);
    expect(preview.inputRows).toHaveLength(0);
    expect(preview.error).toContain('JSON 解析失败');
    expect(preview.error).toContain('具体原因');
  });

  it('returns a clear error for non-array JSON', () => {
    const preview = buildLeadImportPreview(JSON.stringify({ company_name: 'Object Co' }));

    expect(preview.rows).toHaveLength(0);
    expect(preview.error).toBe('当前支持两种格式：纯 JSON 数组，或包含 records 数组的对象格式。');
  });

  it('returns a clear error for empty arrays', () => {
    const preview = buildLeadImportPreview('[]');

    expect(preview.rows).toHaveLength(0);
    expect(preview.error).toBe('至少需要一条数据。');
  });

  it('explains the two supported import JSON shapes for unsupported objects', () => {
    const preview = buildLeadImportPreview(JSON.stringify({ batch_name: 'bad wrapped object', records: {} }));

    expect(preview.rows).toHaveLength(0);
    expect(preview.error).toBe('当前支持两种格式：纯 JSON 数组，或包含 records 数组的对象格式。');
  });

  it('marks blank company names with row numbers', () => {
    const preview = buildLeadImportPreview(JSON.stringify([
      { company_name: '', mobile: '13800138000', score: 90 },
      { company_name: 'Valid Co', score: 80 },
    ]));

    expect(preview.error).toBeNull();
    expect(preview.rows[0].error).toContain('第 1 行');
    expect(preview.rows[0].error).toContain('company_name');
    expect(preview.rows[0].decision).toBeNull();
    expect(preview.rows[1].decision).toBe('CRM_WITH_LOOKUP');
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

  it('refreshes the selected batch rows when the batch browser refreshes', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Refresh selected rows batch', batch_type: 'AI_DAILY', source_label: null },
        [
          { company_name: 'Refresh Phone Co', mobile: '13800138000', score: 10 },
          { company_name: 'Refresh Lookup Co', score: 85 },
        ],
      );

      const refreshed = await refreshLeadImportBatchBrowser({
        db,
        selectedBatchId: imported.batch.id,
      });
      const stats = buildLeadImportBatchStats(refreshed.selectedRows);

      expect(refreshed.batches[0].id).toBe(imported.batch.id);
      expect(refreshed.selectedRows).toHaveLength(2);
      expect(stats.decisionCounts.DIRECT_TO_CRM).toBe(1);
      expect(stats.decisionCounts.CRM_WITH_LOOKUP).toBe(1);
      expect(stats.statusCounts.PENDING).toBe(2);
      expect(getLeadImportBatchExecutionState(refreshed.selectedRows, imported.batch.total_rows)).toMatchObject({
        canExecute: true,
        executableRows: 2,
      });
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

  it('builds save confirmation before persisting a batch', () => {
    const preview = buildLeadImportPreview(LEAD_IMPORT_SAMPLE_JSON);
    const confirmation = buildLeadImportSaveConfirmation({
      batchName: 'Daily batch',
      batchType: 'AI_DAILY',
      rows: preview.rows,
    });

    expect(confirmation.message).toContain('Daily batch');
    expect(confirmation.message).toContain('AI每日名单');
    expect(confirmation.message).toContain('总行数：3');
    expect(confirmation.message).toContain('直接入库: 1');
    expect(confirmation.message).toContain('先查重后入库: 1');
    expect(confirmation.message).toContain('先查询: 1');
    expect(confirmation.message).toContain('保存只写入 lead_import_batches / lead_import_rows，不会创建 CRM 客户');
  });

  it('maps batch types and decision values to Chinese display labels', () => {
    expect(formatLeadBatchTypeLabel('AI_DAILY')).toBe('AI每日名单');
    expect(formatLeadBatchTypeLabel('MANUAL')).toBe('手动录入');
    expect(formatLeadBatchTypeLabel('EXPO')).toBe('展会');
    expect(formatLeadBatchTypeLabel('WECHAT')).toBe('微信');
    expect(formatLeadBatchTypeLabel('OTHER')).toBe('其他');
    expect(formatLeadDecisionLabel('DIRECT_TO_CRM')).toBe('直接入库');
    expect(formatLeadDecisionLabel('CRM_WITH_LOOKUP')).toBe('先查重后入库');
    expect(formatLeadDecisionLabel('LOOKUP_FIRST')).toBe('先查询');
    expect(formatLeadDecisionLabel('RESERVE')).toBe('保留');
    expect(formatLeadDecisionLabel('IGNORE')).toBe('忽略');
  });

  it('exposes only the allowed import center action labels', () => {
    expect(LEAD_IMPORT_CENTER_ACTION_LABELS).toEqual([
      '填入示例 JSON',
      '解析预览',
      '保存为导入批次',
      '执行分流，会创建 CRM 客户/获客任务',
    ]);
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
      label: '执行分流，会创建 CRM 客户/获客任务',
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

  it('offers detail loading only before database rows have been queried', () => {
    expect(getLeadImportBatchExecutionState([], 20, false)).toEqual({
      canExecute: false,
      label: '加载批次明细',
      executableRows: 0,
      needsLoad: true,
    });
  });

  it('marks a historical batch as incomplete when database rows load as zero', () => {
    expect(getLeadImportBatchExecutionState([], 80, true)).toEqual({
      canExecute: false,
      label: '批次数据不完整',
      executableRows: 0,
      dataError: '批次数据不完整：批次记录显示 80 行，但明细数据为 0。请重新导入原始 JSON。',
    });
  });

  it('marks a batch as inconsistent when database row count differs from total_rows', () => {
    expect(getLeadImportBatchExecutionState(
      [createLeadRow({ decision_status: 'PENDING' })],
      80,
      true,
    )).toEqual({
      canExecute: false,
      label: '批次数据不一致',
      executableRows: 0,
      dataError: '批次数据不一致：批次记录显示 80 行，实际明细 1 行。请重新导入原始 JSON。',
    });
  });

  it('keeps a fully loaded consistent batch executable', () => {
    const rows = [
      createLeadRow({ id: 'row-1', decision_status: 'PENDING' }),
      createLeadRow({ id: 'row-2', decision_status: 'PENDING' }),
    ];

    expect(getLeadImportBatchExecutionState(rows, 2, true)).toMatchObject({
      canExecute: true,
      executableRows: 2,
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
    expect(confirmation.message).toContain('总行数：5');
    expect(confirmation.message).toContain('直接入库: 1');
    expect(confirmation.message).toContain('先查重后入库: 1');
    expect(confirmation.message).toContain('先查询: 1');
    expect(confirmation.message).toContain('保留: 1');
    expect(confirmation.message).toContain('忽略: 1');
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
      const batch = createBatch({ total_rows: 2 });
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

      let hasExecuted = false;
      const result = await executeLeadImportBatchFromCenter({
        db,
        batch,
        rows: beforeRows,
        confirm: () => true,
        execute: async (_db, batchId) => {
          executeCalls += 1;
          hasExecuted = true;
          expect(batchId).toBe(batch.id);
          return [
            { status: 'DONE', importRowId: 'row-1' },
            { status: 'DONE', importRowId: 'row-2', workItemId: 'work-item-1' },
          ];
        },
        loadRows: async (_db, batchId) => {
          loadRowsCalls += 1;
          expect(batchId).toBe(batch.id);
          return hasExecuted ? afterRows : beforeRows;
        },
      });

      expect(result.status).toBe('EXECUTED');
      expect(executeCalls).toBe(1);
      expect(loadRowsCalls).toBe(2);
      expect(result.rows).toBe(afterRows);
      expect(result.summary).toEqual({
        doneCount: 2,
        failedCount: 0,
        createdCustomerCount: 1,
        createdWorkItemCount: 1,
        failures: [],
      });
    } finally {
      db.close();
    }
  });

  it('reloads database rows before execution so stale selectedRows cannot execute only one row', async () => {
    const db = await createReadyDb();
    let confirmationMessage = '';
    try {
      const batch = createBatch({ total_rows: 80 });
      const staleRows = [
        createLeadRow({ id: 'stale-row', decision: 'DIRECT_TO_CRM', decision_status: 'PENDING' }),
      ];
      const databaseRows = [
        ...Array.from({ length: 59 }, (_, index) => createLeadRow({
          id: `crm-lookup-${index}`,
          decision: 'CRM_WITH_LOOKUP',
          decision_status: 'PENDING',
        })),
        ...Array.from({ length: 21 }, (_, index) => createLeadRow({
          id: `lookup-first-${index}`,
          decision: 'LOOKUP_FIRST',
          decision_status: 'PENDING',
        })),
      ];
      const executedRows = databaseRows.map(row => ({
        ...row,
        decision_status: 'DONE' as const,
      }));
      let hasExecuted = false;
      const result = await executeLeadImportBatchFromCenter({
        db,
        batch,
        rows: staleRows,
        confirm: message => {
          confirmationMessage = message;
          return true;
        },
        execute: async () => {
          hasExecuted = true;
          return databaseRows.map(row => ({ status: 'DONE' as const, importRowId: row.id }));
        },
        loadRows: async () => (hasExecuted ? executedRows : databaseRows),
      });

      expect(result.status).toBe('EXECUTED');
      expect(confirmationMessage).toContain('80');
      expect(confirmationMessage).toContain(`${formatLeadDecisionLabel('CRM_WITH_LOOKUP')}: 59`);
      expect(confirmationMessage).toContain(`${formatLeadDecisionLabel('LOOKUP_FIRST')}: 21`);
      expect(confirmationMessage).not.toContain(`${formatLeadDecisionLabel('DIRECT_TO_CRM')}: 1`);
      if (result.status === 'EXECUTED') {
        expect(result.rows).toHaveLength(80);
        expect(result.summary.doneCount).toBe(80);
      }
    } finally {
      db.close();
    }
  });

  it('blocks execution when a non-empty batch has zero database rows', async () => {
    const db = await createReadyDb();
    let confirmCalls = 0;
    let executeCalls = 0;
    try {
      const batch = createBatch({ total_rows: 80 });

      await expect(executeLeadImportBatchFromCenter({
        db,
        batch,
        rows: [],
        confirm: () => {
          confirmCalls += 1;
          return true;
        },
        execute: async () => {
          executeCalls += 1;
          return [];
        },
        loadRows: async () => [],
      })).rejects.toThrow(
        '批次数据不完整：批次记录显示 80 行，但明细数据为 0。请重新导入原始 JSON。',
      );

      expect(confirmCalls).toBe(0);
      expect(executeCalls).toBe(0);
    } finally {
      db.close();
    }
  });

  it('blocks execution when batch total_rows and database row count are inconsistent', async () => {
    const db = await createReadyDb();
    let confirmCalls = 0;
    let executeCalls = 0;
    try {
      const batch = createBatch({ total_rows: 80 });
      const databaseRows = [createLeadRow({ id: 'only-row', decision_status: 'PENDING' })];

      await expect(executeLeadImportBatchFromCenter({
        db,
        batch,
        rows: databaseRows,
        confirm: () => {
          confirmCalls += 1;
          return true;
        },
        execute: async () => {
          executeCalls += 1;
          return [];
        },
        loadRows: async () => databaseRows,
      })).rejects.toThrow(
        '批次数据不一致：批次记录显示 80 行，实际明细 1 行。请重新导入原始 JSON。',
      );

      expect(confirmCalls).toBe(0);
      expect(executeCalls).toBe(0);
    } finally {
      db.close();
    }
  });

  it('summarizes execution failures with company_name and error_message', () => {
    const beforeRows = [
      createLeadRow({ id: 'row-1', decision_status: 'PENDING' }),
      createLeadRow({ id: 'row-2', decision_status: 'FAILED' }),
      createLeadRow({ id: 'row-3', decision_status: 'DONE', created_customer_id: 'existing-customer' }),
    ];
    const afterRows = [
      createLeadRow({ id: 'row-1', company_name: 'New Done Co', decision_status: 'DONE', created_customer_id: 'new-customer' }),
      createLeadRow({ id: 'row-2', company_name: 'Failed Co', decision_status: 'FAILED', error_message: 'Duplicate customer name' }),
      createLeadRow({ id: 'row-3', company_name: 'Existing Co', decision_status: 'DONE', created_customer_id: 'existing-customer' }),
      createLeadRow({ id: 'row-4', company_name: 'Work Item Co', decision_status: 'DONE', created_work_item_id: 'new-work-item' }),
    ];

    expect(buildLeadImportExecutionSummary(beforeRows, afterRows)).toEqual({
      doneCount: 3,
      failedCount: 1,
      createdCustomerCount: 1,
      createdWorkItemCount: 1,
      failures: [{ company_name: 'Failed Co', error_message: 'Duplicate customer name' }],
    });
  });

  it('limits failure summaries to the first 10 failed rows', () => {
    const failedRows = Array.from({ length: 12 }, (_, index) => createLeadRow({
      id: `failed-${index}`,
      company_name: `Failed ${index}`,
      decision_status: 'FAILED',
      error_message: `error-${index}`,
    }));

    const summary = buildLeadImportExecutionSummary([], failedRows);

    expect(summary.failedCount).toBe(12);
    expect(summary.failures).toHaveLength(10);
    expect(summary.failures[0]).toEqual({ company_name: 'Failed 0', error_message: 'error-0' });
    expect(summary.failures[9]).toEqual({ company_name: 'Failed 9', error_message: 'error-9' });
  });

  it('does not directly call forbidden customer, work item, or collected lead logic', () => {
    const pageSource = readFileSync(resolve(__dirname, '../pages/LeadImportCenterPage.tsx'), 'utf8');

    expect(pageSource).not.toContain('insertCustomerWithDb');
    expect(pageSource).not.toContain('insertLeadWorkItem');
    expect(pageSource).not.toContain('collected_leads');
    expect(pageSource).not.toContain('navigator.clipboard');
    expect(pageSource).not.toContain('明细未加载，请刷新批次明细');
    expect(pageSource).toContain('executionState.dataError');
    expect(pageSource).toContain('请重新导入原始 JSON');
    expect(pageSource).toContain('listLeadImportRowsByBatchId(db, imported.batch.id)');
    expect(pageSource).toContain('databaseRows.length !== preview.rows.length');
    expect(pageSource.indexOf('setSavedSummary({')).toBeGreaterThan(
      pageSource.indexOf('databaseRows.length !== preview.rows.length'),
    );
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
