import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  getLeadImportRowById,
  listLeadWorkItemsByImportRowId,
} from '../lib/leadWorkbench/db';
import { executeLeadImportBatchDecisions, executeLeadImportRowDecision } from '../lib/leadWorkbench/decision';
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

describe('lead workbench decision executor', () => {
  it('LOOKUP_FIRST creates one lead work item and marks the import row done', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Lookup batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Lookup Co', city: 'Foshan', industry: 'Manufacturing', score: 75 }],
      );

      const result = await executeLeadImportRowDecision(db, imported.rows[0].id);
      const row = await getLeadImportRowById(db, imported.rows[0].id);
      const workItems = await listLeadWorkItemsByImportRowId(db, imported.rows[0].id);

      expect(result.status).toBe('DONE');
      expect(row?.decision_status).toBe('DONE');
      expect(row?.created_work_item_id).toBeTruthy();
      expect(workItems).toHaveLength(1);
      expect(workItems[0]).toMatchObject({
        import_row_id: imported.rows[0].id,
        customer_id: null,
        work_type: 'NEW_CUSTOMER_LOOKUP',
        company_name: 'Lookup Co',
        city: 'Foshan',
        industry: 'Manufacturing',
        lookup_goal: 'FIND_PHONE',
        tanji_search_keyword: 'Lookup Co',
        status: 'TODO',
      });
    } finally {
      db.close();
    }
  });

  it('LOOKUP_FIRST repeated execution does not create a second work item', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Idempotent batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Repeat Lookup Co', score: 75 }],
      );

      await executeLeadImportRowDecision(db, imported.rows[0].id);
      const second = await executeLeadImportRowDecision(db, imported.rows[0].id);
      const workItems = await listLeadWorkItemsByImportRowId(db, imported.rows[0].id);

      expect(second.status).toBe('ALREADY_DONE');
      expect(workItems).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('RESERVE and IGNORE mark rows done without creating work items', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'No work item batch', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'Reserve Co', score: 20 },
          { company_name: 'Ignore Co', score: 20 },
        ],
      );
      await db.execute('UPDATE lead_import_rows SET decision = ? WHERE id = ?', ['IGNORE', imported.rows[1].id]);

      await executeLeadImportRowDecision(db, imported.rows[0].id);
      await executeLeadImportRowDecision(db, imported.rows[1].id);

      const reserveRow = await getLeadImportRowById(db, imported.rows[0].id);
      const ignoreRow = await getLeadImportRowById(db, imported.rows[1].id);
      expect(reserveRow?.decision_status).toBe('DONE');
      expect(ignoreRow?.decision_status).toBe('DONE');
      expect(await listLeadWorkItemsByImportRowId(db, imported.rows[0].id)).toHaveLength(0);
      expect(await listLeadWorkItemsByImportRowId(db, imported.rows[1].id)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('DIRECT_TO_CRM and CRM_WITH_LOOKUP are unsupported and do not create customers or work items', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Unsupported batch', batch_type: 'AI_DAILY', source_label: null },
        [
          { company_name: 'Direct Co', mobile: '13800138000', score: 10 },
          { company_name: 'Crm Lookup Co', score: 80 },
        ],
      );

      await expect(executeLeadImportRowDecision(db, imported.rows[0].id)).rejects.toThrow(
        'Unsupported lead import decision: DIRECT_TO_CRM',
      );
      await expect(executeLeadImportRowDecision(db, imported.rows[1].id)).rejects.toThrow(
        'Unsupported lead import decision: CRM_WITH_LOOKUP',
      );

      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rolls back LOOKUP_FIRST when work item creation succeeds but row update fails', async () => {
    const db = await createReadyDb();
    const originalExecute = db.execute.bind(db);

    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Rollback batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Rollback Lookup Co', score: 75 }],
      );

      db.execute = async (sql: string, bindings: unknown[] = []) => {
        if (sql.includes('created_work_item_id = ?')) {
          throw new Error('simulated import row update failure');
        }
        return originalExecute(sql, bindings);
      };

      await expect(executeLeadImportRowDecision(db, imported.rows[0].id)).rejects.toThrow(
        'simulated import row update failure',
      );

      const row = await getLeadImportRowById(db, imported.rows[0].id);
      expect(row?.decision_status).toBe('PENDING');
      expect(row?.created_work_item_id).toBeNull();
      expect(await listLeadWorkItemsByImportRowId(db, imported.rows[0].id)).toHaveLength(0);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('executes supported decisions for a batch without creating customers', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Batch executor', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'Batch Lookup Co', score: 75 },
          { company_name: 'Batch Reserve Co', score: 40 },
        ],
      );

      const results = await executeLeadImportBatchDecisions(db, imported.batch.id);
      expect(results.map(result => result.status)).toEqual(['DONE', 'DONE']);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
