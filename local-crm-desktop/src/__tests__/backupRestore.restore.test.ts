import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_TABLES,
  getRestoreDeleteOrder,
  getRestoreTableOrder,
  restoreBackupPayloadWithDb,
  type BackupTableName,
} from '../lib/backupRestore';
import type { DatabaseLike } from '../lib/db';

type Row = Record<string, unknown>;
type Store = Record<BackupTableName, Row[]>;

const expectedTables = [...BACKUP_TABLES];

function createCompletePayload() {
  return {
    version: '0.4.0',
    exported_at: '2026-06-16T02:00:00.000Z',
    tables: Object.fromEntries(
      expectedTables.map((table) => [table, [createRow(table, 'restored')]]),
    ),
  };
}

function createRow(table: BackupTableName, suffix: string): Row {
  return {
    id: `${table}-${suffix}`,
    table,
    label: suffix,
  };
}

function createStore(label: string): Store {
  return Object.fromEntries(
    expectedTables.map((table) => [table, [createRow(table, label)]]),
  ) as Store;
}

function cloneStore(store: Store): Store {
  return Object.fromEntries(
    expectedTables.map((table) => [table, store[table].map((row) => ({ ...row }))]),
  ) as Store;
}

class TransactionalRestoreDb implements DatabaseLike {
  public store: Store;
  public statements: string[] = [];
  public failOnSql?: (sql: string) => boolean;
  private txnSnapshot: Store | null = null;

  constructor(initialStore: Store) {
    this.store = cloneStore(initialStore);
  }

  async select<T>(sql: string): Promise<T[]> {
    const countTable = sql.match(/^SELECT COUNT\(\*\) as count FROM (\w+)$/)?.[1] as BackupTableName | undefined;
    if (countTable) {
      return [{ count: this.store[countTable].length }] as T[];
    }

    const table = sql.match(/^SELECT \* FROM (\w+)$/)?.[1] as BackupTableName | undefined;
    if (table) {
      return this.store[table].map(row => ({ ...row })) as T[];
    }

    throw new Error(`unexpected select sql: ${sql}`);
  }

  async execute(sql: string, bindings: unknown[] = []): Promise<{ rowsAffected: number }> {
    this.statements.push(sql);

    if (this.failOnSql?.(sql)) {
      throw new Error(`forced failure for ${sql}`);
    }

    if (/^BEGIN\b/i.test(sql)) {
      this.txnSnapshot = cloneStore(this.store);
      return { rowsAffected: 0 };
    }
    if (/^COMMIT\b/i.test(sql)) {
      this.txnSnapshot = null;
      return { rowsAffected: 0 };
    }
    if (/^ROLLBACK\b/i.test(sql)) {
      if (this.txnSnapshot) this.store = cloneStore(this.txnSnapshot);
      this.txnSnapshot = null;
      return { rowsAffected: 0 };
    }
    if (/^PRAGMA\b/i.test(sql)) {
      return { rowsAffected: 0 };
    }

    const deleteTable = sql.match(/^DELETE FROM (\w+)$/)?.[1] as BackupTableName | undefined;
    if (deleteTable) {
      this.store[deleteTable] = [];
      return { rowsAffected: 1 };
    }

    const insertTable = sql.match(/^INSERT OR REPLACE INTO (\w+)/)?.[1] as BackupTableName | undefined;
    if (insertTable) {
      const columnsText = sql.match(/\(([^)]+)\)\s+VALUES/)?.[1] ?? '';
      const columns = columnsText.split(',').map((column) => column.trim());
      const row = Object.fromEntries(columns.map((column, index) => [column, bindings[index]]));
      const id = row.id;
      const existingIndex = this.store[insertTable].findIndex((existing) => existing.id === id);
      if (existingIndex >= 0) {
        this.store[insertTable][existingIndex] = row;
      } else {
        this.store[insertTable].push(row);
      }
      return { rowsAffected: 1 };
    }

    throw new Error(`unexpected sql: ${sql}`);
  }
}

describe('restoreBackupPayloadWithDb', () => {
  it('restores every CRM and Lead Workbench table with per-table counts', async () => {
    const db = new TransactionalRestoreDb(createStore('old'));

    const result = await restoreBackupPayloadWithDb(db, createCompletePayload());

    expect(result.ok).toBe(true);
    expect(result.isLegacy).toBe(false);
    expect(result.warnings).toEqual([]);
    for (const table of expectedTables) {
      expect(result.restoredCounts[table]).toBe(1);
      expect(db.store[table]).toEqual([createRow(table, 'restored')]);
    }
    expect(result.restoredCounts.settings).toBe(1);
    expect(result.restoredCounts.ai_drafts).toBe(1);
    expect(result.restoredCounts.tasks).toBe(1);
    expect(result.restoredCounts.lead_import_batches).toBe(1);
    expect(result.restoredCounts.lead_import_rows).toBe(1);
    expect(result.restoredCounts.lead_work_items).toBe(1);
    expect(result.restoredCounts.lead_capture_events).toBe(1);
    expect(result.restoredCounts.collected_leads).toBe(1);
    expect(result.restoredCounts.lead_sync_logs).toBe(1);
  });

  it('uses a same-connection transaction with dependency-safe delete then insert', async () => {
    const db = new TransactionalRestoreDb(createStore('old'));

    await restoreBackupPayloadWithDb(db, createCompletePayload());

    expect(db.statements[0]).toBe('BEGIN IMMEDIATE');
    expect(db.statements[1]).toBe('PRAGMA defer_foreign_keys = ON');
    const tableCount = getRestoreTableOrder().length;
    expect(db.statements.slice(2, 2 + tableCount)).toEqual(
      getRestoreDeleteOrder().map((table) => `DELETE FROM ${table}`),
    );
    expect(db.statements.slice(2 + tableCount, 2 + tableCount * 2).map((sql) => sql.match(/^INSERT OR REPLACE INTO (\w+)/)?.[1])).toEqual(
      getRestoreTableOrder(),
    );
    expect(db.statements.at(-1)).toBe('COMMIT');
  });

  it('restores legacy backups and treats missing new tables as empty arrays', async () => {
    const db = new TransactionalRestoreDb(createStore('old'));

    const result = await restoreBackupPayloadWithDb(db, {
      customers: [{ id: 'legacy-customer' }],
      followUps: [{ id: 'legacy-follow-up' }],
      visits: [{ id: 'legacy-visit' }],
      tasks: [{ id: 'legacy-task' }],
    });

    expect(result.ok).toBe(true);
    expect(result.isLegacy).toBe(true);
    expect(result.warnings).toContain('Legacy backup missing table lead_sync_logs; restored as empty array.');
    expect(db.store.customers).toEqual([{ id: 'legacy-customer' }]);
    expect(db.store.follow_up_records).toEqual([{ id: 'legacy-follow-up' }]);
    expect(db.store.visit_records).toEqual([{ id: 'legacy-visit' }]);
    expect(db.store.tasks).toEqual([{ id: 'legacy-task' }]);
    expect(db.store.lead_import_batches).toEqual([]);
    expect(db.store.lead_import_rows).toEqual([]);
    expect(db.store.lead_work_items).toEqual([]);
    expect(db.store.lead_capture_events).toEqual([]);
    expect(db.store.collected_leads).toEqual([]);
    expect(db.store.lead_sync_logs).toEqual([]);
  });

  it('rejects invalid payloads before writing database statements', async () => {
    const db = new TransactionalRestoreDb(createStore('old'));

    await expect(restoreBackupPayloadWithDb(db, null)).rejects.toThrow('Invalid backup payload: Backup payload must be an object.');

    expect(db.statements).toEqual([]);
  });

  it('rejects non-array tables before writing database statements', async () => {
    const db = new TransactionalRestoreDb(createStore('old'));
    const payload = createCompletePayload();
    payload.tables.customers = { id: 'not-array' };

    await expect(restoreBackupPayloadWithDb(db, payload)).rejects.toThrow('Invalid backup payload: Backup table customers must be an array.');

    expect(db.statements).toEqual([]);
  });

  it('rejects non-object rows before writing database statements', async () => {
    const db = new TransactionalRestoreDb(createStore('old'));
    const payload = createCompletePayload();
    payload.tables.customers = ['not-object'];

    await expect(restoreBackupPayloadWithDb(db, payload)).rejects.toThrow('Row in customers must be an object.');

    expect(db.statements).toEqual([]);
  });

  it('rejects empty object rows before writing database statements', async () => {
    const db = new TransactionalRestoreDb(createStore('old'));
    const payload = createCompletePayload();
    payload.tables.customers = [{}];

    await expect(restoreBackupPayloadWithDb(db, payload)).rejects.toThrow('Row in customers must not be empty.');

    expect(db.statements).toEqual([]);
  });

  it('rolls back and preserves previous data when an insert fails', async () => {
    const before = createStore('old');
    const db = new TransactionalRestoreDb(before);
    let hasFailed = false;
    db.failOnSql = (sql) => {
      if (!hasFailed && sql.startsWith('INSERT OR REPLACE INTO lead_work_items')) {
        hasFailed = true;
        return true;
      }
      return false;
    };

    await expect(restoreBackupPayloadWithDb(db, createCompletePayload())).rejects.toThrow('Restore failed and rolled back');

    expect(db.statements).toContain('ROLLBACK');
    expect(db.store).toEqual(before);
  });

  it('does not call internal getDb and leaves UI/protected files untouched', () => {
    const backupRestoreSrc = readFileSync(new URL('../../src/lib/backupRestore.ts', import.meta.url), 'utf8');
    const settingsSrc = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
    const dataImportPage = readFileSync(new URL('../../src/pages/DataImportPage.tsx', import.meta.url), 'utf8');
    const importer = readFileSync(new URL('../../src/lib/importer.ts', import.meta.url), 'utf8');

    expect(backupRestoreSrc).not.toContain('getDb(');
    expect(settingsSrc).toContain('const handleRestoreConfirm = async () => {');
    expect(settingsSrc).toContain('restoreBackupPayloadWithDb');
    expect(settingsSrc).not.toContain('INSERT OR REPLACE INTO customers');
    expect(dataImportPage.length).toBeGreaterThan(0);
    expect(importer.length).toBeGreaterThan(0);
  });
});
