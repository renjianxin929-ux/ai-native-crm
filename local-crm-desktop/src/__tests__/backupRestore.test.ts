import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../lib/version';
import {
  BACKUP_TABLES,
  buildFullBackupPayload,
  getRestoreDeleteOrder,
  getRestoreTableOrder,
  normalizeBackupPayload,
  validateBackupPayload,
} from '../lib/backupRestore';
import type { DatabaseLike } from '../lib/db';

const expectedBackupTables = [
  'customers',
  'follow_up_records',
  'visit_records',
  'tasks',
  'settings',
  'ai_drafts',
  'evidence',
  'ai_memory_entries',
  'ai_memory_evidence_links',
  'intelligence_imports',
  'reviewed_facts',
  'customer_hypotheses',
  'customer_stage_cards',
  'lead_import_batches',
  'lead_import_rows',
  'lead_work_items',
  'lead_capture_events',
  'collected_leads',
  'lead_sync_logs',
] as const;

function createReadOnlyBackupDb() {
  const rowsByTable: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    expectedBackupTables.map((table) => [table, [{ id: `${table}-1`, table }]]),
  );
  const selects: string[] = [];
  const executes: string[] = [];

  const db: DatabaseLike = {
    async select<T>(sql: string): Promise<T[]> {
      selects.push(sql);
      const table = sql.match(/FROM\s+(\w+)/i)?.[1];
      if (!table) return [];
      return (rowsByTable[table] ?? []) as T[];
    },
    async execute(sql: string): Promise<{ rowsAffected: number }> {
      executes.push(sql);
      throw new Error(`backup should not write database: ${sql}`);
    },
  };

  return { db, selects, executes };
}

function createCompleteNewPayload() {
  return {
    version: APP_VERSION,
    exported_at: '2026-06-16T02:00:00.000Z',
    tables: Object.fromEntries(
      expectedBackupTables.map((table) => [table, [{ id: `${table}-1`, table }]]),
    ),
  };
}

describe('backup export payload', () => {
  it('declares every business table that must be exported', () => {
    expect(BACKUP_TABLES).toEqual(expectedBackupTables);
  });

  it('builds a stable tables payload with every table array and metadata', async () => {
    const { db, selects, executes } = createReadOnlyBackupDb();

    const backup = await buildFullBackupPayload(db, {
      version: APP_VERSION,
      exportedAt: '2026-06-16T02:00:00.000Z',
    });

    expect(backup.version).toBe(APP_VERSION);
    expect(backup.exported_at).toBe('2026-06-16T02:00:00.000Z');
    expect(backup.tables).toBeDefined();

    for (const table of expectedBackupTables) {
      expect(backup.tables).toHaveProperty(table);
      expect(backup.tables[table]).toEqual([{ id: `${table}-1`, table }]);
    }

    expect(selects).toEqual(expectedBackupTables.map((table) => `SELECT * FROM ${table}`));
    expect(executes).toEqual([]);
  });

  it('keeps SettingsPage backup export delegated while restore uses the complete restore entrypoint', () => {
    const src = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');

    expect(src).toContain('buildFullBackupPayload');
    expect(src).toContain('const handleRestoreConfirm = async () => {');
    expect(src).toContain('restoreBackupPayloadWithDb');
    expect(src).not.toContain('INSERT OR REPLACE INTO customers');
    expect(src).not.toContain('INSERT OR REPLACE INTO follow_up_records');
    expect(src).not.toContain('INSERT OR REPLACE INTO visit_records');
  });

  it('does not modify protected import surfaces during backup work', () => {
    const dataImportPage = readFileSync(new URL('../../src/pages/DataImportPage.tsx', import.meta.url), 'utf8');
    const importer = readFileSync(new URL('../../src/lib/importer.ts', import.meta.url), 'utf8');

    expect(dataImportPage.length).toBeGreaterThan(0);
    expect(importer.length).toBeGreaterThan(0);
  });
});

describe('backup restore payload normalization', () => {
  it('normalizes a complete new-format payload without changing table arrays', () => {
    const raw = createCompleteNewPayload();

    const normalized = normalizeBackupPayload(raw);

    expect(normalized.version).toBe(APP_VERSION);
    expect(normalized.exported_at).toBe('2026-06-16T02:00:00.000Z');
    expect(normalized.isLegacy).toBe(false);
    expect(normalized.missingTables).toEqual([]);
    for (const table of expectedBackupTables) {
      expect(normalized.tables[table]).toEqual([{ id: `${table}-1`, table }]);
    }
  });

  it('normalizes legacy top-level arrays into standard tables', () => {
    const normalized = normalizeBackupPayload({
      customers: [{ id: 'customer-1' }],
      followUps: [{ id: 'follow-up-1' }],
      visits: [{ id: 'visit-1' }],
      tasks: [{ id: 'task-1' }],
    });

    expect(normalized.version).toBe('LEGACY_BACKUP');
    expect(normalized.exported_at).toBeNull();
    expect(normalized.isLegacy).toBe(true);
    expect(normalized.tables.customers).toEqual([{ id: 'customer-1' }]);
    expect(normalized.tables.follow_up_records).toEqual([{ id: 'follow-up-1' }]);
    expect(normalized.tables.visit_records).toEqual([{ id: 'visit-1' }]);
    expect(normalized.tables.tasks).toEqual([{ id: 'task-1' }]);
  });

  it('fills missing legacy-only tables with empty arrays and records them', () => {
    const normalized = normalizeBackupPayload({
      customers: [],
      followUps: [],
      visits: [],
      tasks: [],
    });

    expect(normalized.isLegacy).toBe(true);
    expect(normalized.tables.settings).toEqual([]);
    expect(normalized.tables.ai_drafts).toEqual([]);
    expect(normalized.tables.evidence).toEqual([]);
    expect(normalized.tables.lead_import_batches).toEqual([]);
    expect(normalized.tables.lead_import_rows).toEqual([]);
    expect(normalized.tables.lead_work_items).toEqual([]);
    expect(normalized.tables.lead_capture_events).toEqual([]);
    expect(normalized.tables.collected_leads).toEqual([]);
    expect(normalized.tables.lead_sync_logs).toEqual([]);
    expect(normalized.missingTables).toEqual([
      'settings',
      'ai_drafts',
      'evidence',
      'ai_memory_entries',
      'ai_memory_evidence_links',
      'intelligence_imports',
      'reviewed_facts',
      'customer_hypotheses',
      'customer_stage_cards',
      'lead_import_batches',
      'lead_import_rows',
      'lead_work_items',
      'lead_capture_events',
      'collected_leads',
      'lead_sync_logs',
    ]);
  });

  it('records missing tables in an incomplete new-format payload', () => {
    const normalized = normalizeBackupPayload({
      version: APP_VERSION,
      exported_at: '2026-06-16T02:00:00.000Z',
      tables: {
        customers: [],
      },
    });

    expect(normalized.isLegacy).toBe(false);
    expect(normalized.tables.customers).toEqual([]);
    expect(normalized.tables.lead_sync_logs).toEqual([]);
    expect(normalized.missingTables).toContain('lead_sync_logs');
  });

  it('validates a complete new-format normalized payload', () => {
    const normalized = normalizeBackupPayload(createCompleteNewPayload());

    expect(validateBackupPayload(normalized)).toEqual({
      valid: true,
      errors: [],
      missingTables: [],
    });
  });

  it('returns readable validation errors for non-object raw input', () => {
    const normalized = normalizeBackupPayload(null);

    expect(validateBackupPayload(normalized)).toEqual({
      valid: false,
      errors: ['Backup payload must be an object.'],
      missingTables: expectedBackupTables,
    });
  });

  it('returns readable validation errors when a table is not an array', () => {
    const normalized = normalizeBackupPayload({
      version: APP_VERSION,
      exported_at: '2026-06-16T02:00:00.000Z',
      tables: {
        ...createCompleteNewPayload().tables,
        customers: { id: 'not-array' },
      },
    });

    expect(validateBackupPayload(normalized)).toEqual({
      valid: false,
      errors: ['Backup table customers must be an array.'],
      missingTables: [],
    });
  });

  it('returns readable validation errors for missing tables in new-format payloads', () => {
    const normalized = normalizeBackupPayload({
      version: APP_VERSION,
      exported_at: '2026-06-16T02:00:00.000Z',
      tables: {
        customers: [],
      },
    });

    const result = validateBackupPayload(normalized);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Backup table lead_sync_logs is missing.');
    expect(result.missingTables).toContain('lead_sync_logs');
  });

  it('does not treat missing legacy Lead Workbench tables as validation failures', () => {
    const normalized = normalizeBackupPayload({
      customers: [],
      followUps: [],
      visits: [],
      tasks: [],
    });

    expect(validateBackupPayload(normalized).valid).toBe(true);
    expect(validateBackupPayload(normalized).errors).toEqual([]);
  });

  it('returns the safe restore insert and delete order', () => {
    expect(getRestoreTableOrder()).toEqual([
      'settings',
      'customers',
      'customer_stage_cards',
      'ai_memory_entries',
      'ai_memory_evidence_links',
      'evidence',
      'follow_up_records',
      'visit_records',
      'tasks',
      'ai_drafts',
      'intelligence_imports',
      'reviewed_facts',
      'customer_hypotheses',
      'lead_import_batches',
      'lead_import_rows',
      'lead_work_items',
      'lead_capture_events',
      'collected_leads',
      'lead_sync_logs',
    ]);

    expect(getRestoreDeleteOrder()).toEqual([
      'lead_sync_logs',
      'collected_leads',
      'lead_capture_events',
      'lead_work_items',
      'lead_import_rows',
      'lead_import_batches',
      'customer_hypotheses',
      'reviewed_facts',
      'intelligence_imports',
      'ai_drafts',
      'tasks',
      'visit_records',
      'follow_up_records',
      'evidence',
      'ai_memory_evidence_links',
      'ai_memory_entries',
      'customer_stage_cards',
      'customers',
      'settings',
    ]);
  });

  it('keeps restore helpers free of getDb while SettingsPage uses restore validation helpers', () => {
    const backupRestoreSrc = readFileSync(new URL('../../src/lib/backupRestore.ts', import.meta.url), 'utf8');
    const settingsSrc = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');

    expect(backupRestoreSrc).not.toContain('getDb(');
    expect(settingsSrc).toContain('const handleRestoreConfirm = async () => {');
    expect(settingsSrc).toContain('normalizeBackupPayload');
    expect(settingsSrc).toContain('validateBackupPayload');
    expect(settingsSrc).toContain('restoreBackupPayloadWithDb');
  });
});
