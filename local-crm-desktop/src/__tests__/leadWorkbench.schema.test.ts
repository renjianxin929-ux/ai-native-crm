import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { ensureLeadWorkbenchSchema } from '../lib/leadWorkbench/db';

function createSqliteDb(): DatabaseLike & { close(): void } {
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

describe('lead workbench schema', () => {
  const leadTables = [
    'lead_import_batches',
    'lead_import_rows',
    'lead_work_items',
    'lead_capture_events',
    'collected_leads',
    'lead_sync_logs',
  ];

  it('creates the six lead workbench tables', async () => {
    const db = createSqliteDb();
    try {
      await ensureLeadWorkbenchSchema(db);

      const rows = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'lead_%' OR name = 'collected_leads'",
      );
      const tableNames = rows.map(row => row.name);

      for (const table of leadTables) {
        expect(tableNames).toContain(table);
      }
    } finally {
      db.close();
    }
  });

  it('can initialize repeatedly without throwing', async () => {
    const db = createSqliteDb();
    try {
      await expect(ensureLeadWorkbenchSchema(db)).resolves.toBeUndefined();
      await expect(ensureLeadWorkbenchSchema(db)).resolves.toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('does not change existing customers data', async () => {
    const db = createSqliteDb();
    try {
      await ensureBaseSchema(db);
      await db.execute(
        'INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        ['customer-1', 'Existing Customer', '2026-06-11T00:00:00.000Z', '2026-06-11T00:00:00.000Z'],
      );

      await ensureLeadWorkbenchSchema(db);

      const customers = await db.select<{ id: string; name: string }>('SELECT id, name FROM customers');
      expect(customers).toEqual([{ id: 'customer-1', name: 'Existing Customer' }]);
    } finally {
      db.close();
    }
  });
});
