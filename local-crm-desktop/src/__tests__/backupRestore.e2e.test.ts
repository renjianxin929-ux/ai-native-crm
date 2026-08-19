import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_TABLES,
  buildFullBackupPayload,
  getRestoreDeleteOrder,
  restoreBackupPayloadWithDb,
  type BackupTableName,
  type FullBackupPayload,
} from '../lib/backupRestore';
import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { insertLeadCaptureEvent, listLeadCaptureEventsByWorkItemId } from '../lib/leadWorkbench/captureEvents';
import {
  getCollectedLeadById,
  insertCollectedLeadDraft,
  listCollectedLeadsByWorkItemId,
} from '../lib/leadWorkbench/collectedLeads';
import { executeLeadImportBatchDecisions } from '../lib/leadWorkbench/decision';
import {
  listLeadImportBatches,
  listLeadImportRowsByBatchId,
  listLeadWorkItems,
  listLeadWorkItemsByBatchId,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import { syncCollectedLeadCreateCustomer } from '../lib/leadWorkbench/syncAdapter';

type SqliteTestDb = DatabaseLike & { close(): void };
type TableCounts = Record<BackupTableName, number>;
type SyncLogRow = {
  id: string;
  collected_lead_id: string;
  action: string;
  target_customer_id: string | null;
  status: string;
  message: string;
};

function createSqliteDb(): SqliteTestDb {
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

async function createReadyDb(): Promise<SqliteTestDb> {
  const db = createSqliteDb();
  await initializeDatabaseSchema(db);
  return db;
}

describe('backup and restore end-to-end acceptance', () => {
  it('exports a complete backup, restores it over polluted data, and preserves every business table', async () => {
    const db = await createReadyDb();
    try {
      const seed = await seedCompleteDailyData(db);
      const backup = await buildFullBackupPayload(db, {
        version: '0.4.0',
        exportedAt: '2026-06-16T03:00:00.000Z',
      });

      for (const table of BACKUP_TABLES) {
        expect(Array.isArray(backup.tables[table]), `${table} should be included in the backup`).toBe(true);
      }

      await replaceWithPollutedData(db);
      expect(await countRows(db)).not.toEqual(backup.counts);

      const result = await restoreBackupPayloadWithDb(db, backup);

      expect(result.ok).toBe(true);
      expect(result.restoredCounts).toEqual(backup.counts);
      expect(await countRows(db)).toEqual(backup.counts);
      for (const table of BACKUP_TABLES) {
        expect(await selectAll(db, table)).toEqual(backup.tables[table]);
      }

      const restoredLead = await getCollectedLeadById(db, seed.collectedLeadId);
      expect(restoredLead).toMatchObject({
        sync_status: 'SYNCED',
        created_customer_id: seed.createdCustomerId,
        updated_customer_id: null,
      });
    } finally {
      db.close();
    }
  });

  it('keeps restored Lead Workbench data readable through the main query helpers', async () => {
    const db = await createReadyDb();
    try {
      const seed = await seedCompleteDailyData(db);
      const backup = await buildFullBackupPayload(db, { version: '0.4.0' });

      await replaceWithPollutedData(db);
      await restoreBackupPayloadWithDb(db, backup);

      const batches = await listLeadImportBatches(db);
      const rows = await listLeadImportRowsByBatchId(db, seed.batchId);
      const workItems = await listLeadWorkItems(db);
      const todoWorkItems = await listLeadWorkItemsByStatus(db, 'TODO');
      const batchWorkItems = await listLeadWorkItemsByBatchId(db, seed.batchId);
      const captureEvents = await listLeadCaptureEventsByWorkItemId(db, seed.workItemId);
      const collectedLeads = await listCollectedLeadsByWorkItemId(db, seed.workItemId);
      const syncLogs = await listSyncLogs(db);

      expect(batches.map(batch => batch.id)).toContain(seed.batchId);
      expect(rows.map(row => row.id)).toContain(seed.importRowId);
      expect(rows.find(row => row.id === seed.importRowId)).toMatchObject({
        decision_status: 'DONE',
        created_work_item_id: seed.workItemId,
      });
      expect(workItems.map(item => item.id)).toContain(seed.workItemId);
      expect(todoWorkItems.map(item => item.id)).toContain(seed.workItemId);
      expect(batchWorkItems.map(item => item.id)).toContain(seed.workItemId);
      expect(captureEvents.map(event => event.id)).toContain(seed.captureEventId);
      expect(collectedLeads).toContainEqual(expect.objectContaining({
        id: seed.collectedLeadId,
        sync_status: 'SYNCED',
        created_customer_id: seed.createdCustomerId,
        updated_customer_id: null,
      }));
      expect(syncLogs).toContainEqual(expect.objectContaining({
        collected_lead_id: seed.collectedLeadId,
        action: 'CREATE_CUSTOMER',
        status: 'SUCCESS',
        target_customer_id: seed.createdCustomerId,
        message: 'Created customer from collected lead',
      }));
    } finally {
      db.close();
    }
  });

  it('restores legacy backups without crashing and treats new Lead Workbench tables as empty arrays', async () => {
    const db = await createReadyDb();
    try {
      await seedCompleteDailyData(db);

      const result = await restoreBackupPayloadWithDb(db, {
        customers: [legacyCustomer()],
        followUps: [legacyFollowUp()],
        visits: [legacyVisit()],
        tasks: [legacyTask()],
      });

      expect(result.ok).toBe(true);
      expect(result.isLegacy).toBe(true);
      expect(result.warnings).toContain('Legacy backup missing table lead_sync_logs; restored as empty array.');
      expect(await selectAll(db, 'customers')).toContainEqual(expect.objectContaining(legacyCustomer()));
      expect(await selectAll(db, 'follow_up_records')).toContainEqual(expect.objectContaining(legacyFollowUp()));
      expect(await selectAll(db, 'visit_records')).toContainEqual(expect.objectContaining(legacyVisit()));
      expect(await selectAll(db, 'tasks')).toContainEqual(expect.objectContaining(legacyTask()));
      expect(await selectAll(db, 'lead_import_batches')).toEqual([]);
      expect(await selectAll(db, 'lead_import_rows')).toEqual([]);
      expect(await selectAll(db, 'lead_work_items')).toEqual([]);
      expect(await selectAll(db, 'lead_capture_events')).toEqual([]);
      expect(await selectAll(db, 'collected_leads')).toEqual([]);
      expect(await selectAll(db, 'lead_sync_logs')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('rolls back failed restores without leaving half-restored CRM or Lead Workbench data', async () => {
    const db = await createReadyDb();
    try {
      const seed = await seedCompleteDailyData(db);
      const beforeBackup = await buildFullBackupPayload(db, { version: '0.4.0' });
      const failingPayload: FullBackupPayload = {
        ...beforeBackup,
        tables: {
          ...beforeBackup.tables,
          lead_work_items: [
            {
              ...beforeBackup.tables.lead_work_items[0],
              missing_column_for_e2e_failure: 'boom',
            },
          ],
        },
      };

      await expect(restoreBackupPayloadWithDb(db, failingPayload)).rejects.toThrow('Restore failed and rolled back');

      expect(await countRows(db)).toEqual(beforeBackup.counts);
      for (const table of BACKUP_TABLES) {
        expect(await selectAll(db, table)).toEqual(beforeBackup.tables[table]);
      }
      expect(await getCollectedLeadById(db, seed.collectedLeadId)).toMatchObject({
        sync_status: 'SYNCED',
        created_customer_id: seed.createdCustomerId,
      });
      expect(await listSyncLogs(db)).toContainEqual(expect.objectContaining({
        collected_lead_id: seed.collectedLeadId,
        target_customer_id: seed.createdCustomerId,
      }));
    } finally {
      db.close();
    }
  });

  it('keeps the e2e boundary away from protected files, UI features, exe packaging, and automation', () => {
    const e2eSource = readFileSync(new URL('./backupRestore.e2e.test.ts', import.meta.url), 'utf8');
    const dataImportPage = readFileSync(
      new URL(['..', 'pages', `Data${'Import'}Page.tsx`].join('/'), import.meta.url),
      'utf8',
    );
    const importer = readFileSync(new URL('../lib/importer.ts', import.meta.url), 'utf8');

    expect(e2eSource).not.toContain('Lead' + 'ImportCenterPage');
    expect(e2eSource).not.toContain('Lead' + 'WorkbenchPage');
    expect(e2eSource).not.toContain('Data' + 'ImportPage');
    expect(e2eSource).not.toContain('src/lib/' + 'importer');
    expect(e2eSource).not.toContain('tauri' + ' build');
    expect(e2eSource).not.toContain('navigator.' + 'clipboard');
    expect(e2eSource).not.toContain('read' + 'Text');
    expect(e2eSource).not.toContain('puppet' + 'eer');
    expect(e2eSource).not.toContain('play' + 'wright');
    expect(dataImportPage.length).toBeGreaterThan(0);
    expect(importer.length).toBeGreaterThan(0);
  });
});

async function seedCompleteDailyData(db: DatabaseLike) {
  const imported = await importLeadRowsToBatch(
    db,
    { batch_name: 'backup restore e2e batch', batch_type: 'AI_DAILY', source_label: 'backup-e2e' },
    [{
      company_name: 'Backup Restore Lookup Co',
      city: 'Foshan',
      industry: 'Lighting',
      score: 76,
      grade: 'B',
      tanji_search_keyword: 'Backup Restore Lookup Co phone',
    }],
  );

  await executeLeadImportBatchDecisions(db, imported.batch.id);
  const rows = await listLeadImportRowsByBatchId(db, imported.batch.id);
  const workItems = await listLeadWorkItemsByBatchId(db, imported.batch.id);
  const row = rows[0];
  const workItem = workItems[0];

  const captureEvent = await insertLeadCaptureEvent(db, {
    work_item_id: workItem.id,
    raw_text: 'Contact: Backup Contact\nMobile: 13812345678\nEmail: backup@example.com',
    parsed_json: { mobiles: ['13812345678'], emails: ['backup@example.com'] },
    confidence_json: { source: 'backup-e2e' },
    action: 'PARSED',
  });

  const collectedLead = await insertCollectedLeadDraft(db, {
    work_item_id: workItem.id,
    capture_event_id: captureEvent.id,
    import_row_id: row.id,
    customer_id: null,
    company_name: workItem.company_name,
    contact_name: 'Backup Contact',
    position: 'Manager',
    mobile: '13812345678',
    tel: '0757-12345678',
    website: 'https://backup-restore.example.com',
    email: 'backup@example.com',
    raw_text: 'Contact: Backup Contact\nMobile: 13812345678\nEmail: backup@example.com',
    note: 'backup restore e2e collected note',
  });

  const syncResult = await syncCollectedLeadCreateCustomer(db, collectedLead.id);
  if (syncResult.status !== 'SUCCESS' || !syncResult.targetCustomerId) {
    throw new Error(`Expected collected lead sync to succeed, got ${syncResult.status}`);
  }

  await db.execute(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at,
      is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'follow-up-e2e',
      syncResult.targetCustomerId,
      'Backup Follow Up',
      'phone',
      'positive',
      'restore should keep follow up',
      'HIGH',
      'A',
      'Call again',
      '2026-06-17T10:00:00.000Z',
      0,
      '2026-06-16T01:00:00.000Z',
      '2026-06-16T01:00:00.000Z',
    ],
  );
  await db.execute(
    `INSERT INTO visit_records (
      id, customer_id, title, visited_at, visit_notes, customer_concerns,
      intent_after_visit, visit_outcome, next_action, expected_contract_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'visit-e2e',
      syncResult.targetCustomerId,
      'Backup Visit',
      '2026-06-18T09:00:00.000Z',
      'restore should keep visit',
      'price',
      'HIGH',
      'INTERESTED',
      'Send proposal',
      '2026-06-30T00:00:00.000Z',
      '2026-06-16T01:05:00.000Z',
      '2026-06-16T01:05:00.000Z',
    ],
  );
  await db.execute(
    `INSERT INTO tasks (
      id, customer_id, title, due_at, status, priority, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'task-e2e',
      syncResult.targetCustomerId,
      'Backup Task',
      '2026-06-19T09:00:00.000Z',
      'OPEN',
      'HIGH',
      'MANUAL',
      '2026-06-16T01:10:00.000Z',
      '2026-06-16T01:10:00.000Z',
    ],
  );
  await db.execute(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    ['backup.restore.e2e', 'enabled', '2026-06-16T01:15:00.000Z'],
  );
  await db.execute(
    `INSERT INTO ai_drafts (
      id, source_type, customer_id, raw_input_summary, ai_result_json,
      status, confidence, created_at, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'ai-draft-e2e',
      'MANUAL',
      syncResult.targetCustomerId,
      'backup restore e2e draft',
      '{"next_action":"Call again"}',
      'DRAFT',
      0.86,
      '2026-06-16T01:20:00.000Z',
      null,
    ],
  );
  await db.execute(
    `INSERT INTO evidence (
      id, customer_id, source_type, source_url, source_title, source_ref,
      captured_at, summary, excerpt, content_hash, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'evidence-e2e',
      syncResult.targetCustomerId,
      'URL',
      'https://backup-restore.example.com/mx-market',
      'Official site',
      null,
      '2026-06-16T01:25:00.000Z',
      'Official website now contains a Mexico market page.',
      'Mexico market page is live.',
      'e2e-content-hash',
      'ACTIVE',
      '2026-06-16T01:25:00.000Z',
      '2026-06-16T01:25:00.000Z',
    ],
  );

  return {
    batchId: imported.batch.id,
    importRowId: row.id,
    workItemId: workItem.id,
    captureEventId: captureEvent.id,
    collectedLeadId: collectedLead.id,
    createdCustomerId: syncResult.targetCustomerId,
  };
}

async function replaceWithPollutedData(db: DatabaseLike): Promise<void> {
  for (const table of getRestoreDeleteOrder()) {
    await db.execute(`DELETE FROM ${table}`);
  }

  await db.execute(
    `INSERT INTO customers (
      id, name, customer_grade, stage, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    ['polluted-customer', 'Polluted Customer', 'C', 'NEW_LEAD', '2026-06-16T02:00:00.000Z', '2026-06-16T02:00:00.000Z'],
  );
}

async function countRows(db: DatabaseLike): Promise<TableCounts> {
  const entries: Array<[BackupTableName, number]> = [];
  for (const table of BACKUP_TABLES) {
    const rows = await db.select<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
    entries.push([table, Number(rows[0]?.count ?? 0)]);
  }
  return Object.fromEntries(entries) as TableCounts;
}

async function selectAll(db: DatabaseLike, table: BackupTableName): Promise<Record<string, unknown>[]> {
  return db.select<Record<string, unknown>>(`SELECT * FROM ${table}`);
}

async function listSyncLogs(db: DatabaseLike): Promise<SyncLogRow[]> {
  return db.select<SyncLogRow>(
    'SELECT * FROM lead_sync_logs ORDER BY rowid ASC',
  );
}

function legacyCustomer() {
  return {
    id: 'legacy-customer',
    name: 'Legacy Customer',
    customer_grade: 'B',
    stage: 'NEW_LEAD',
    created_at: '2026-06-16T02:00:00.000Z',
    updated_at: '2026-06-16T02:00:00.000Z',
  };
}

function legacyFollowUp() {
  return {
    id: 'legacy-follow-up',
    customer_id: 'legacy-customer',
    title: 'Legacy Follow Up',
    created_at: '2026-06-16T02:01:00.000Z',
    updated_at: '2026-06-16T02:01:00.000Z',
  };
}

function legacyVisit() {
  return {
    id: 'legacy-visit',
    customer_id: 'legacy-customer',
    title: 'Legacy Visit',
    created_at: '2026-06-16T02:02:00.000Z',
    updated_at: '2026-06-16T02:02:00.000Z',
  };
}

function legacyTask() {
  return {
    id: 'legacy-task',
    customer_id: 'legacy-customer',
    title: 'Legacy Task',
    created_at: '2026-06-16T02:03:00.000Z',
    updated_at: '2026-06-16T02:03:00.000Z',
  };
}
