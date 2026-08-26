import Database from 'better-sqlite3';

import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import {
  prepareProfileFilesystem,
  resolveProfilePaths,
  verifyOpenedProfileDatabase,
} from './profile';

export interface ProfileHandle {
  readonly profile: string;
  readonly rootDir: string;
  readonly dbPath: string;
  readonly db: DatabaseLike;
  close(): void;
}

/**
 * Opens the explicitly requested profile database. This never calls db.ts's
 * default connection, so the desktop production SQLite singleton is excluded.
 */
export async function openProfileDatabase(profileName: string): Promise<ProfileHandle> {
  const preparedPaths = prepareProfileFilesystem(resolveProfilePaths(profileName));
  const sqlite = new Database(preparedPaths.dbPath);

  try {
    const verifiedPaths = verifyOpenedProfileDatabase(preparedPaths);
    sqlite.pragma('foreign_keys = ON');

    const db: DatabaseLike = {
      async execute(sql: string, bindings: unknown[] = []) {
        const result = sqlite.prepare(sql).run(bindings as never[]);
        return { rowsAffected: Number(result.changes) };
      },
      async select<T>(sql: string, bindings: unknown[] = []) {
        return sqlite.prepare(sql).all(bindings as never[]) as T[];
      },
    };

    await initializeDatabaseSchema(db);
    sqlite.pragma('foreign_keys = ON');

    let closed = false;
    return {
      profile: verifiedPaths.profile,
      rootDir: verifiedPaths.rootDir,
      dbPath: verifiedPaths.dbPath,
      db,
      close() {
        if (closed) return;
        closed = true;
        sqlite.close();
      },
    };
  } catch (error) {
    try {
      sqlite.close();
    } catch {
      // A failed open must preserve the original initialization error.
    }
    throw error;
  }
}
