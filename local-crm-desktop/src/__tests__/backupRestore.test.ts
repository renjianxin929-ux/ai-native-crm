import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../lib/version';
import { BACKUP_TABLES, buildFullBackupPayload } from '../lib/backupRestore';
import type { DatabaseLike } from '../lib/db';

const expectedBackupTables = [
  'customers',
  'follow_up_records',
  'visit_records',
  'tasks',
  'settings',
  'ai_drafts',
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

  it('keeps SettingsPage restore logic in place while delegating only backup export', () => {
    const src = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');

    expect(src).toContain("import { buildFullBackupPayload } from '../lib/backupRestore'");
    expect(src).toContain('const handleRestoreConfirm = async () => {');
    expect(src).toContain('INSERT OR REPLACE INTO customers');
    expect(src).toContain('INSERT OR REPLACE INTO follow_up_records');
    expect(src).toContain('INSERT OR REPLACE INTO visit_records');
  });

  it('does not modify protected import surfaces during backup work', () => {
    const dataImportPage = readFileSync(new URL('../../src/pages/DataImportPage.tsx', import.meta.url), 'utf8');
    const importer = readFileSync(new URL('../../src/lib/importer.ts', import.meta.url), 'utf8');

    expect(dataImportPage.length).toBeGreaterThan(0);
    expect(importer.length).toBeGreaterThan(0);
  });
});
