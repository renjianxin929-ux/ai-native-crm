import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { buildCustomerInputFromImportRow, insertCustomerWithDb } from '../lib/leadWorkbench/customerAdapter';
import { executeLeadImportBatchDecisions } from '../lib/leadWorkbench/decision';
import {
  ensureLeadWorkbenchSchema,
  getLeadImportRowById,
  listLeadImportRowsByBatchId,
  listLeadWorkItemsByBatchId,
} from '../lib/leadWorkbench/db';
import { importLeadRowsToBatch, type LeadImportInputRow } from '../lib/leadWorkbench/importer';
import type { LeadImportRow, LeadWorkItem } from '../lib/leadWorkbench/types';

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

function createMixedRows(): LeadImportInputRow[] {
  return [
    ...Array.from({ length: 30 }, (_, index) => ({
      company_name: `Direct Mix ${index}`,
      mobile: `1381000${String(index).padStart(4, '0')}`,
      score: 50,
      grade: 'A',
      city: 'Foshan',
      industry: 'Manufacturing',
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      company_name: `Crm Lookup Mix ${index}`,
      score: 80 + (index % 10),
      grade: index % 2 === 0 ? 'S' : 'A',
      city: 'Guangzhou',
      industry: 'Equipment',
    })),
    ...Array.from({ length: 40 }, (_, index) => ({
      company_name: `Lookup First Mix ${index}`,
      score: 70 + (index % 10),
      grade: 'B',
      city: 'Zhongshan',
      industry: 'Lighting',
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      company_name: `Reserve Mix ${index}`,
      score: 30 + index,
      city: 'Jiangmen',
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      company_name: `Ignore Mix ${index}`,
      score: 10 + index,
      city: 'Dongguan',
    })),
  ];
}

async function markLastFiveRowsAsIgnore(db: DatabaseLike, rows: LeadImportRow[]) {
  const ignoreIds = rows.slice(95).map(row => row.id);
  for (const id of ignoreIds) {
    await db.execute('UPDATE lead_import_rows SET decision = ? WHERE id = ?', ['IGNORE', id]);
  }
}

describe('lead workbench backend integration', () => {
  it('imports and executes a 100-row mixed batch with stable counts and idempotency', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: '100 row mixed batch', batch_type: 'AI_DAILY', source_label: 'integration' },
        createMixedRows(),
      );
      await markLastFiveRowsAsIgnore(db, imported.rows);

      const firstResults = await executeLeadImportBatchDecisions(db, imported.batch.id);
      const rows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      const customers = await db.select<{ id: string; name: string }>('SELECT id, name FROM customers');
      const workItems = await listLeadWorkItemsByBatchId(db, imported.batch.id);

      expect(firstResults).toHaveLength(100);
      expect(rows).toHaveLength(100);
      expect(customers).toHaveLength(50);
      expect(workItems).toHaveLength(60);
      expect(rows.every(row => row.decision_status === 'DONE')).toBe(true);

      const directRows = rows.slice(0, 30);
      const crmLookupRows = rows.slice(30, 50);
      const lookupFirstRows = rows.slice(50, 90);
      const reserveRows = rows.slice(90, 95);
      const ignoreRows = rows.slice(95, 100);

      expect(directRows.every(row => row.decision === 'DIRECT_TO_CRM')).toBe(true);
      expect(directRows.every(row => row.created_customer_id && !row.created_work_item_id)).toBe(true);
      expect(crmLookupRows.every(row => row.decision === 'CRM_WITH_LOOKUP')).toBe(true);
      expect(crmLookupRows.every(row => row.created_customer_id && row.created_work_item_id)).toBe(true);
      expect(lookupFirstRows.every(row => row.decision === 'LOOKUP_FIRST')).toBe(true);
      expect(lookupFirstRows.every(row => !row.created_customer_id && row.created_work_item_id)).toBe(true);
      expect(reserveRows.every(row => row.decision === 'RESERVE')).toBe(true);
      expect(reserveRows.every(row => !row.created_customer_id && !row.created_work_item_id)).toBe(true);
      expect(ignoreRows.every(row => row.decision === 'IGNORE')).toBe(true);
      expect(ignoreRows.every(row => !row.created_customer_id && !row.created_work_item_id)).toBe(true);

      const workItemsByImportRowId = new Map(workItems.map(item => [item.import_row_id, item]));
      for (const row of crmLookupRows) {
        const workItem = workItemsByImportRowId.get(row.id);
        expect(workItem?.id).toBe(row.created_work_item_id);
        expect(workItem?.customer_id).toBe(row.created_customer_id);
        expect(workItem?.work_type).toBe('CRM_CUSTOMER_ENRICHMENT');
      }
      for (const row of lookupFirstRows) {
        const workItem = workItemsByImportRowId.get(row.id);
        expect(workItem?.id).toBe(row.created_work_item_id);
        expect(workItem?.customer_id).toBeNull();
        expect(workItem?.work_type).toBe('NEW_CUSTOMER_LOOKUP');
      }

      const secondResults = await executeLeadImportBatchDecisions(db, imported.batch.id);
      const customersAfterSecondRun = await db.select('SELECT id FROM customers');
      const workItemsAfterSecondRun = await listLeadWorkItemsByBatchId(db, imported.batch.id);

      expect(secondResults).toHaveLength(100);
      expect(secondResults.every(result => result.status === 'ALREADY_DONE')).toBe(true);
      expect(customersAfterSecondRun).toHaveLength(50);
      expect(workItemsAfterSecondRun).toHaveLength(60);
    } finally {
      db.close();
    }
  });

  it('fails duplicate direct and crm-with-lookup rows with explicit errors and no new records', async () => {
    const db = await createReadyDb();
    try {
      const seedRow = (await importLeadRowsToBatch(
        db,
        { batch_name: 'duplicate seed batch', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Existing Duplicate Co', mobile: '13820000000', score: 10 }],
      )).rows[0];
      await insertCustomerWithDb(db, buildCustomerInputFromImportRow(seedRow));

      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'duplicate mixed batch', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'Direct Duplicate Phone Co', mobile: '13820000000', score: 10 },
          { company_name: 'Existing Duplicate Co', mobile: '13820000001', score: 10 },
          { company_name: 'Crm Lookup Duplicate Phone Co', mobile: '13820000000', score: 80 },
          { company_name: 'Existing Duplicate Co', mobile: '13820000002', score: 80 },
        ],
      );
      await db.execute('UPDATE lead_import_rows SET decision = ? WHERE id IN (?, ?)', [
        'CRM_WITH_LOOKUP',
        imported.rows[2].id,
        imported.rows[3].id,
      ]);

      const results = await executeLeadImportBatchDecisions(db, imported.batch.id);
      const rows = await listLeadImportRowsByBatchId(db, imported.batch.id);

      expect(results.map(result => result.status)).toEqual(['FAILED', 'FAILED', 'FAILED', 'FAILED']);
      expect(rows.every(row => row.decision_status === 'FAILED')).toBe(true);
      expect(rows[0].error_message).toContain('Duplicate customer phone_number');
      expect(rows[1].error_message).toContain('Duplicate customer name');
      expect(rows[2].error_message).toContain('Duplicate customer phone_number');
      expect(rows[3].error_message).toContain('Duplicate customer name');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rolls back failing rows while preserving other batch results', async () => {
    const db = await createReadyDb();
    const originalExecute = db.execute.bind(db);
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'rollback mixed batch', batch_type: 'MANUAL', source_label: null },
        [
          { company_name: 'Direct Rollback Integration Co', mobile: '13830000000', score: 10 },
          { company_name: 'Crm Rollback Integration Co', score: 80 },
          { company_name: 'Lookup Preserved Integration Co', score: 75 },
          { company_name: 'Reserve Preserved Integration Co', score: 20 },
        ],
      );

      db.execute = async (sql: string, bindings: unknown[] = []) => {
        if (
          sql.includes('created_customer_id = ?') &&
          !sql.includes('created_work_item_id = ?') &&
          bindings[4] === imported.rows[0].id
        ) {
          throw new Error('simulated direct rollback integration failure');
        }
        if (sql.includes('INSERT INTO lead_work_items') && bindings[1] === imported.rows[1].id) {
          throw new Error('simulated crm lookup rollback integration failure');
        }
        return originalExecute(sql, bindings);
      };

      await expect(executeLeadImportBatchDecisions(db, imported.batch.id)).rejects.toThrow(
        'simulated direct rollback integration failure',
      );
      let directRow = await getLeadImportRowById(db, imported.rows[0].id);
      expect(directRow?.decision_status).toBe('PENDING');
      expect(directRow?.created_customer_id).toBeNull();
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);

      await db.execute('UPDATE lead_import_rows SET decision_status = ? WHERE id = ?', [
        'DONE',
        imported.rows[0].id,
      ]);
      await expect(executeLeadImportBatchDecisions(db, imported.batch.id)).rejects.toThrow(
        'simulated crm lookup rollback integration failure',
      );

      directRow = await getLeadImportRowById(db, imported.rows[0].id);
      const crmRow = await getLeadImportRowById(db, imported.rows[1].id);
      expect(directRow?.decision_status).toBe('DONE');
      expect(directRow?.created_customer_id).toBeNull();
      expect(crmRow?.decision_status).toBe('PENDING');
      expect(crmRow?.created_customer_id).toBeNull();
      expect(crmRow?.created_work_item_id).toBeNull();
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);

      db.execute = originalExecute;
      await executeLeadImportBatchDecisions(db, imported.batch.id);
      const finalRows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      const customers = await db.select('SELECT * FROM customers');
      const workItems = await db.select<LeadWorkItem>('SELECT * FROM lead_work_items');

      expect(finalRows.map(row => row.decision_status)).toEqual(['DONE', 'DONE', 'DONE', 'DONE']);
      expect(customers).toHaveLength(1);
      expect(workItems).toHaveLength(2);
      expect(workItems.some(item => item.work_type === 'CRM_CUSTOMER_ENRICHMENT')).toBe(true);
      expect(workItems.some(item => item.work_type === 'NEW_CUSTOMER_LOOKUP')).toBe(true);
    } finally {
      db.close();
    }
  });
});
