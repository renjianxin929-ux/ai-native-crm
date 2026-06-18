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

  it('returns the existing draft for duplicate mobile within the same work item', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-1' }));
      const first = await insertCollectedLeadDraft(
        db,
        createDraftInput({ work_item_id: 'work-1', mobile: '13800138000' }),
      );

      const duplicate = await insertCollectedLeadDraft(db, createDraftInput({
        work_item_id: 'work-1',
        mobile: '13800138000',
        email: 'other@example.com',
      }));
      expect(duplicate).toMatchObject({ id: first.id, existing: true });
      expect(await db.select('SELECT * FROM collected_leads')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('returns the existing draft for duplicate tel within the same work item when mobile is empty', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-1' }));
      const first = await insertCollectedLeadDraft(
        db,
        createDraftInput({ work_item_id: 'work-1', mobile: '', tel: '0757-88889999' }),
      );

      const duplicate = await insertCollectedLeadDraft(db, createDraftInput({
        work_item_id: 'work-1',
        mobile: '',
        tel: '0757-88889999',
        note: 'duplicate tel',
      }));
      expect(duplicate).toMatchObject({ id: first.id, existing: true });
      expect(await db.select('SELECT * FROM collected_leads')).toHaveLength(1);
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

  it('lists drafts by work_item_id in created_at descending order without side effects', async () => {
    const db = await createReadyDb();
    try {
      const firstWorkItem = createWorkItem({ id: 'work-a', status: 'STAGED' });
      const secondWorkItem = createWorkItem({ id: 'work-b', status: 'TODO' });
      await insertLeadWorkItem(db, firstWorkItem);
      await insertLeadWorkItem(db, secondWorkItem);
      await insertStoredDraft(db, {
        id: 'older',
        work_item_id: 'work-a',
        contact_name: 'Older Contact',
        created_at: '2026-06-14T01:00:00.000Z',
      });
      await insertStoredDraft(db, {
        id: 'other-work',
        work_item_id: 'work-b',
        contact_name: 'Other Work Contact',
        created_at: '2026-06-14T03:00:00.000Z',
      });
      await insertStoredDraft(db, {
        id: 'newer',
        work_item_id: 'work-a',
        contact_name: 'Newer Contact',
        created_at: '2026-06-14T04:00:00.000Z',
      });

      const drafts = await listCollectedLeadsByWorkItemId(db, 'work-a');
      const workItems = await db.select<LeadWorkItem>('SELECT * FROM lead_work_items ORDER BY id ASC');

      expect(drafts.map(draft => draft.id)).toEqual(['newer', 'older']);
      expect(drafts.every(draft => draft.work_item_id === 'work-a')).toBe(true);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect(workItems).toHaveLength(2);
      expect(workItems[0]).toMatchObject(firstWorkItem);
      expect(workItems[1]).toMatchObject(secondWorkItem);
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

async function insertStoredDraft(
  db: DatabaseLike,
  overrides: Record<string, string | null>,
) {
  const draft = {
    id: 'draft-1',
    work_item_id: 'work-1',
    import_row_id: null,
    customer_id: null,
    company_name: 'Draft Co',
    contact_name: 'Draft Contact',
    position: null,
    mobile: null,
    tel: null,
    website: null,
    email: null,
    raw_text: 'raw text',
    note: 'note text',
    sync_status: 'UNSYNCED',
    created_customer_id: null,
    updated_customer_id: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };

  await db.execute(
    `INSERT INTO collected_leads (
      id, work_item_id, import_row_id, customer_id, company_name, contact_name,
      position, mobile, tel, website, email, raw_text, note, sync_status,
      created_customer_id, updated_customer_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id,
      draft.work_item_id,
      draft.import_row_id,
      draft.customer_id,
      draft.company_name,
      draft.contact_name,
      draft.position,
      draft.mobile,
      draft.tel,
      draft.website,
      draft.email,
      draft.raw_text,
      draft.note,
      draft.sync_status,
      draft.created_customer_id,
      draft.updated_customer_id,
      draft.created_at,
      draft.updated_at,
    ],
  );
}
