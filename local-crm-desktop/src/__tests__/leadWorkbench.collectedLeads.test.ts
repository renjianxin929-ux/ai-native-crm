import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { insertCollectedLeadDraft, listCollectedLeadsByWorkItemId } from '../lib/leadWorkbench/collectedLeads';
import { ensureLeadWorkbenchSchema, insertLeadWorkItem } from '../lib/leadWorkbench/db';
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

describe('lead workbench collected lead drafts', () => {
  it('inserts a collected lead draft with UNSYNCED sync status', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({
        id: 'work-1',
        import_row_id: null,
        customer_id: null,
        company_name: 'Draft Co',
      }));

      const draft = await insertCollectedLeadDraft(db, {
        work_item_id: 'work-1',
        import_row_id: null,
        customer_id: null,
        company_name: 'Draft Co',
        contact_name: '张总',
        position: '负责人',
        mobile: '13800138000',
        tel: '0757-88889999',
        website: 'https://example.com',
        email: 'sales@example.com',
        raw_text: '手机 13800138000',
        note: '人工确认',
      });
      const drafts = await listCollectedLeadsByWorkItemId(db, 'work-1');

      expect(draft).toMatchObject({
        work_item_id: 'work-1',
        import_row_id: null,
        customer_id: null,
        company_name: 'Draft Co',
        contact_name: '张总',
        sync_status: 'UNSYNCED',
      });
      expect(drafts.map(item => item.id)).toEqual([draft.id]);
    } finally {
      db.close();
    }
  });

  it('rejects missing work_item_id, company_name, raw_text, and empty useful fields', async () => {
    const db = await createReadyDb();
    try {
      const base = createDraftInput();

      await expect(insertCollectedLeadDraft(db, { ...base, work_item_id: '' })).rejects.toThrow('work_item_id is required');
      await expect(insertCollectedLeadDraft(db, { ...base, company_name: '' })).rejects.toThrow('company_name is required');
      await expect(insertCollectedLeadDraft(db, { ...base, raw_text: '' })).rejects.toThrow('raw_text is required');
      await expect(insertCollectedLeadDraft(db, {
        ...base,
        contact_name: '',
        mobile: '',
        tel: '',
        website: '',
        email: '',
        note: '',
      })).rejects.toThrow('At least one collected lead field is required');
    } finally {
      db.close();
    }
  });

  it('rejects duplicate mobile within the same work item', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-1' }));
      await insertCollectedLeadDraft(db, createDraftInput({ work_item_id: 'work-1', mobile: '13800138000' }));

      await expect(insertCollectedLeadDraft(db, createDraftInput({
        work_item_id: 'work-1',
        mobile: '13800138000',
        email: 'other@example.com',
      }))).rejects.toThrow('Duplicate collected lead mobile for this work item');
    } finally {
      db.close();
    }
  });

  it('rejects duplicate tel within the same work item when mobile is empty', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-1' }));
      await insertCollectedLeadDraft(db, createDraftInput({ work_item_id: 'work-1', mobile: '', tel: '0757-88889999' }));

      await expect(insertCollectedLeadDraft(db, createDraftInput({
        work_item_id: 'work-1',
        mobile: '',
        tel: '0757-88889999',
        note: 'duplicate tel',
      }))).rejects.toThrow('Duplicate collected lead tel for this work item');
    } finally {
      db.close();
    }
  });

  it('does not write customers, create lead work items, or write lead sync logs', async () => {
    const db = await createReadyDb();
    try {
      const original = createWorkItem({ id: 'safe-1', status: 'SEARCHING' });
      await insertLeadWorkItem(db, original);

      await insertCollectedLeadDraft(db, createDraftInput({ work_item_id: 'safe-1' }));
      const workItems = await db.select<LeadWorkItem>('SELECT * FROM lead_work_items');

      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect(workItems).toHaveLength(1);
      expect(workItems[0]).toMatchObject(original);
    } finally {
      db.close();
    }
  });
});

function createDraftInput(overrides: Record<string, string | null> = {}) {
  return {
    work_item_id: 'work-1',
    import_row_id: null,
    customer_id: null,
    company_name: 'Draft Co',
    contact_name: '张总',
    position: '',
    mobile: '13800138000',
    tel: '',
    website: '',
    email: '',
    raw_text: '手机 13800138000',
    note: '人工确认',
    ...overrides,
  };
}

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
