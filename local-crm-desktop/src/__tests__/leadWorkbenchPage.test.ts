import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  getLeadWorkItemStatusCounts,
  insertLeadWorkItem,
  listLeadWorkItems,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import type { LeadWorkItem, LeadWorkStatus } from '../lib/leadWorkbench/types';
import {
  filterLeadWorkItemsByStatus,
  getSuggestedTanjiSearchKeyword,
  LEAD_WORKBENCH_FORBIDDEN_ACTION_LABELS,
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

describe('lead workbench read-only page', () => {
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

  it('does not expose write, paste, clipboard, automation, or collected lead actions', () => {
    const pageSource = readFileSync(resolve(__dirname, '../pages/LeadWorkbenchPage.tsx'), 'utf8');

    expect(LEAD_WORKBENCH_FORBIDDEN_ACTION_LABELS).toEqual([
      '复制搜索词',
      '标记无电话',
      '跳过',
      '完成',
      '粘贴解析',
    ]);
    for (const label of LEAD_WORKBENCH_FORBIDDEN_ACTION_LABELS) {
      expect(pageSource).not.toContain(label);
    }
    expect(pageSource).not.toContain('insertCustomerWithDb');
    expect(pageSource).not.toContain('insertLeadWorkItem');
    expect(pageSource).not.toContain('updateLeadImportRowDecisionStatus');
    expect(pageSource).not.toContain('collected_leads');
    expect(pageSource).not.toContain('navigator.clipboard');
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
