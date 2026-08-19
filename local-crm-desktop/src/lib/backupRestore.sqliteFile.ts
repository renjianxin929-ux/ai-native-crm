/**
 * Same-connection FULL restore for Node/file SQLite.
 * Used when DatabaseLike.execute cannot keep BEGIN/COMMIT affinity
 * (independent connections per call, matching plugin-sql pooling).
 * Production Tauri uses restore_full_backup_atomic (Rust/sqlx).
 */
import Database from 'better-sqlite3';
import {
  getRestoreDeleteOrder,
  getRestoreTableOrder,
  type BackupTablesPayload,
} from './backupRestore';

export function replaceDatabaseTablesOnSqliteFile(path: string, tables: BackupTablesPayload): void {
  const sqlite = new Database(path);
  try {
    sqlite.pragma('foreign_keys = ON');
    const restore = sqlite.transaction(() => {
      sqlite.exec('PRAGMA defer_foreign_keys = ON');
      for (const table of getRestoreDeleteOrder()) {
        sqlite.prepare(`DELETE FROM ${table}`).run();
      }
      for (const table of getRestoreTableOrder()) {
        for (const row of tables[table]) {
          const columns = Object.keys(row);
          const placeholders = columns.map(() => '?').join(', ');
          sqlite.prepare(
            `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          ).run(...Object.values(row));
        }
      }
    });
    restore();
  } finally {
    sqlite.close();
  }
}
