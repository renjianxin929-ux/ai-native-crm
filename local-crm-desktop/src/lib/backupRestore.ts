import type { DatabaseLike } from './db';
import { invokeTauriAtomicCommand, isTauriRuntime } from './runtime/tauriRuntime';

export const BACKUP_TABLES = [
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

export type BackupTableName = typeof BACKUP_TABLES[number];
export type BackupTablesPayload = Record<BackupTableName, Record<string, unknown>[]>;

export type FullBackupPayload = {
  version: string;
  exported_at: string;
  counts: Record<BackupTableName, number>;
  tables: BackupTablesPayload;
  customers: Record<string, unknown>[];
  followUps: Record<string, unknown>[];
  visits: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
};

export type NormalizedBackupPayload = {
  version: string;
  exported_at: string | null;
  isLegacy: boolean;
  missingTables: BackupTableName[];
  tables: BackupTablesPayload;
  invalidTables: BackupTableName[];
  isObject: boolean;
};

export type BackupValidationResult = {
  valid: boolean;
  errors: string[];
  missingTables: BackupTableName[];
};

export type RestoreBackupResult = {
  ok: true;
  isLegacy: boolean;
  restoredCounts: Record<BackupTableName, number>;
  warnings: string[];
};

export async function buildFullBackupPayload(
  db: Pick<DatabaseLike, 'select'>,
  options: {
    version: string;
    exportedAt?: string;
  },
): Promise<FullBackupPayload> {
  const tables = {} as BackupTablesPayload;

  for (const table of BACKUP_TABLES) {
    tables[table] = await db.select<Record<string, unknown>>(`SELECT * FROM ${table}`);
    if (table === 'settings') tables.settings = tables.settings.filter(isSafeSettingRow);
  }

  const counts = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, tables[table].length]),
  ) as Record<BackupTableName, number>;

  return {
    version: options.version,
    exported_at: options.exportedAt ?? new Date().toISOString(),
    counts,
    tables,
    customers: tables.customers,
    followUps: tables.follow_up_records,
    visits: tables.visit_records,
    tasks: tables.tasks,
  };
}

export function normalizeBackupPayload(raw: unknown): NormalizedBackupPayload {
  const emptyTables = createEmptyBackupTables();
  if (!isRecord(raw)) {
    return {
      version: 'LEGACY_BACKUP',
      exported_at: null,
      isLegacy: false,
      missingTables: [...BACKUP_TABLES],
      tables: emptyTables,
      invalidTables: [],
      isObject: false,
    };
  }

  const rawTables = isRecord(raw.tables) ? raw.tables : null;
  const hasNewTables = rawTables !== null;
  const isLegacy = !hasNewTables;
  const missingTables: BackupTableName[] = [];
  const invalidTables: BackupTableName[] = [];
  const tables = createEmptyBackupTables();

  for (const table of BACKUP_TABLES) {
    const sourceValue = rawTables
      ? rawTables[table]
      : getLegacyTableValue(raw, table);

    if (sourceValue === undefined) {
      missingTables.push(table);
      tables[table] = [];
      continue;
    }

    if (!Array.isArray(sourceValue)) {
      invalidTables.push(table);
      tables[table] = [];
      continue;
    }

    tables[table] = table === 'settings'
      ? (sourceValue as Record<string, unknown>[]).filter(isSafeSettingRow)
      : sourceValue as Record<string, unknown>[];
  }

  return {
    version: typeof raw.version === 'string' ? raw.version : 'LEGACY_BACKUP',
    exported_at: typeof raw.exported_at === 'string' ? raw.exported_at : null,
    isLegacy,
    missingTables,
    tables,
    invalidTables,
    isObject: true,
  };
}

export function validateBackupPayload(normalized: NormalizedBackupPayload): BackupValidationResult {
  const errors: string[] = [];

  if (!normalized.isObject) {
    errors.push('Backup payload must be an object.');
  }

  for (const table of normalized.invalidTables) {
    errors.push(`Backup table ${table} must be an array.`);
  }

  if (normalized.isObject && !normalized.isLegacy) {
    for (const table of normalized.missingTables) {
      errors.push(`Backup table ${table} is missing.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingTables: normalized.missingTables,
  };
}

export function getRestoreTableOrder(): BackupTableName[] {
  return [
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
  ];
}

export function getRestoreDeleteOrder(): BackupTableName[] {
  return [...getRestoreTableOrder()].reverse();
}

export async function restoreBackupPayloadWithDb(
  db: Pick<DatabaseLike, 'execute' | 'select'>,
  rawPayload: unknown,
): Promise<RestoreBackupResult> {
  const normalized = normalizeBackupPayload(rawPayload);
  const validation = validateBackupPayload(normalized);
  if (!validation.valid) {
    throw new Error(`Invalid backup payload: ${validation.errors.join(' ')}`);
  }

  validateRestoreRows(normalized.tables);

  const restoredCounts = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, normalized.tables[table].length]),
  ) as Record<BackupTableName, number>;
  const warnings = normalized.isLegacy
    ? normalized.missingTables.map((table) => `Legacy backup missing table ${table}; restored as empty array.`)
    : [];
  const rollbackSnapshot = await buildFullBackupPayload(db, {
    version: 'PRE_RESTORE_ROLLBACK',
  });

  try {
    if (isTauriRuntime()) {
      await invokeTauriAtomicCommand('restore_full_backup_atomic', { payload: normalized.tables });
    } else {
      await applyRestoredTables(db, normalized.tables);
    }
    const actualCounts = await getDatabaseTableCounts(db);
    for (const table of BACKUP_TABLES) {
      if (actualCounts[table] !== restoredCounts[table]) {
        throw new Error(
          `Restore count mismatch for ${table}: expected ${restoredCounts[table]}, got ${actualCounts[table]}`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTauriRuntime()) {
      throw new Error(`Restore failed: ${message}`, { cause: error });
    }
    let rollbackError: unknown = null;
    try {
      await applyRestoredTables(db, rollbackSnapshot.tables);
    } catch (restoreError) {
      rollbackError = restoreError;
    }
    const rollbackSuffix = rollbackError
      ? `; rollback snapshot restore failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
      : '';
    throw new Error(`Restore failed and rolled back: ${message}${rollbackSuffix}`, { cause: error });
  }

  return {
    ok: true,
    isLegacy: normalized.isLegacy,
    restoredCounts,
    warnings,
  };
}

function sqliteFilePathOf(db: object): string | undefined {
  if (!('path' in db)) return undefined;
  const path = (db as { path?: unknown }).path;
  return typeof path === 'string' && path.length > 0 ? path : undefined;
}

async function applyRestoredTables(
  db: Pick<DatabaseLike, 'execute'>,
  tables: BackupTablesPayload,
): Promise<void> {
  const sqlitePath = sqliteFilePathOf(db);
  if (sqlitePath) {
    const { replaceDatabaseTablesOnSqliteFile } = await import('./backupRestore.sqliteFile');
    replaceDatabaseTablesOnSqliteFile(sqlitePath, tables);
    return;
  }
  await replaceDatabaseTables(db, tables);
}

async function replaceDatabaseTables(
  db: Pick<DatabaseLike, 'execute'>,
  tables: BackupTablesPayload,
): Promise<void> {
  await db.execute('BEGIN IMMEDIATE');
  try {
    await db.execute('PRAGMA defer_foreign_keys = ON');
    for (const table of getRestoreDeleteOrder()) {
      await db.execute(`DELETE FROM ${table}`);
    }
    for (const table of getRestoreTableOrder()) {
      for (const row of tables[table]) {
        await db.execute(buildInsertSql(table, row), Object.values(row));
      }
    }
    await db.execute('COMMIT');
  } catch (error) {
    try { await db.execute('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
}

async function getDatabaseTableCounts(
  db: Pick<DatabaseLike, 'select'>,
): Promise<Record<BackupTableName, number>> {
  const entries: Array<[BackupTableName, number]> = [];
  for (const table of BACKUP_TABLES) {
    const rows = await db.select<{ count: number | string }>(`SELECT COUNT(*) as count FROM ${table}`);
    entries.push([table, Number(rows[0]?.count ?? 0)]);
  }
  return Object.fromEntries(entries) as Record<BackupTableName, number>;
}

function createEmptyBackupTables(): BackupTablesPayload {
  return Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, []]),
  ) as unknown as BackupTablesPayload;
}

function getLegacyTableValue(raw: Record<string, unknown>, table: BackupTableName): unknown {
  switch (table) {
    case 'follow_up_records':
      return raw.followUps;
    case 'visit_records':
      return raw.visits;
    default:
      return raw[table];
  }
}

function validateRestoreRows(tables: BackupTablesPayload): void {
  for (const table of BACKUP_TABLES) {
    for (const row of tables[table]) {
      if (!isRecord(row)) {
        throw new Error(`Row in ${table} must be an object.`);
      }
      if (Object.keys(row).length === 0) {
        throw new Error(`Row in ${table} must not be empty.`);
      }
      for (const column of Object.keys(row)) {
        if (!isSafeSqlIdentifier(column)) {
          throw new Error(`Column ${column} in ${table} is not a safe SQL identifier.`);
        }
      }
    }
  }
}

function buildInsertSql(table: BackupTableName, row: Record<string, unknown>): string {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  return `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
}

function isSafeSqlIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeSettingRow(row: Record<string, unknown>): boolean {
  const key = typeof row.key === 'string' ? row.key.toLowerCase() : '';
  if (['ai_config', 'text_ai_config', 'multimodal_config'].includes(key)) return false;
  const raw = typeof row.value === 'string' ? row.value.toLowerCase() : '';
  return !/(?:api[_-]?key|authorization|provider[_-]?key|\"token\"|\"secret\")/.test(raw);
}
