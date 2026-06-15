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
  getLeadWorkbenchDetailEmptyMessage,
  getLeadWorkbenchListEmptyMessage,
  getLeadWorkItemStatusActions,
  getLeadWorkItemStatusUpdateSuccessMessage,
  getLeadWorkItemTerminalMessage,
  getStatusActionConfirmationMessage,
  getSuggestedTanjiSearchKeyword,
  isLeadWorkItemTerminalStatus,
  LEAD_WORKBENCH_ACTION_LABELS,
  LEAD_WORKBENCH_STATUS_FILTERS,
  shouldRunLeadWorkItemStatusUpdate,
  sortLeadWorkItemsForDisplay,
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

  it('shows distinct empty states for no work items and an empty filtered status', () => {
    expect(getLeadWorkbenchListEmptyMessage(0, 'TODO')).toBe('暂无获客任务，请先在导入分流中心执行分流。');
    expect(getLeadWorkbenchListEmptyMessage(3, 'DONE')).toBe('当前状态下暂无任务。');
  });

  it('shows an empty detail state until a task is selected', () => {
    expect(getLeadWorkbenchDetailEmptyMessage()).toBe('请选择左侧任务查看详情。');
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

  it('sorts visible tasks by priority descending and then created_at ascending', () => {
    const highNewer = createWorkItem({ id: 'high-newer', priority: 90, created_at: '2026-06-14T02:00:00.000Z' });
    const highOlder = createWorkItem({ id: 'high-older', priority: 90, created_at: '2026-06-14T01:00:00.000Z' });
    const lowOlder = createWorkItem({ id: 'low-older', priority: 10, created_at: '2026-06-14T00:00:00.000Z' });

    expect(sortLeadWorkItemsForDisplay([lowOlder, highNewer, highOlder]).map(item => item.id)).toEqual([
      'high-older',
      'high-newer',
      'low-older',
    ]);
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

  it('falls back to company_name when tanji_search_keyword is empty and exposes the fallback hint', () => {
    const item = createWorkItem({ company_name: 'Fallback Co', tanji_search_keyword: '' });

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

  it('requires confirmation before marking no phone or skipping, and includes the company name', () => {
    const item = createWorkItem({ company_name: 'Confirm Co' });

    expect(getStatusActionConfirmationMessage(item, 'SEARCHING')).toBeNull();
    expect(getStatusActionConfirmationMessage(item, 'NO_PHONE')).toContain('Confirm Co');
    expect(getStatusActionConfirmationMessage(item, 'SKIPPED')).toContain('Confirm Co');
  });

  it('does not run status update when the user cancels confirmation', () => {
    const item = createWorkItem({ company_name: 'Cancel Co' });
    const confirm = vi.fn().mockReturnValue(false);

    expect(shouldRunLeadWorkItemStatusUpdate(item, 'NO_PHONE', confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Cancel Co'));
  });

  it('runs status update only after confirmation for destructive status actions', () => {
    const item = createWorkItem({ company_name: 'Confirm Co' });
    const confirm = vi.fn().mockReturnValue(true);

    expect(shouldRunLeadWorkItemStatusUpdate(item, 'SKIPPED', confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Confirm Co'));
  });

  it('does not require confirmation for start searching', () => {
    const item = createWorkItem({ company_name: 'Start Co' });
    const confirm = vi.fn();

    expect(shouldRunLeadWorkItemStatusUpdate(item, 'SEARCHING', confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows terminal state guidance and prevents terminal tasks from exposing actions', () => {
    expect(isLeadWorkItemTerminalStatus('NO_PHONE')).toBe(true);
    expect(isLeadWorkItemTerminalStatus('SKIPPED')).toBe(true);
    expect(isLeadWorkItemTerminalStatus('DONE')).toBe(true);
    expect(getLeadWorkItemTerminalMessage('NO_PHONE')).toBe('该任务已标记为无电话，不能继续流转。');
    expect(getLeadWorkItemTerminalMessage('SKIPPED')).toBe('该任务已跳过，不能继续流转。');
    expect(getLeadWorkItemTerminalMessage('DONE')).toBe('该任务已完成，不能继续流转。');
    expect(getLeadWorkItemStatusActions('NO_PHONE')).toEqual([]);
    expect(getLeadWorkItemStatusActions('SKIPPED')).toEqual([]);
    expect(getLeadWorkItemStatusActions('DONE')).toEqual([]);
  });

  it('shows a readable success message after status updates', () => {
    expect(getLeadWorkItemStatusUpdateSuccessMessage('NO_PHONE')).toBe('任务状态已更新为 NO_PHONE');
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
    expect(pageSource).toContain('window.confirm');
    expect(pageSource).toContain('刷新任务');
    expect(pageSource).toContain('disabled={isLoading || isUpdating}');
    expect(pageSource).not.toContain('insertCustomerWithDb');
    expect(pageSource).not.toContain('createCustomer');
    expect(pageSource).not.toContain('insertLeadWorkItem');
    expect(pageSource).not.toContain('INSERT INTO lead_work_items');
    expect(pageSource).not.toContain('collected_leads');
    expect(pageSource).not.toContain('importLeadRowsToBatch');
    expect(pageSource).not.toContain('executeLeadImportBatchDecisions');
    expect(pageSource).not.toContain('addEventListener');
    expect(pageSource).not.toContain('readText');
    expect(pageSource).not.toContain('DataImportPage');
    expect(pageSource).not.toContain('../lib/importer');
  });

  it('does not modify importer or data import page from lead workbench code', () => {
    const pageSource = readFileSync(resolve(__dirname, '../pages/LeadWorkbenchPage.tsx'), 'utf8');

    expect(pageSource).not.toContain('DataImportPage');
    expect(pageSource).not.toContain('src/lib/importer');
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
