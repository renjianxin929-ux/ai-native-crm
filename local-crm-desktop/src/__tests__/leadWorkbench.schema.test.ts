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

  it('adds nullable capture_event_id to an existing collected_leads table without losing rows', async () => {
    const db = createSqliteDb();
    try {
      await db.execute(`
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
        )
      `);
      await db.execute(
        `INSERT INTO collected_leads (
          id, work_item_id, company_name, mobile, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        ['legacy-draft', 'legacy-work', 'Legacy Co', '13800138000', '2026-06-18T00:00:00.000Z', '2026-06-18T00:00:00.000Z'],
      );

      await ensureLeadWorkbenchSchema(db);

      const columns = await db.select<{ name: string }>('PRAGMA table_info(collected_leads)');
      const rows = await db.select<{ id: string; capture_event_id: string | null }>(
        'SELECT id, capture_event_id FROM collected_leads',
      );
      expect(columns.map(column => column.name)).toContain('capture_event_id');
      expect(rows).toEqual([{ id: 'legacy-draft', capture_event_id: null }]);
    } finally {
      db.close();
    }
  });
});
