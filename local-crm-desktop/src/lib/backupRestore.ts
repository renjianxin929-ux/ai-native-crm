import type { DatabaseLike } from './db';

export const BACKUP_TABLES = [
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

    tables[table] = sourceValue as Record<string, unknown>[];
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
    'follow_up_records',
    'visit_records',
    'tasks',
    'ai_drafts',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
