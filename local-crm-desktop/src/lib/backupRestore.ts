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
