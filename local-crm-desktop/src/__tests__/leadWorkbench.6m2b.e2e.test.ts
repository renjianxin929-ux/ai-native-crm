import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { buildFullBackupPayload, restoreBackupPayloadWithDb } from '../lib/backupRestore';
import {
  initializeDatabaseSchema,
  type DatabaseLike,
} from '../lib/db';
import { getLeadWorkItemById, getLeadWorkItemStatusCounts } from '../lib/leadWorkbench/db';
import {
  readLeadClipboard,
  saveCollectedLeadWorkflow,
  saveLeadCaptureWorkflow,
  startLeadQueryWorkflow,
} from '../lib/leadWorkbench/workflow';

type DiskDb = DatabaseLike & {
  path: string;
  close(): void;
};

describe('Phase 6M-2B old-schema release gate', () => {
  it('migrates an old on-disk DB and preserves historical and corrupted data', async () => {
    const fixture = createOldSchemaFixture();
    try {
      const before = await snapshotHistoricalData(fixture.db);

      await initializeDatabaseSchema(fixture.db);
      await initializeDatabaseSchema(fixture.db);

      const columns = await fixture.db.select<{ name: string; type: string }>(
        'PRAGMA table_info(collected_leads)',
      );
      const triggers = await fixture.db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
      );
      const after = await snapshotHistoricalData(fixture.db);

      expect(columns.filter(column => column.name === 'capture_event_id')).toEqual([
        expect.objectContaining({ name: 'capture_event_id', type: 'TEXT' }),
      ]);
      expect(triggers.map(trigger => trigger.name)).toEqual([
        'trg_collected_lead_collect_work_item',
        'trg_lead_capture_event_stage_work_item',
      ]);
      expect(after).toEqual(before);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails initialization clearly when ALTER TABLE or trigger creation fails', async () => {
    const alterFixture = createOldSchemaFixture();
    try {
      const failingAlterDb = failSqlMatching(
        alterFixture.db,
        'ALTER TABLE collected_leads ADD COLUMN capture_event_id TEXT',
        'forced ALTER failure',
      );
      await expect(initializeDatabaseSchema(failingAlterDb)).rejects.toThrow('forced ALTER failure');
    } finally {
      alterFixture.cleanup();
    }

    const triggerFixture = createOldSchemaFixture();
    try {
      const failingTriggerDb = failSqlMatching(
        triggerFixture.db,
        'CREATE TRIGGER IF NOT EXISTS trg_lead_capture_event_stage_work_item',
        'forced trigger failure',
      );
      await expect(initializeDatabaseSchema(failingTriggerDb)).rejects.toThrow(
        'forced trigger failure',
      );
      const triggers = await triggerFixture.db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'trigger'",
      );
      expect(triggers).toEqual([]);
    } finally {
      triggerFixture.cleanup();
    }
  });

  it('protects historical events, terminal states, and collected trigger boundaries', async () => {
    const fixture = createOldSchemaFixture();
    try {
      await initializeDatabaseSchema(fixture.db);
      expect((await getLeadWorkItemById(fixture.db, 'historical-searching'))?.status).toBe('SEARCHING');

      const protectedStatuses = ['TODO', 'COLLECTED', 'DONE', 'NO_PHONE', 'SKIPPED'] as const;
      for (const status of protectedStatuses) {
        await insertCaptureEvent(fixture.db, `protected-${status}`, 'CAPTURE_SAVED');
        expect((await getLeadWorkItemById(fixture.db, `protected-${status}`))?.status).toBe(status);
      }

      await insertCollectedLead(fixture.db, {
        id: 'null-capture-draft',
        workItemId: 'null-capture-searching',
        captureEventId: null,
        mobile: '13900000001',
      });
      expect((await getLeadWorkItemById(fixture.db, 'null-capture-searching'))?.status).toBe(
        'SEARCHING',
      );

      await insertCaptureEvent(fixture.db, 'nonnull-capture-searching', 'PARSED');
      await insertCollectedLead(fixture.db, {
        id: 'nonnull-capture-draft',
        workItemId: 'nonnull-capture-searching',
        captureEventId: 'event-nonnull-capture-searching',
        mobile: '13900000002',
      });
      expect((await getLeadWorkItemById(fixture.db, 'nonnull-capture-searching'))?.status).toBe(
        'COLLECTED',
      );

      for (const status of ['DONE', 'NO_PHONE', 'SKIPPED'] as const) {
        await insertCollectedLead(fixture.db, {
          id: `terminal-draft-${status}`,
          workItemId: `protected-${status}`,
          captureEventId: `event-protected-${status}`,
          mobile: `1390000000${status.length}`,
        });
        expect((await getLeadWorkItemById(fixture.db, `protected-${status}`))?.status).toBe(status);
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('runs the complete migrated 6M workflow through reload, backup, and restore', async () => {
    const source = createOldSchemaFixture();
    const restored = createEmptyFixture();
    try {
      await initializeDatabaseSchema(source.db);
      await initializeDatabaseSchema(restored.db);

      const writeText = vi.fn().mockResolvedValue(undefined);
      const start = await startLeadQueryWorkflow(source.db, 'main-work', { writeText });
      expect(start.new_status).toBe('SEARCHING');
      expect(writeText).toHaveBeenCalledWith('Migration Test Company phone');

      const read = await readLeadClipboard({
        readText: vi.fn().mockResolvedValue(
          'Contact Wang Manager Mobile 13071897630 Email wang@example.com',
        ),
      });
      expect(read.ok).toBe(true);
      expect(await source.db.select('SELECT * FROM lead_capture_events WHERE work_item_id = ?', [
        'main-work',
      ])).toEqual([]);
      expect(await source.db.select('SELECT * FROM collected_leads WHERE work_item_id = ?', [
        'main-work',
      ])).toEqual([]);

      const capture = await saveLeadCaptureWorkflow(source.db, {
        workItemId: 'main-work',
        rawText: read.text,
      });
      const collected = await saveCollectedLeadWorkflow(source.db, {
        workItemId: 'main-work',
        captureEventId: capture.capture_event_id,
      });
      const countsBeforeReload = await getLeadWorkItemStatusCounts(source.db);

      source.reopen();
      expect((await getLeadWorkItemById(source.db, 'main-work'))?.status).toBe('COLLECTED');
      expect(await getLeadWorkItemStatusCounts(source.db)).toEqual(countsBeforeReload);
      expect(await source.db.select<{ capture_event_id: string }>(
        'SELECT capture_event_id FROM collected_leads WHERE id = ?',
        [collected.collected_lead_id],
      )).toEqual([{ capture_event_id: capture.capture_event_id }]);

      const backup = await buildFullBackupPayload(source.db, { version: '6M-2B' });
      await restoreBackupPayloadWithDb(restored.db, backup);

      expect((await getLeadWorkItemById(restored.db, 'main-work'))?.status).toBe('COLLECTED');
      expect(await restored.db.select(
        'SELECT id, action FROM lead_capture_events WHERE id = ?',
        [capture.capture_event_id],
      )).toEqual([{ id: capture.capture_event_id, action: 'CAPTURE_SAVED' }]);
      expect(await restored.db.select(
        'SELECT id, capture_event_id FROM collected_leads WHERE id = ?',
        [collected.collected_lead_id],
      )).toEqual([{
        id: collected.collected_lead_id,
        capture_event_id: capture.capture_event_id,
      }]);
    } finally {
      source.cleanup();
      restored.cleanup();
    }
  });
});

function createOldSchemaFixture() {
  const fixture = createEmptyFixture();
  const sqlite = new Database(fixture.path);
  try {
    createOldSchema(sqlite);
    seedOldData(sqlite);
  } finally {
    sqlite.close();
  }
  return fixture;
}

function createEmptyFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'local-crm-6m2b-'));
  const path = join(directory, 'crm.db');
  let db = createDiskDb(path);
  return {
    path,
    get db() {
      return db;
    },
    reopen() {
      db.close();
      db = createDiskDb(path);
    },
    cleanup() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createDiskDb(path: string): DiskDb {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  return {
    path,
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

function createOldSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE follow_up_records (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE visit_records (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_drafts (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      customer_id TEXT,
      raw_input_summary TEXT,
      ai_result_json TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL,
      created_at TEXT NOT NULL,
      applied_at TEXT
    );
    CREATE TABLE lead_import_batches (
      id TEXT PRIMARY KEY,
      batch_name TEXT NOT NULL,
      batch_type TEXT NOT NULL,
      source_label TEXT,
      total_rows INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE lead_import_rows (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      raw_data_json TEXT NOT NULL DEFAULT '{}',
      company_name TEXT,
      decision TEXT NOT NULL DEFAULT 'RESERVE',
      decision_status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE lead_work_items (
      id TEXT PRIMARY KEY,
      import_row_id TEXT,
      customer_id TEXT,
      work_type TEXT NOT NULL,
      company_name TEXT,
      city TEXT,
      industry TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      lookup_goal TEXT NOT NULL,
      tanji_search_keyword TEXT,
      status TEXT NOT NULL DEFAULT 'TODO',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE lead_capture_events (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      parsed_json TEXT NOT NULL DEFAULT '{}',
      confidence_json TEXT NOT NULL DEFAULT '{}',
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE collected_leads (
      id TEXT PRIMARY KEY,
      work_item_id TEXT,
      import_row_id TEXT,
      customer_id TEXT,
      company_name TEXT,
      contact_name TEXT,
      position TEXT,
      mobile TEXT,
      tel TEXT,
      website TEXT,
      email TEXT,
      raw_text TEXT,
      note TEXT,
      sync_status TEXT NOT NULL DEFAULT 'UNSYNCED',
      created_customer_id TEXT,
      updated_customer_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE lead_sync_logs (
      id TEXT PRIMARY KEY,
      collected_lead_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_customer_id TEXT,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function seedOldData(sqlite: Database.Database) {
  const timestamp = '2026-06-18T00:00:00.000Z';
  sqlite.prepare(
    'INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run('legacy-customer', 'Legacy Customer', timestamp, timestamp);
  sqlite.prepare(
    `INSERT INTO lead_import_batches (
      id, batch_name, batch_type, total_rows, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('corrupt-batch', 'Historical corrupt batch', 'AI_DAILY', 5, timestamp, timestamp);

  const items = [
    ['historical-searching', 'Historical Search', 'SEARCHING'],
    ['main-work', 'Migration Test Company', 'TODO'],
    ['null-capture-searching', 'Null Capture Search', 'SEARCHING'],
    ['nonnull-capture-searching', 'Non-null Capture Search', 'SEARCHING'],
    ['protected-TODO', 'Protected TODO', 'TODO'],
    ['protected-COLLECTED', 'Protected COLLECTED', 'COLLECTED'],
    ['protected-DONE', 'Protected DONE', 'DONE'],
    ['protected-NO_PHONE', 'Protected NO PHONE', 'NO_PHONE'],
    ['protected-SKIPPED', 'Protected SKIPPED', 'SKIPPED'],
  ];
  const statement = sqlite.prepare(
    `INSERT INTO lead_work_items (
      id, work_type, company_name, priority, lookup_goal, tanji_search_keyword,
      status, created_at, updated_at
    ) VALUES (?, 'NEW_CUSTOMER_LOOKUP', ?, 50, 'FIND_PHONE', ?, ?, ?, ?)`,
  );
  for (const [id, companyName, status] of items) {
    const keyword = id === 'main-work' ? 'Migration Test Company phone' : `${companyName} phone`;
    statement.run(id, companyName, keyword, status, timestamp, timestamp);
  }
  sqlite.prepare(
    `INSERT INTO lead_capture_events (
      id, work_item_id, raw_text, parsed_json, confidence_json, action, created_at
    ) VALUES (?, ?, ?, '{}', '{}', ?, ?)`,
  ).run(
    'historical-event',
    'historical-searching',
    'historical capture event',
    'CAPTURE_SAVED',
    timestamp,
  );
  sqlite.prepare(
    `INSERT INTO collected_leads (
      id, work_item_id, company_name, mobile, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'legacy-collected',
    'historical-searching',
    'Historical Search',
    '13800138000',
    timestamp,
    timestamp,
  );
}

async function snapshotHistoricalData(db: DatabaseLike) {
  return {
    customers: await db.select(
      'SELECT id, name, created_at, updated_at FROM customers ORDER BY id',
    ),
    corruptBatch: await db.select(
      `SELECT b.id, b.total_rows, COUNT(r.id) AS row_count
       FROM lead_import_batches b
       LEFT JOIN lead_import_rows r ON r.batch_id = b.id
       WHERE b.id = 'corrupt-batch'
       GROUP BY b.id, b.total_rows`,
    ),
    workItems: await db.select(
      "SELECT id, status FROM lead_work_items WHERE id NOT LIKE 'main-%' ORDER BY id",
    ),
    captureEvents: await db.select('SELECT * FROM lead_capture_events ORDER BY id'),
    collectedLeads: await db.select(
      'SELECT id, work_item_id, company_name, mobile FROM collected_leads ORDER BY id',
    ),
  };
}

function failSqlMatching(db: DatabaseLike, fragment: string, message: string): DatabaseLike {
  return {
    select: db.select,
    async execute(sql, bindings) {
      if (sql.includes(fragment)) throw new Error(message);
      return db.execute(sql, bindings);
    },
  };
}

async function insertCaptureEvent(
  db: DatabaseLike,
  workItemId: string,
  action: 'CAPTURE_SAVED' | 'PARSED',
) {
  await db.execute(
    `INSERT INTO lead_capture_events (
      id, work_item_id, raw_text, parsed_json, confidence_json, action, created_at
    ) VALUES (?, ?, ?, '{}', '{}', ?, ?)`,
    [
      `event-${workItemId}`,
      workItemId,
      `capture ${workItemId}`,
      action,
      '2026-06-19T00:00:00.000Z',
    ],
  );
}

async function insertCollectedLead(
  db: DatabaseLike,
  input: {
    id: string;
    workItemId: string;
    captureEventId: string | null;
    mobile: string;
  },
) {
  await db.execute(
    `INSERT INTO collected_leads (
      id, work_item_id, capture_event_id, company_name, mobile, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.workItemId,
      input.captureEventId,
      input.workItemId,
      input.mobile,
      '2026-06-19T00:00:00.000Z',
      '2026-06-19T00:00:00.000Z',
    ],
  );
}
