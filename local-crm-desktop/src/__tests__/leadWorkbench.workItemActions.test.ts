import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { ensureLeadWorkbenchSchema, getLeadWorkItemById, insertLeadWorkItem } from '../lib/leadWorkbench/db';
import { updateLeadWorkItemStatus } from '../lib/leadWorkbench/workItemActions';
import type { LeadWorkItem, LeadWorkStatus } from '../lib/leadWorkbench/types';

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

async function createReadyDb() {
  const db = createSqliteDb();
  await ensureBaseSchema(db);
  await ensureLeadWorkbenchSchema(db);
  return db;
}

describe('lead workbench work item actions', () => {
  it('updates legal work item status transitions', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'start-1', status: 'TODO' }));
      await insertLeadWorkItem(db, createWorkItem({ id: 'no-phone-1', status: 'TODO' }));
      await insertLeadWorkItem(db, createWorkItem({ id: 'skip-1', status: 'STAGED' }));

      await expect(updateLeadWorkItemStatus(db, 'start-1', 'SEARCHING')).resolves.toMatchObject({
        id: 'start-1',
        status: 'SEARCHING',
      });
      await expect(updateLeadWorkItemStatus(db, 'no-phone-1', 'NO_PHONE')).resolves.toMatchObject({
        id: 'no-phone-1',
        status: 'NO_PHONE',
      });
      await expect(updateLeadWorkItemStatus(db, 'skip-1', 'SKIPPED')).resolves.toMatchObject({
        id: 'skip-1',
        status: 'SKIPPED',
      });
    } finally {
      db.close();
    }
  });

  it('rejects illegal work item status transitions', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'done-1', status: 'DONE' }));

      await expect(updateLeadWorkItemStatus(db, 'done-1', 'SEARCHING')).rejects.toThrow(
        'Invalid lead work status transition',
      );
      const item = await getLeadWorkItemById(db, 'done-1');
      expect(item?.status).toBe('DONE');
    } finally {
      db.close();
    }
  });

  it('only updates status and updated_at without writing other lead domains', async () => {
    const db = await createReadyDb();
    try {
      const original = createWorkItem({ id: 'safe-1', status: 'SEARCHING', updated_at: '2026-06-14T00:00:00.000Z' });
      await insertLeadWorkItem(db, original);

      const updated = await updateLeadWorkItemStatus(db, 'safe-1', 'NO_PHONE');

      expect(updated).toMatchObject({
        id: original.id,
        import_row_id: original.import_row_id,
        customer_id: original.customer_id,
        work_type: original.work_type,
        company_name: original.company_name,
        city: original.city,
        industry: original.industry,
        priority: original.priority,
        lookup_goal: original.lookup_goal,
        tanji_search_keyword: original.tanji_search_keyword,
        note: original.note,
        status: 'NO_PHONE',
      });
      expect(updated.updated_at).not.toBe(original.updated_at);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(1);
      expect(await db.select('SELECT * FROM collected_leads')).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

function createWorkItem(overrides: Partial<LeadWorkItem> = {}): LeadWorkItem {
  return {
    id: 'work-1',
    import_row_id: null,
    customer_id: null,
    work_type: 'NEW_CUSTOMER_LOOKUP',
    company_name: 'Lead Work Co',
    city: 'Foshan',
    industry: 'Lighting',
    priority: 80,
    lookup_goal: 'FIND_PHONE',
    tanji_search_keyword: 'Lead Work Co',
    status: 'TODO' as LeadWorkStatus,
    note: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}
