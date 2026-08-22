import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  getCollectedLeadById,
  insertCollectedLeadDraft,
  type CollectedLead,
} from '../lib/leadWorkbench/collectedLeads';
import { executeLeadImportBatchDecisions } from '../lib/leadWorkbench/decision';
import {
  ensureLeadWorkbenchSchema,
  getLeadWorkItemById,
  listLeadImportRowsByBatchId,
  listLeadWorkItemsByBatchId,
} from '../lib/leadWorkbench/db';
import { importLeadRowsToBatch, type LeadImportInputRow } from '../lib/leadWorkbench/importer';
import { parseLeadContactText } from '../lib/leadWorkbench/parser';
import {
  syncCollectedLeadCreateCustomer,
  syncCollectedLeadEnrichCustomer,
} from '../lib/leadWorkbench/syncAdapter';
import type { LeadImportRow, LeadWorkItem } from '../lib/leadWorkbench/types';
import {
  saveLeadCaptureWorkflow,
  startLeadQueryWorkflow,
} from '../lib/leadWorkbench/workflow';
import type { Customer } from '../lib/types';

type SyncLogRow = {
  collected_lead_id: string;
  action: string;
  target_customer_id: string | null;
  status: string;
  message: string;
};

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

describe('lead workbench daily end-to-end flow', () => {
  it('imports an AI_DAILY list, executes decisions, creates expected customers/work items, and stays idempotent', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'daily e2e mixed list', batch_type: 'AI_DAILY', source_label: 'e2e' },
        createDailyImportRows(),
      );
      await markImportedRowsAs(db, imported.rows, {
        'Daily Reserve One': 'RESERVE',
        'Daily Ignore One': 'IGNORE',
      });

      const firstResults = await executeLeadImportBatchDecisions(db, imported.batch.id);
      const rows = await listLeadImportRowsByBatchId(db, imported.batch.id);
      const customers = await db.select<Customer>('SELECT * FROM customers ORDER BY name ASC');
      const workItems = await listLeadWorkItemsByBatchId(db, imported.batch.id);

      expect(firstResults).toHaveLength(8);
      expect(firstResults.every(result => result.status === 'DONE')).toBe(true);
      expect(rows.every(row => row.decision_status === 'DONE')).toBe(true);
      expect(customers).toHaveLength(4);
      expect(workItems).toHaveLength(4);

      const directRows = rows.filter(row => row.decision === 'DIRECT_TO_CRM');
      const crmLookupRows = rows.filter(row => row.decision === 'CRM_WITH_LOOKUP');
      const lookupFirstRows = rows.filter(row => row.decision === 'LOOKUP_FIRST');
      const reserveRows = rows.filter(row => row.decision === 'RESERVE');
      const ignoreRows = rows.filter(row => row.decision === 'IGNORE');

      expect(directRows).toHaveLength(2);
      expect(directRows.every(row => row.created_customer_id && !row.created_work_item_id)).toBe(true);
      expect(crmLookupRows).toHaveLength(2);
      expect(crmLookupRows.every(row => row.created_customer_id && row.created_work_item_id)).toBe(true);
      expect(lookupFirstRows).toHaveLength(2);
      expect(lookupFirstRows.every(row => !row.created_customer_id && row.created_work_item_id)).toBe(true);
      expect(reserveRows).toHaveLength(1);
      expect(reserveRows.every(row => !row.created_customer_id && !row.created_work_item_id)).toBe(true);
      expect(ignoreRows).toHaveLength(1);
      expect(ignoreRows.every(row => !row.created_customer_id && !row.created_work_item_id)).toBe(true);

      const workItemsByImportRowId = new Map(workItems.map(item => [item.import_row_id, item]));
      for (const row of crmLookupRows) {
        const workItem = workItemsByImportRowId.get(row.id);
        expect(workItem?.customer_id).toBe(row.created_customer_id);
        expect(workItem?.work_type).toBe('CRM_CUSTOMER_ENRICHMENT');
      }
      for (const row of lookupFirstRows) {
        const workItem = workItemsByImportRowId.get(row.id);
        expect(workItem?.customer_id).toBeNull();
        expect(workItem?.work_type).toBe('NEW_CUSTOMER_LOOKUP');
      }

      const secondResults = await executeLeadImportBatchDecisions(db, imported.batch.id);

      expect(secondResults.every(result => result.status === 'ALREADY_DONE')).toBe(true);
      expect(await db.select<Customer>('SELECT * FROM customers')).toHaveLength(4);
      expect(await listLeadWorkItemsByBatchId(db, imported.batch.id)).toHaveLength(4);
    } finally {
      db.close();
    }
  });

  it('turns a LOOKUP_FIRST work item into a new CRM customer through capture, collected lead, sync, and logs', async () => {
    const db = await createReadyDb();
    try {
      const { lookupFirstWorkItem } = await seedExecutedDailyBatch(db);
      const beforeCustomers = await db.select<Customer>('SELECT * FROM customers');
      const rawText = [
        '张经理',
        '手机 13877770001',
        '电话 0757-77770001',
        '官网 https://lookup-create.example.com',
        '邮箱 sales@lookup-create.example.com',
      ].join('\n');
      await startLeadQueryWorkflow(db, lookupFirstWorkItem.id, { writeText: async () => undefined });
      const parsed = parseLeadContactText(rawText);

      const capture = await saveLeadCaptureWorkflow(db, {
        workItemId: lookupFirstWorkItem.id,
        rawText,
      });
      const collectedLead = await insertCollectedLeadDraft(db, {
        work_item_id: lookupFirstWorkItem.id,
        capture_event_id: capture.capture_event_id,
        import_row_id: lookupFirstWorkItem.import_row_id,
        customer_id: null,
        company_name: lookupFirstWorkItem.company_name,
        contact_name: parsed.possibleContacts[0] ?? '张经理',
        position: '经理',
        mobile: parsed.mobiles[0] ?? null,
        tel: parsed.tels[0] ?? null,
        website: parsed.urls[0] ?? null,
        email: parsed.emails[0] ?? null,
        raw_text: rawText,
        note: rawText,
      });
      expect((await getLeadWorkItemById(db, lookupFirstWorkItem.id))?.status).toBe('COLLECTED');

      const result = await syncCollectedLeadCreateCustomer(db, collectedLead.id);
      const syncedLead = await getCollectedLeadById(db, collectedLead.id);
      const customersAfterSync = await db.select<Customer>('SELECT * FROM customers');
      const logs = await listSyncLogs(db);

      expect(result.status).toBe('SUCCESS');
      expect(customersAfterSync).toHaveLength(beforeCustomers.length + 1);
      expect(syncedLead?.sync_status).toBe('SYNCED');
      expect(syncedLead?.created_customer_id).toBeTruthy();
      expect(await getCustomer(db, syncedLead!.created_customer_id!)).toMatchObject({
        name: lookupFirstWorkItem.company_name,
        phone_number: '13877770001',
        website: 'https://lookup-create.example.com',
        email: 'sales@lookup-create.example.com',
      });
      expect(logFor(logs, collectedLead.id)).toMatchObject({
        action: 'CREATE_CUSTOMER',
        status: 'SUCCESS',
        target_customer_id: syncedLead?.created_customer_id,
      });
      expect((await getLeadWorkItemById(db, lookupFirstWorkItem.id))?.status).toBe('DONE');

      const repeatResult = await syncCollectedLeadCreateCustomer(db, collectedLead.id);

      expect(repeatResult.status).toBe('ALREADY_SYNCED');
      expect(await db.select<Customer>('SELECT * FROM customers')).toHaveLength(customersAfterSync.length);
      expect((await listSyncLogs(db)).filter(log => log.collected_lead_id === collectedLead.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('turns a CRM_WITH_LOOKUP work item into safe enrichment of the existing customer', async () => {
    const db = await createReadyDb();
    try {
      const { crmLookupWorkItem } = await seedExecutedDailyBatch(db);
      expect(crmLookupWorkItem.customer_id).toBeTruthy();
      const existingCustomer = await getCustomer(db, crmLookupWorkItem.customer_id!);
      expect(existingCustomer).toBeTruthy();

      await db.execute(
        `UPDATE customers
         SET phone_number = ?, contact_person = ?, website = NULL, email = NULL,
             customer_grade = ?, stage = ?, source = ?, notes = ?
         WHERE id = ?`,
        [
          '13988880001',
          'Existing Decision Maker',
          'B',
          'CONTACTED',
          'import-source',
          'existing note',
          crmLookupWorkItem.customer_id,
        ],
      );
      const rawText = [
        '李经理',
        '手机 13888880001',
        '电话 020-88880001',
        '官网 https://enrich-existing.example.com',
        '邮箱 enrich@example.com',
        'note: enrich note',
      ].join('\n');
      await startLeadQueryWorkflow(db, crmLookupWorkItem.id, { writeText: async () => undefined });
      const parsed = parseLeadContactText(rawText);

      const capture = await saveLeadCaptureWorkflow(db, {
        workItemId: crmLookupWorkItem.id,
        rawText,
      });
      const collectedLead = await insertCollectedLeadDraft(db, {
        work_item_id: crmLookupWorkItem.id,
        capture_event_id: capture.capture_event_id,
        import_row_id: crmLookupWorkItem.import_row_id,
        customer_id: crmLookupWorkItem.customer_id,
        company_name: crmLookupWorkItem.company_name,
        contact_name: parsed.possibleContacts[0] ?? '李经理',
        position: '经理',
        mobile: parsed.mobiles[0] ?? null,
        tel: parsed.tels[0] ?? null,
        website: parsed.urls[0] ?? null,
        email: parsed.emails[0] ?? null,
        raw_text: rawText,
        note: 'enrich note',
      });
      expect((await getLeadWorkItemById(db, crmLookupWorkItem.id))?.status).toBe('COLLECTED');
      const customerCountBeforeSync = (await db.select<Customer>('SELECT * FROM customers')).length;

      const result = await syncCollectedLeadEnrichCustomer(db, collectedLead.id);
      const enrichedCustomer = await getCustomer(db, crmLookupWorkItem.customer_id!);
      const syncedLead = await getCollectedLeadById(db, collectedLead.id);
      const logs = await listSyncLogs(db);

      expect(result.status).toBe('SUCCESS');
      expect(await db.select<Customer>('SELECT * FROM customers')).toHaveLength(customerCountBeforeSync);
      expect(enrichedCustomer).toMatchObject({
        phone_number: '13988880001',
        contact_person: 'Existing Decision Maker',
        website: 'https://enrich-existing.example.com',
        email: 'enrich@example.com',
        customer_grade: 'B',
        stage: 'CONTACTED',
        source: 'import-source',
      });
      expect(enrichedCustomer?.notes).toContain('existing note');
      expect(enrichedCustomer?.notes).toContain('enrich note');
      expect(syncedLead?.sync_status).toBe('SYNCED');
      expect(syncedLead?.updated_customer_id).toBe(crmLookupWorkItem.customer_id);
      expect(logFor(logs, collectedLead.id)).toMatchObject({
        action: 'ENRICH_CUSTOMER',
        status: 'SUCCESS',
        target_customer_id: crmLookupWorkItem.customer_id,
      });
      expect((await getLeadWorkItemById(db, crmLookupWorkItem.id))?.status).toBe('DONE');

      const repeatResult = await syncCollectedLeadEnrichCustomer(db, collectedLead.id);

      expect(repeatResult.status).toBe('ALREADY_SYNCED');
      expect(await getCustomer(db, crmLookupWorkItem.customer_id!)).toEqual(enrichedCustomer);
      expect((await listSyncLogs(db)).filter(log => log.collected_lead_id === collectedLead.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('handles duplicate CREATE, missing ENRICH target, and already synced boundaries without half-dirty data', async () => {
    const db = await createReadyDb();
    try {
      const { lookupFirstWorkItem, crmLookupWorkItem } = await seedExecutedDailyBatch(db);
      const existingCrmLookupCustomer = await getCustomer(db, crmLookupWorkItem.customer_id!);
      const existingPhoneCustomer = await getCustomerByPhone(db, '13871000001');
      expect(existingCrmLookupCustomer).toBeTruthy();
      expect(existingPhoneCustomer).toBeTruthy();

      const duplicatePhoneLead = await insertCollectedLeadDraft(db, {
        work_item_id: lookupFirstWorkItem.id,
        import_row_id: lookupFirstWorkItem.import_row_id,
        customer_id: null,
        company_name: 'Duplicate Phone Collected Co',
        contact_name: 'Dup Phone',
        position: null,
        mobile: existingPhoneCustomer!.phone_number,
        tel: null,
        website: null,
        email: null,
        raw_text: 'duplicate phone raw',
        note: 'duplicate phone note',
      });
      const duplicateNameLead = await insertCollectedLeadDraft(db, {
        work_item_id: lookupFirstWorkItem.id,
        import_row_id: lookupFirstWorkItem.import_row_id,
        customer_id: null,
        company_name: existingCrmLookupCustomer!.name,
        contact_name: 'Dup Name',
        position: null,
        mobile: '13866660001',
        tel: null,
        website: null,
        email: null,
        raw_text: 'duplicate name raw',
        note: 'duplicate name note',
      });
      const missingCustomerLead = await insertCollectedLeadIgnoringForeignKey(db, {
        work_item_id: crmLookupWorkItem.id,
        import_row_id: crmLookupWorkItem.import_row_id,
        customer_id: 'missing-customer-id',
        company_name: 'Missing Customer Lead',
        mobile: '13866660002',
      });
      const alreadySyncedLead = await insertCollectedLeadDraft(db, {
        work_item_id: lookupFirstWorkItem.id,
        import_row_id: lookupFirstWorkItem.import_row_id,
        customer_id: null,
        company_name: 'Already Synced Daily Co',
        contact_name: 'Already',
        position: null,
        mobile: '13866660003',
        tel: null,
        website: null,
        email: null,
        raw_text: 'already synced raw',
        note: 'already synced note',
      });
      expect((await syncCollectedLeadCreateCustomer(db, alreadySyncedLead.id)).status).toBe('SUCCESS');
      const customerCountAfterAlreadySynced = (await db.select<Customer>('SELECT * FROM customers')).length;
      const customerBeforeFailedEnrich = await getCustomer(db, crmLookupWorkItem.customer_id!);

      const duplicatePhoneResult = await syncCollectedLeadCreateCustomer(db, duplicatePhoneLead.id);
      const duplicateNameResult = await syncCollectedLeadCreateCustomer(db, duplicateNameLead.id);
      const missingCustomerResult = await syncCollectedLeadEnrichCustomer(db, missingCustomerLead.id);
      const repeatSyncedResult = await syncCollectedLeadCreateCustomer(db, alreadySyncedLead.id);
      const logs = await listSyncLogs(db);

      expect(duplicatePhoneResult.status).toBe('DUPLICATE_PHONE');
      expect(duplicatePhoneResult.message).toContain('Duplicate customer phone_number');
      expect((await getCollectedLeadById(db, duplicatePhoneLead.id))?.sync_status).toBe('FAILED');
      expect(logFor(logs, duplicatePhoneLead.id)).toMatchObject({
        action: 'SKIP_DUPLICATE',
        status: 'SKIPPED',
        target_customer_id: existingPhoneCustomer!.id,
      });

      expect(duplicateNameResult.status).toBe('DUPLICATE_NAME');
      expect(duplicateNameResult.message).toContain('Duplicate customer name');
      expect((await getCollectedLeadById(db, duplicateNameLead.id))?.sync_status).toBe('FAILED');
      expect(logFor(logs, duplicateNameLead.id)).toMatchObject({
        action: 'SKIP_DUPLICATE',
        status: 'SKIPPED',
        message: expect.stringContaining('Duplicate customer name'),
      });

      expect(missingCustomerResult.status).toBe('CUSTOMER_NOT_FOUND');
      expect(missingCustomerResult.message).toContain('Customer not found');
      expect((await getCollectedLeadById(db, missingCustomerLead.id))?.sync_status).toBe('FAILED');
      expect(logFor(logs, missingCustomerLead.id)).toMatchObject({
        action: 'ENRICH_CUSTOMER',
        status: 'FAILED',
        target_customer_id: null,
        message: expect.stringContaining('Customer not found'),
      });
      expect(await getCustomer(db, crmLookupWorkItem.customer_id!)).toEqual(customerBeforeFailedEnrich);

      expect(repeatSyncedResult.status).toBe('ALREADY_SYNCED');
      expect(await db.select<Customer>('SELECT * FROM customers')).toHaveLength(customerCountAfterAlreadySynced);
      expect((await listSyncLogs(db)).filter(log => log.collected_lead_id === alreadySyncedLead.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('keeps daily e2e boundaries away from UI files, importer changes, clipboard, and Tanji automation', () => {
    const e2eSource = readFileSync(new URL('./leadWorkbench.e2e.test.ts', import.meta.url), 'utf8');
    const workbenchSource = readFileSync(new URL('../pages/LeadWorkbenchPage.tsx', import.meta.url), 'utf8');

    expect(e2eSource).not.toContain('Data' + 'ImportPage');
    expect(e2eSource).not.toContain('src/lib/' + 'importer');
    expect(e2eSource).not.toContain('Lead' + 'ImportCenterPage');
    expect(e2eSource).not.toContain('navigator.' + 'clipboard');
    expect(e2eSource).not.toContain('read' + 'Text');
    expect(e2eSource).not.toContain('tan' + 'ji');
    expect(workbenchSource).not.toContain('批量同步');
    expect(workbenchSource).not.toContain('批量创建');
    expect(workbenchSource).not.toContain('批量补充');
  });
});

function createDailyImportRows(): LeadImportInputRow[] {
  return [
    { company_name: 'Daily Direct One', mobile: '13871000001', score: 20, grade: 'C', city: 'Foshan' },
    { company_name: 'Daily Direct Two', tel: '0757-7100002', score: 30, grade: 'B', city: 'Foshan' },
    { company_name: 'Daily CRM Lookup One', score: 86, grade: 'B', city: 'Guangzhou', industry: 'Lighting' },
    { company_name: 'Daily CRM Lookup Two', score: 91, grade: 'A', city: 'Guangzhou', industry: 'Equipment' },
    { company_name: 'Daily Lookup First One', score: 72, grade: 'B', city: 'Zhongshan' },
    { company_name: 'Daily Lookup First Two', score: 78, grade: 'B', city: 'Zhongshan' },
    { company_name: 'Daily Reserve One', score: 40, grade: 'C', city: 'Jiangmen' },
    { company_name: 'Daily Ignore One', score: 5, grade: 'D', city: 'Dongguan' },
  ];
}

async function markImportedRowsAs(
  db: DatabaseLike,
  rows: LeadImportRow[],
  decisionsByCompanyName: Record<string, LeadImportRow['decision']>,
): Promise<void> {
  for (const row of rows) {
    const decision = decisionsByCompanyName[row.company_name];
    if (decision) {
      await db.execute('UPDATE lead_import_rows SET decision = ? WHERE id = ?', [decision, row.id]);
    }
  }
}

async function seedExecutedDailyBatch(db: DatabaseLike): Promise<{
  batchId: string;
  lookupFirstWorkItem: LeadWorkItem;
  crmLookupWorkItem: LeadWorkItem;
}> {
  const imported = await importLeadRowsToBatch(
    db,
    { batch_name: 'daily e2e seed', batch_type: 'AI_DAILY', source_label: 'e2e-seed' },
    createDailyImportRows(),
  );
  await markImportedRowsAs(db, imported.rows, {
    'Daily Reserve One': 'RESERVE',
    'Daily Ignore One': 'IGNORE',
  });
  await executeLeadImportBatchDecisions(db, imported.batch.id);
  const workItems = await listLeadWorkItemsByBatchId(db, imported.batch.id);
  const lookupFirstWorkItem = workItems.find(item => item.work_type === 'NEW_CUSTOMER_LOOKUP');
  const crmLookupWorkItem = workItems.find(item => item.work_type === 'CRM_CUSTOMER_ENRICHMENT');

  if (!lookupFirstWorkItem || !crmLookupWorkItem) {
    throw new Error('Expected seed batch to create lookup and CRM enrichment work items');
  }

  return {
    batchId: imported.batch.id,
    lookupFirstWorkItem,
    crmLookupWorkItem,
  };
}

async function getCustomer(db: DatabaseLike, id: string): Promise<Customer | null> {
  const rows = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', [id]);
  return rows[0] || null;
}

async function getCustomerByPhone(db: DatabaseLike, phoneNumber: string): Promise<Customer | null> {
  const rows = await db.select<Customer>('SELECT * FROM customers WHERE phone_number = ?', [phoneNumber]);
  return rows[0] || null;
}

async function listSyncLogs(db: DatabaseLike): Promise<SyncLogRow[]> {
  return db.select<SyncLogRow>(
    'SELECT collected_lead_id, action, target_customer_id, status, message FROM lead_sync_logs ORDER BY rowid ASC',
  );
}

function logFor(logs: SyncLogRow[], collectedLeadId: string): SyncLogRow | undefined {
  return logs.find(log => log.collected_lead_id === collectedLeadId);
}

async function insertCollectedLeadIgnoringForeignKey(
  db: DatabaseLike,
  overrides: Partial<CollectedLead>,
): Promise<CollectedLead> {
  const draft = makeCollectedLead(overrides);

  await db.execute('PRAGMA foreign_keys = OFF');
  await db.execute(
    `INSERT INTO collected_leads (
      id, work_item_id, import_row_id, customer_id, company_name, contact_name,
      position, mobile, tel, website, email, raw_text, note, sync_status,
      created_customer_id, updated_customer_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id,
      draft.work_item_id,
      draft.import_row_id,
      draft.customer_id,
      draft.company_name,
      draft.contact_name,
      draft.position,
      draft.mobile,
      draft.tel,
      draft.website,
      draft.email,
      draft.raw_text,
      draft.note,
      draft.sync_status,
      draft.created_customer_id,
      draft.updated_customer_id,
      draft.created_at,
      draft.updated_at,
    ],
  );
  await db.execute('PRAGMA foreign_keys = ON');

  return draft;
}

function makeCollectedLead(overrides: Partial<CollectedLead>): CollectedLead {
  return {
    id: `collected-${Math.random().toString(16).slice(2)}`,
    work_item_id: null,
    import_row_id: null,
    customer_id: null,
    company_name: 'Collected Lead Co',
    contact_name: 'Collected Contact',
    position: null,
    mobile: '13800000000',
    tel: null,
    website: null,
    email: null,
    raw_text: 'raw text',
    note: 'note text',
    sync_status: 'UNSYNCED',
    created_customer_id: null,
    updated_customer_id: null,
    created_at: '2026-06-16T00:00:00.000Z',
    updated_at: '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}
