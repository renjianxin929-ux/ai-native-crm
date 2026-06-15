import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  getLeadWorkItemById,
  getLeadWorkItemStatusCounts,
  insertLeadWorkItem,
  listLeadWorkItems,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { updateLeadWorkItemStatus } from '../lib/leadWorkbench/workItemActions';
import type { LeadWorkItem, LeadWorkStatus } from '../lib/leadWorkbench/types';
import {
  copyLeadSearchKeyword,
  filterLeadWorkItemsByStatus,
  getLeadWorkItemStatusActions,
  getSuggestedTanjiSearchKeyword,
  LEAD_WORKBENCH_ACTION_LABELS,
  LEAD_WORKBENCH_STATUS_FILTERS,
} from '../pages/LeadWorkbenchPage';

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

describe('lead workbench page operations', () => {
  it('lists lead work items without creating customers or extra work items', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'todo-1', company_name: 'Todo Co' }));
      await insertLeadWorkItem(db, createWorkItem({ id: 'done-1', company_name: 'Done Co', status: 'DONE' }));

      const items = await listLeadWorkItems(db);

      expect(items.map(item => item.company_name)).toEqual(['Todo Co', 'Done Co']);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('defaults to TODO and can filter by status', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'todo-1', status: 'TODO' }));
      await insertLeadWorkItem(db, createWorkItem({ id: 'searching-1', status: 'SEARCHING' }));

      const todoItems = await listLeadWorkItemsByStatus(db, 'TODO');
      const searchingItems = await listLeadWorkItemsByStatus(db, 'SEARCHING');
      const allItems = await listLeadWorkItems(db);

      expect(LEAD_WORKBENCH_STATUS_FILTERS[0]).toBe('TODO');
      expect(todoItems).toHaveLength(1);
      expect(todoItems[0].id).toBe('todo-1');
      expect(searchingItems).toHaveLength(1);
      expect(searchingItems[0].id).toBe('searching-1');
      expect(filterLeadWorkItemsByStatus(allItems, 'TODO').map(item => item.id)).toEqual(['todo-1']);
    } finally {
      db.close();
    }
  });

  it('computes status counts for the queue', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'todo-1', status: 'TODO' }));
      await insertLeadWorkItem(db, createWorkItem({ id: 'todo-2', status: 'TODO' }));
      await insertLeadWorkItem(db, createWorkItem({ id: 'done-1', status: 'DONE' }));

      const counts = await getLeadWorkItemStatusCounts(db);

      expect(counts).toEqual({
        TODO: 2,
        SEARCHING: 0,
        STAGED: 0,
        COLLECTED: 0,
        NO_PHONE: 0,
        SKIPPED: 0,
        DONE: 1,
      });
    } finally {
      db.close();
    }
  });

  it('shows task detail data and suggested search keyword fallback', () => {
    const item = createWorkItem({
      id: 'detail-1',
      import_row_id: 'row-1',
      customer_id: 'customer-1',
      company_name: 'Detail Co',
      city: 'Foshan',
      industry: 'Manufacturing',
      work_type: 'CRM_CUSTOMER_ENRICHMENT',
      lookup_goal: 'FIND_PHONE',
      tanji_search_keyword: null,
      status: 'TODO',
      note: 'readonly detail',
    });

    expect(item).toMatchObject({
      id: 'detail-1',
      import_row_id: 'row-1',
      customer_id: 'customer-1',
      company_name: 'Detail Co',
      city: 'Foshan',
      industry: 'Manufacturing',
      work_type: 'CRM_CUSTOMER_ENRICHMENT',
      lookup_goal: 'FIND_PHONE',
      status: 'TODO',
      note: 'readonly detail',
    });
    expect(getSuggestedTanjiSearchKeyword(item)).toBe('Detail Co');
  });

  it('exposes copy search keyword action and uses navigator.clipboard.writeText', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const item = createWorkItem({ tanji_search_keyword: 'Tanji Keyword' });

    const result = await copyLeadSearchKeyword(item, clipboard);

    expect(LEAD_WORKBENCH_ACTION_LABELS).toContain('复制搜索词');
    expect(clipboard.writeText).toHaveBeenCalledWith('Tanji Keyword');
    expect(result).toEqual({ ok: true, message: '已复制搜索词' });
  });

  it('keeps manual search text visible when clipboard is unavailable or fails', async () => {
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error('denied')) };
    const item = createWorkItem({ company_name: 'Fallback Co', tanji_search_keyword: null });

    await expect(copyLeadSearchKeyword(item, clipboard)).resolves.toEqual({
      ok: false,
      message: '复制失败，请手动复制',
    });
    expect(getSuggestedTanjiSearchKeyword(item)).toBe('Fallback Co');
  });

  it('offers only minimal legal status actions for non-terminal tasks', () => {
    expect(getLeadWorkItemStatusActions('TODO').map(action => action.nextStatus)).toEqual([
      'SEARCHING',
      'NO_PHONE',
      'SKIPPED',
    ]);
    expect(getLeadWorkItemStatusActions('SEARCHING').map(action => action.nextStatus)).toEqual([
      'NO_PHONE',
      'SKIPPED',
    ]);
    expect(getLeadWorkItemStatusActions('STAGED').map(action => action.nextStatus)).toEqual(['SKIPPED']);
    expect(getLeadWorkItemStatusActions('NO_PHONE')).toEqual([]);
    expect(getLeadWorkItemStatusActions('SKIPPED')).toEqual([]);
    expect(getLeadWorkItemStatusActions('DONE')).toEqual([]);
  });

  it('updates status and refreshes list, counts, and detail data through the shared action', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'todo-1', status: 'TODO' }));

      const updated = await updateLeadWorkItemStatus(db, 'todo-1', 'SEARCHING');
      const todoItems = await listLeadWorkItemsByStatus(db, 'TODO');
      const searchingItems = await listLeadWorkItemsByStatus(db, 'SEARCHING');
      const counts = await getLeadWorkItemStatusCounts(db);
      const detail = await getLeadWorkItemById(db, 'todo-1');

      expect(updated.status).toBe('SEARCHING');
      expect(todoItems).toHaveLength(0);
      expect(searchingItems.map(item => item.id)).toEqual(['todo-1']);
      expect(counts.TODO).toBe(0);
      expect(counts.SEARCHING).toBe(1);
      expect(detail?.status).toBe('SEARCHING');
    } finally {
      db.close();
    }
  });

  it('rejects illegal status transitions with a readable error', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'done-1', status: 'DONE' }));

      await expect(updateLeadWorkItemStatus(db, 'done-1', 'SEARCHING')).rejects.toThrow(
        'Invalid lead work status transition',
      );
    } finally {
      db.close();
    }
  });

  it('does not expose customer, work-item creation, collected lead, paste, listener, or automation logic', () => {
    const pageSource = readFileSync(resolve(__dirname, '../pages/LeadWorkbenchPage.tsx'), 'utf8');

    expect(pageSource).toContain('navigator.clipboard.writeText');
    expect(pageSource).not.toContain('insertCustomerWithDb');
    expect(pageSource).not.toContain('createCustomer');
    expect(pageSource).not.toContain('insertLeadWorkItem');
    expect(pageSource).not.toContain('collected_leads');
    expect(pageSource).not.toContain('importLeadRowsToBatch');
    expect(pageSource).not.toContain('executeLeadImportBatchDecisions');
    expect(pageSource).not.toContain('addEventListener');
    expect(pageSource).not.toContain('readText');
    expect(pageSource).not.toContain('DataImportPage');
    expect(pageSource).not.toContain('../lib/importer');
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
