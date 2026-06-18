import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { ensureLeadWorkbenchSchema } from '../lib/leadWorkbench/db';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';

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

describe('lead workbench importer', () => {
  it('imports 80 sparse rows without undefined SQL bindings and preserves 59/21 decisions', async () => {
    const db = await createReadyDb();
    const originalExecute = db.execute.bind(db);
    const transactionStatements: string[] = [];

    db.execute = async (sql: string, bindings: unknown[] = []) => {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim().toUpperCase())) {
        transactionStatements.push(sql.trim().toUpperCase());
      }
      if (sql.includes('INSERT INTO lead_import_batches') || sql.includes('INSERT INTO lead_import_rows')) {
        expect(bindings).not.toContain(undefined);
      }
      return originalExecute(sql, bindings);
    };

    try {
      const inputRows = [
        ...Array.from({ length: 59 }, (_, index) => ({
          company_name: `Sparse CRM With Lookup ${index + 1}`,
          score: 85,
        })),
        ...Array.from({ length: 21 }, (_, index) => ({
          company_name: `Sparse Lookup First ${index + 1}`,
          score: 75,
        })),
      ];

      const result = await importLeadRowsToBatch(
        db,
        { batch_name: 'Sparse 80 rows', batch_type: 'AI_DAILY' },
        inputRows,
      );
      const rowCount = await db.select<{ count: number }>(
        'SELECT COUNT(*) as count FROM lead_import_rows WHERE batch_id = ?',
        [result.batch.id],
      );
      const decisionCounts = await db.select<{ decision: string; count: number }>(
        'SELECT decision, COUNT(*) as count FROM lead_import_rows WHERE batch_id = ? GROUP BY decision',
        [result.batch.id],
      );

      expect(rowCount[0].count).toBe(80);
      expect(Object.fromEntries(decisionCounts.map(row => [row.decision, row.count]))).toEqual({
        CRM_WITH_LOOKUP: 59,
        LOOKUP_FIRST: 21,
      });
      expect(transactionStatements).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('imports 100 rows into one batch and preserves row order/raw data', async () => {
    const db = await createReadyDb();
    try {
      const inputRows = Array.from({ length: 100 }, (_, index) => ({
        company_name: `Company ${index + 1}`,
        mobile: index === 0 ? '13800138000' : null,
        score: 60 + (index % 30),
        source: `row-${index + 1}`,
      }));

      const result = await importLeadRowsToBatch(
        db,
        { batch_name: 'Phase 2A batch', batch_type: 'MANUAL', source_label: 'unit-test' },
        inputRows,
      );

      const batches = await db.select<{ id: string; total_rows: number }>('SELECT id, total_rows FROM lead_import_batches');
      const rows = await db.select<{ row_index: number; raw_data_json: string; company_name: string }>(
        'SELECT row_index, raw_data_json, company_name FROM lead_import_rows WHERE batch_id = ? ORDER BY row_index ASC',
        [result.batch.id],
      );

      expect(batches).toHaveLength(1);
      expect(batches[0].total_rows).toBe(100);
      expect(rows).toHaveLength(100);
      expect(rows.map(row => row.row_index)).toEqual(Array.from({ length: 100 }, (_, index) => index));
      expect(JSON.parse(rows[0].raw_data_json)).toMatchObject({ company_name: 'Company 1', source: 'row-1' });
      expect(rows[99].company_name).toBe('Company 100');
    } finally {
      db.close();
    }
  });

  it('assigns default decisions without executing them', async () => {
    const db = await createReadyDb();
    try {
      const result = await importLeadRowsToBatch(
        db,
        { batch_name: 'Decision batch', batch_type: 'AI_DAILY', source_label: null },
        [
          { company_name: 'Phone Co', mobile: '13800138000', score: 10 },
          { company_name: 'High Score No Phone', score: 80 },
          { company_name: 'Lookup First Co', score: 75 },
          { company_name: 'Reserve Co', score: 69 },
        ],
      );

      const rows = await db.select<{ company_name: string; decision: string; decision_status: string }>(
        'SELECT company_name, decision, decision_status FROM lead_import_rows WHERE batch_id = ? ORDER BY row_index ASC',
        [result.batch.id],
      );

      expect(rows).toEqual([
        { company_name: 'Phone Co', decision: 'DIRECT_TO_CRM', decision_status: 'PENDING' },
        { company_name: 'High Score No Phone', decision: 'CRM_WITH_LOOKUP', decision_status: 'PENDING' },
        { company_name: 'Lookup First Co', decision: 'LOOKUP_FIRST', decision_status: 'PENDING' },
        { company_name: 'Reserve Co', decision: 'RESERVE', decision_status: 'PENDING' },
      ]);
    } finally {
      db.close();
    }
  });

  it('rejects blank company names instead of silently importing normal rows', async () => {
    const db = await createReadyDb();
    try {
      await expect(importLeadRowsToBatch(
        db,
        { batch_name: 'Invalid batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: '   ', mobile: '13800138000', score: 99 }],
      )).rejects.toThrow('company_name is required');

      const batches = await db.select('SELECT * FROM lead_import_batches');
      const rows = await db.select('SELECT * FROM lead_import_rows');
      expect(batches).toHaveLength(0);
      expect(rows).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('does not create customers or lead work items during import', async () => {
    const db = await createReadyDb();
    try {
      await importLeadRowsToBatch(
        db,
        { batch_name: 'No side effects', batch_type: 'EXPO', source_label: 'expo' },
        [{ company_name: 'Side Effect Check', tel: '0757-88889999', score: 90 }],
      );

      const customers = await db.select('SELECT * FROM customers');
      const workItems = await db.select('SELECT * FROM lead_work_items');
      expect(customers).toHaveLength(0);
      expect(workItems).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('preserves the original second-row insert error and cleans the failed batch even if rollback is unavailable', async () => {
    const db = await createReadyDb();
    const originalExecute = db.execute.bind(db);
    let leadRowInsertCount = 0;
    let failedBatchId: string | null = null;

    db.execute = async (sql: string, bindings: unknown[] = []) => {
      if (sql.includes('INSERT INTO lead_import_batches')) {
        failedBatchId = String(bindings[0]);
      }
      if (sql.includes('INSERT INTO lead_import_rows')) {
        leadRowInsertCount += 1;
        if (leadRowInsertCount === 2) {
          throw new Error('undefined bind param');
        }
      }
      if (sql.trim().toUpperCase() === 'ROLLBACK') {
        throw new Error('cannot rollback - no transaction is active');
      }
      return originalExecute(sql, bindings);
    };

    try {
      let errorMessage = '';
      try {
        await importLeadRowsToBatch(
          db,
          { batch_name: 'Atomic batch', batch_type: 'MANUAL', source_label: 'unit-test' },
          [
            { company_name: 'Atomic One', mobile: '13800138000', score: 90 },
            { company_name: 'Atomic Two', mobile: '13800138001', score: 90 },
            { company_name: 'Atomic Three', mobile: '13800138002', score: 90 },
          ],
        );
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toContain('undefined bind param');
      expect(errorMessage).toContain('第 2 行');
      expect(errorMessage).toContain('Atomic Two');
      expect(errorMessage).toContain('已清理本次失败残留数据');
      expect(errorMessage).not.toBe('cannot rollback - no transaction is active');
      expect(failedBatchId).not.toBeNull();

      const batches = await db.select('SELECT * FROM lead_import_batches WHERE id = ?', [failedBatchId]);
      const rows = await db.select('SELECT * FROM lead_import_rows WHERE batch_id = ?', [failedBatchId]);
      const customers = await db.select('SELECT * FROM customers');
      const workItems = await db.select('SELECT * FROM lead_work_items');

      expect(batches).toHaveLength(0);
      expect(rows).toHaveLength(0);
      expect(customers).toHaveLength(0);
      expect(workItems).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rejects an 80-to-1 database count mismatch and removes the failed batch', async () => {
    const db = await createReadyDb();
    const originalSelect = db.select.bind(db);
    let countQueryCalls = 0;
    let failedBatchId: string | null = null;
    const originalExecute = db.execute.bind(db);

    db.execute = async (sql: string, bindings: unknown[] = []) => {
      if (sql.includes('INSERT INTO lead_import_batches')) {
        failedBatchId = String(bindings[0]);
      }
      return originalExecute(sql, bindings);
    };
    db.select = async <T>(sql: string, bindings: unknown[] = []) => {
      if (sql.includes('COUNT(*)') && sql.includes('lead_import_rows')) {
        countQueryCalls += 1;
        if (countQueryCalls === 1) {
          return [{ count: 1 }] as T[];
        }
      }
      return originalSelect<T>(sql, bindings);
    };

    try {
      await expect(importLeadRowsToBatch(
        db,
        { batch_name: 'Count mismatch batch', batch_type: 'AI_DAILY' },
        Array.from({ length: 80 }, (_, index) => ({
          company_name: `Count mismatch ${index + 1}`,
          score: index < 59 ? 85 : 75,
        })),
      )).rejects.toThrow(
        '保存失败：预览 80 行，但数据库仅保存 1 行。已阻止执行，请重新导入或查看错误详情。已清理本次失败残留数据。',
      );

      expect(countQueryCalls).toBeGreaterThanOrEqual(1);
      const batches = await originalSelect('SELECT * FROM lead_import_batches WHERE id = ?', [failedBatchId]);
      const rows = await originalSelect('SELECT * FROM lead_import_rows WHERE batch_id = ?', [failedBatchId]);
      expect(batches).toHaveLength(0);
      expect(rows).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
