import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  getLeadImportRowById,
  listLeadWorkItemsByImportRowId,
} from '../lib/leadWorkbench/db';
import { buildCustomerInputFromImportRow, insertCustomerWithDb } from '../lib/leadWorkbench/customerAdapter';
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

  it('DIRECT_TO_CRM creates one customer, marks the row done, and creates no work items', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Direct batch', batch_type: 'AI_DAILY', source_label: null },
        [{ company_name: 'Direct Co', mobile: '13800138000', score: 10, grade: 'S' }],
      );

      const result = await executeLeadImportRowDecision(db, imported.rows[0].id);
      const row = await getLeadImportRowById(db, imported.rows[0].id);
      const customers = await db.select<{ id: string; name: string; customer_grade: string }>(
        'SELECT id, name, customer_grade FROM customers',
      );

      expect(result.status).toBe('DONE');
      expect(row?.decision_status).toBe('DONE');
      expect(row?.created_customer_id).toBeTruthy();
      expect(customers).toEqual([{ id: row?.created_customer_id, name: 'Direct Co', customer_grade: 'B' }]);
      expect(customers[0].customer_grade).not.toBe('A');
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('DIRECT_TO_CRM repeated execution does not create a second customer', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Direct idempotent batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Direct Repeat Co', mobile: '13800138001', score: 10 }],
      );

      await executeLeadImportRowDecision(db, imported.rows[0].id);
      const rowAfterFirstRun = await getLeadImportRowById(db, imported.rows[0].id);
      const second = await executeLeadImportRowDecision(db, imported.rows[0].id);
      const rowAfterSecondRun = await getLeadImportRowById(db, imported.rows[0].id);
      const customers = await db.select('SELECT * FROM customers');

      expect(second.status).toBe('ALREADY_DONE');
      expect(customers).toHaveLength(1);
      expect(rowAfterFirstRun?.created_customer_id).toBeTruthy();
      expect(rowAfterSecondRun?.created_customer_id).toBe(rowAfterFirstRun?.created_customer_id);
    } finally {
      db.close();
    }
  });

  it('DIRECT_TO_CRM maps lead grades conservatively when creating customers', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Direct grade batch', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'Direct Grade S Co', mobile: '13800138011', score: 10, grade: 'S' },
          { company_name: 'Direct Grade A Co', mobile: '13800138012', score: 10, grade: 'A' },
          { company_name: 'Direct Grade B Co', mobile: '13800138013', score: 10, grade: 'B' },
          { company_name: 'Direct Empty Grade Co', mobile: '13800138014', score: 10 },
        ],
      );

      for (const row of imported.rows) {
        await executeLeadImportRowDecision(db, row.id);
      }

      const customers = await db.select<{ name: string; customer_grade: string }>(
        'SELECT name, customer_grade FROM customers ORDER BY name ASC',
      );
      expect(customers).toEqual([
        { name: 'Direct Empty Grade Co', customer_grade: 'C' },
        { name: 'Direct Grade A Co', customer_grade: 'C' },
        { name: 'Direct Grade B Co', customer_grade: 'C' },
        { name: 'Direct Grade S Co', customer_grade: 'B' },
      ]);
      expect(customers.some(customer => customer.customer_grade === 'A')).toBe(false);
    } finally {
      db.close();
    }
  });

  it('DIRECT_TO_CRM fails on duplicate phone or duplicate company name without creating a customer', async () => {
    const db = await createReadyDb();
    try {
      const existingPhoneRow = (await importLeadRowsToBatch(
        db,
        { batch_name: 'Existing phone seed', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Existing Phone Co', mobile: '13800138002', score: 10 }],
      )).rows[0];
      await insertCustomerWithDb(db, buildCustomerInputFromImportRow(existingPhoneRow));

      const duplicateRows = (await importLeadRowsToBatch(
        db,
        { batch_name: 'Duplicate direct batch', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'New Phone Duplicate Co', mobile: '13800138002', score: 10 },
          { company_name: 'Existing Phone Co', mobile: '13800138003', score: 10 },
        ],
      )).rows;

      const phoneResult = await executeLeadImportRowDecision(db, duplicateRows[0].id);
      const nameResult = await executeLeadImportRowDecision(db, duplicateRows[1].id);
      const phoneRow = await getLeadImportRowById(db, duplicateRows[0].id);
      const nameRow = await getLeadImportRowById(db, duplicateRows[1].id);

      expect(phoneResult.status).toBe('FAILED');
      expect(nameResult.status).toBe('FAILED');
      expect(phoneRow?.decision_status).toBe('FAILED');
      expect(phoneRow?.error_message).toContain('Duplicate customer phone_number');
      expect(nameRow?.decision_status).toBe('FAILED');
      expect(nameRow?.error_message).toContain('Duplicate customer name');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('DIRECT_TO_CRM rolls back when customer creation succeeds but row update fails', async () => {
    const db = await createReadyDb();
    const originalExecute = db.execute.bind(db);

    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Direct rollback batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Direct Rollback Co', mobile: '13800138004', score: 10 }],
      );

      db.execute = async (sql: string, bindings: unknown[] = []) => {
        if (sql.includes('created_customer_id = ?')) {
          throw new Error('simulated customer row update failure');
        }
        return originalExecute(sql, bindings);
      };

      await expect(executeLeadImportRowDecision(db, imported.rows[0].id)).rejects.toThrow(
        'simulated customer row update failure',
      );

      const row = await getLeadImportRowById(db, imported.rows[0].id);
      expect(row?.decision_status).toBe('PENDING');
      expect(row?.created_customer_id).toBeNull();
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('CRM_WITH_LOOKUP creates one customer and one enrichment work item', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'CRM lookup batch', batch_type: 'AI_DAILY', source_label: null },
        [{ company_name: 'Crm Lookup Co', score: 80, grade: 'S', city: 'Foshan', industry: 'Equipment' }],
      );

      const result = await executeLeadImportRowDecision(db, imported.rows[0].id);
      const row = await getLeadImportRowById(db, imported.rows[0].id);
      const customers = await db.select<{ id: string; name: string; customer_grade: string }>(
        'SELECT id, name, customer_grade FROM customers',
      );
      const workItems = await listLeadWorkItemsByImportRowId(db, imported.rows[0].id);

      expect(result.status).toBe('DONE');
      expect(row?.decision_status).toBe('DONE');
      expect(row?.created_customer_id).toBeTruthy();
      expect(row?.created_work_item_id).toBeTruthy();
      expect(customers).toEqual([{ id: row?.created_customer_id, name: 'Crm Lookup Co', customer_grade: 'B' }]);
      expect(customers[0].customer_grade).not.toBe('A');
      expect(workItems).toHaveLength(1);
      expect(workItems[0]).toMatchObject({
        id: row?.created_work_item_id,
        import_row_id: imported.rows[0].id,
        customer_id: row?.created_customer_id,
        work_type: 'CRM_CUSTOMER_ENRICHMENT',
        company_name: 'Crm Lookup Co',
        city: 'Foshan',
        industry: 'Equipment',
        lookup_goal: 'FIND_PHONE',
        tanji_search_keyword: 'Crm Lookup Co',
        status: 'TODO',
        note: 'CRM_WITH_LOOKUP auto task',
      });
    } finally {
      db.close();
    }
  });

  it('CRM_WITH_LOOKUP repeated execution does not create a second customer or work item', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'CRM lookup idempotent batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Crm Lookup Repeat Co', score: 80 }],
      );

      await executeLeadImportRowDecision(db, imported.rows[0].id);
      const rowAfterFirstRun = await getLeadImportRowById(db, imported.rows[0].id);
      const second = await executeLeadImportRowDecision(db, imported.rows[0].id);
      const rowAfterSecondRun = await getLeadImportRowById(db, imported.rows[0].id);

      expect(second.status).toBe('ALREADY_DONE');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(1);
      expect(rowAfterFirstRun?.created_customer_id).toBeTruthy();
      expect(rowAfterFirstRun?.created_work_item_id).toBeTruthy();
      expect(rowAfterSecondRun?.created_customer_id).toBe(rowAfterFirstRun?.created_customer_id);
      expect(rowAfterSecondRun?.created_work_item_id).toBe(rowAfterFirstRun?.created_work_item_id);
    } finally {
      db.close();
    }
  });

  it('CRM_WITH_LOOKUP fails on duplicate phone or duplicate company name without creating records', async () => {
    const db = await createReadyDb();
    try {
      const existingPhoneRow = (await importLeadRowsToBatch(
        db,
        { batch_name: 'CRM lookup duplicate seed', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Existing Crm Lookup Co', mobile: '13800138102', score: 80 }],
      )).rows[0];
      await insertCustomerWithDb(db, buildCustomerInputFromImportRow(existingPhoneRow));

      const duplicateRows = (await importLeadRowsToBatch(
        db,
        { batch_name: 'CRM lookup duplicate batch', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'New Crm Phone Duplicate Co', mobile: '13800138102', score: 80 },
          { company_name: 'Existing Crm Lookup Co', mobile: '13800138103', score: 80 },
        ],
      )).rows;
      await db.execute('UPDATE lead_import_rows SET decision = ? WHERE id IN (?, ?)', [
        'CRM_WITH_LOOKUP',
        duplicateRows[0].id,
        duplicateRows[1].id,
      ]);

      const phoneResult = await executeLeadImportRowDecision(db, duplicateRows[0].id);
      const nameResult = await executeLeadImportRowDecision(db, duplicateRows[1].id);
      const phoneRow = await getLeadImportRowById(db, duplicateRows[0].id);
      const nameRow = await getLeadImportRowById(db, duplicateRows[1].id);

      expect(phoneResult.status).toBe('FAILED');
      expect(nameResult.status).toBe('FAILED');
      expect(phoneRow?.decision_status).toBe('FAILED');
      expect(phoneRow?.error_message).toContain('Duplicate customer phone_number');
      expect(nameRow?.decision_status).toBe('FAILED');
      expect(nameRow?.error_message).toContain('Duplicate customer name');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('CRM_WITH_LOOKUP rolls back when customer creation succeeds but work item creation fails', async () => {
    const db = await createReadyDb();
    const originalExecute = db.execute.bind(db);

    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'CRM lookup customer rollback batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Crm Customer Rollback Co', score: 80 }],
      );

      db.execute = async (sql: string, bindings: unknown[] = []) => {
        if (sql.includes('INSERT INTO lead_work_items')) {
          throw new Error('simulated work item insert failure');
        }
        return originalExecute(sql, bindings);
      };

      await expect(executeLeadImportRowDecision(db, imported.rows[0].id)).rejects.toThrow(
        'simulated work item insert failure',
      );

      const row = await getLeadImportRowById(db, imported.rows[0].id);
      expect(row?.decision_status).toBe('PENDING');
      expect(row?.created_customer_id).toBeNull();
      expect(row?.created_work_item_id).toBeNull();
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('CRM_WITH_LOOKUP rolls back when work item creation succeeds but import row update fails', async () => {
    const db = await createReadyDb();
    const originalExecute = db.execute.bind(db);

    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'CRM lookup work item rollback batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Crm Work Item Rollback Co', score: 80 }],
      );

      db.execute = async (sql: string, bindings: unknown[] = []) => {
        if (sql.includes('created_customer_id = ?') && sql.includes('created_work_item_id = ?')) {
          throw new Error('simulated crm lookup row update failure');
        }
        return originalExecute(sql, bindings);
      };

      await expect(executeLeadImportRowDecision(db, imported.rows[0].id)).rejects.toThrow(
        'simulated crm lookup row update failure',
      );

      const row = await getLeadImportRowById(db, imported.rows[0].id);
      expect(row?.decision_status).toBe('PENDING');
      expect(row?.created_customer_id).toBeNull();
      expect(row?.created_work_item_id).toBeNull();
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('CRM_WITH_LOOKUP maps lead grades conservatively when creating customers', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'CRM lookup grade batch', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'Crm Grade S Co', score: 80, grade: 'S' },
          { company_name: 'Crm Grade A Co', score: 80, grade: 'A' },
          { company_name: 'Crm Grade B Co', score: 80, grade: 'B' },
          { company_name: 'Crm Empty Grade Co', score: 80 },
        ],
      );

      for (const row of imported.rows) {
        await executeLeadImportRowDecision(db, row.id);
      }

      const customers = await db.select<{ name: string; customer_grade: string }>(
        'SELECT name, customer_grade FROM customers ORDER BY name ASC',
      );
      expect(customers).toEqual([
        { name: 'Crm Empty Grade Co', customer_grade: 'C' },
        { name: 'Crm Grade A Co', customer_grade: 'C' },
        { name: 'Crm Grade B Co', customer_grade: 'C' },
        { name: 'Crm Grade S Co', customer_grade: 'B' },
      ]);
      expect(customers.some(customer => customer.customer_grade === 'A')).toBe(false);
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
