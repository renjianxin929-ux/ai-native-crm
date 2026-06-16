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
import type { LeadCaptureEvent } from '../lib/leadWorkbench/captureEvents';
import type { CollectedLead } from '../lib/leadWorkbench/collectedLeads';
import {
  buildCollectedLeadDraftForm,
  buildLeadPastePreviewResult,
  copyLeadSearchKeyword,
  filterLeadWorkItemsByStatus,
  getCollectedLeadDraftDisplayValue,
  getCollectedLeadDraftHistoryEmptyMessage,
  getCollectedLeadDraftNoteSummary,
  getCollectedLeadCreateCustomerActionLabel,
  getCollectedLeadCreateCustomerConfirmationMessage,
  getCollectedLeadCreateCustomerErrorMessage,
  getCollectedLeadCreateCustomerResultMessage,
  getCollectedLeadCreateCustomerStateLabel,
  getCollectedLeadEnrichCustomerActionLabel,
  getCollectedLeadEnrichCustomerConfirmationMessage,
  getCollectedLeadEnrichCustomerErrorMessage,
  getCollectedLeadEnrichCustomerResultMessage,
  getCollectedLeadEnrichCustomerStateLabel,
  getCollectedLeadDraftSaveConfirmationMessage,
  getCollectedLeadDraftSaveErrorMessage,
  getCollectedLeadDraftSaveSuccessMessage,
  getLeadCaptureHistoryEmptyMessage,
  getLeadCaptureParsedSummary,
  getLeadCaptureRawTextSummary,
  getLeadCaptureSaveErrorMessage,
  getLeadCaptureSaveConfirmationMessage,
  getLeadCaptureSaveSuccessMessage,
  getEmptyLeadPastePreviewState,
  getLeadWorkbenchDetailEmptyMessage,
  getLeadWorkbenchListEmptyMessage,
  getLeadWorkItemStatusActions,
  getLeadWorkItemStatusUpdateSuccessMessage,
  getLeadWorkItemTerminalMessage,
  getNoStructuredLeadPastePreviewMessage,
  getStatusActionConfirmationMessage,
  getSuggestedTanjiSearchKeyword,
  isCollectedLeadDraftHistoryVisible,
  isLeadCaptureHistoryVisible,
  isLeadWorkItemTerminalStatus,
  isLeadPastePreviewVisible,
  LEAD_WORKBENCH_ACTION_LABELS,
  LEAD_WORKBENCH_STATUS_FILTERS,
  shouldRunCollectedLeadCreateCustomer,
  shouldRunCollectedLeadEnrichCustomer,
  shouldEnableCollectedLeadDraftSave,
  shouldRunCollectedLeadDraftSave,
  shouldEnableLeadCaptureSave,
  shouldRunLeadCaptureSave,
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
    expect(isLeadPastePreviewVisible(null)).toBe(false);
    expect(isLeadPastePreviewVisible(createWorkItem())).toBe(true);
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

  it('builds a read-only paste preview with normalized mobile candidates', () => {
    const preview = buildLeadPastePreviewResult('手机: +86 138 0013 8000');

    expect(preview.mobiles).toEqual(['13800138000']);
    expect(preview.raw_text).toBe('手机: +86 138 0013 8000');
  });

  it('builds a read-only paste preview with landline, URL, and email candidates', () => {
    const preview = buildLeadPastePreviewResult(
      '电话 0757-88889999 官网 https://example.com 邮箱 sales@example.com',
    );

    expect(preview.tels).toEqual(['0757-88889999']);
    expect(preview.urls).toEqual(['https://example.com']);
    expect(preview.emails).toEqual(['sales@example.com']);
  });

  it('shows title-only Chinese names only as possible contacts', () => {
    const preview = buildLeadPastePreviewResult('张总 李经理');

    expect(preview.contacts).toEqual([]);
    expect(preview.possibleContact).toEqual(['张总', '李经理']);
  });

  it('does not confirm two or three Chinese characters as contacts', () => {
    const preview = buildLeadPastePreviewResult('联系人 张三 李四');

    expect(preview.contacts).toEqual([]);
    expect(preview.possibleContact).toEqual([]);
  });

  it('shows a no-structured-data hint while preserving note and raw text', () => {
    const preview = buildLeadPastePreviewResult('这是一段没有电话网址邮箱的备注');

    expect(preview.hasStructuredInfo).toBe(false);
    expect(preview.note).toBe('这是一段没有电话网址邮箱的备注');
    expect(preview.raw_text).toBe('这是一段没有电话网址邮箱的备注');
    expect(getNoStructuredLeadPastePreviewMessage()).toContain('未识别到电话、网址或邮箱');
  });

  it('clears paste preview input and result when clearing or switching tasks', () => {
    expect(getEmptyLeadPastePreviewState()).toEqual({ text: '', result: null });
  });

  it('enables save capture only after a selected task has raw text and parsed preview', () => {
    const item = createWorkItem({ id: 'capture-1' });
    const result = buildLeadPastePreviewResult('手机 13800138000');

    expect(shouldEnableLeadCaptureSave(null, '手机 13800138000', result)).toBe(false);
    expect(shouldEnableLeadCaptureSave(item, '', result)).toBe(false);
    expect(shouldEnableLeadCaptureSave(item, '手机 13800138000', null)).toBe(false);
    expect(shouldEnableLeadCaptureSave(item, '手机 13800138000', result)).toBe(true);
  });

  it('requires confirmation before saving capture and includes company name', () => {
    const item = createWorkItem({ company_name: 'Capture Co' });
    const confirm = vi.fn().mockReturnValue(false);

    expect(getLeadCaptureSaveConfirmationMessage(item)).toContain('Capture Co');
    expect(shouldRunLeadCaptureSave(item, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Capture Co'));
  });

  it('runs capture save only after confirmation', () => {
    const item = createWorkItem({ company_name: 'Capture Co' });
    const confirm = vi.fn().mockReturnValue(true);

    expect(shouldRunLeadCaptureSave(item, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Capture Co'));
  });

  it('shows capture save success without clearing preview state', () => {
    const state = {
      text: '手机 13800138000',
      result: buildLeadPastePreviewResult('手机 13800138000'),
    };

    expect(getLeadCaptureSaveSuccessMessage()).toBe('捕获记录已保存');
    expect(state.text).toBe('手机 13800138000');
    expect(state.result?.mobiles).toEqual(['13800138000']);
  });

  it('shows a readable capture save error', () => {
    expect(getLeadCaptureSaveErrorMessage(new Error('database unavailable'))).toBe('database unavailable');
    expect(getLeadCaptureSaveErrorMessage('save failed')).toBe('save failed');
  });

  it('shows capture history only for a selected task and has an empty state', () => {
    expect(isLeadCaptureHistoryVisible(null)).toBe(false);
    expect(isLeadCaptureHistoryVisible(createWorkItem())).toBe(true);
    expect(getLeadCaptureHistoryEmptyMessage()).toBe('暂无捕获记录。');
  });

  it('summarizes capture raw text to the first 120 characters', () => {
    const rawText = 'a'.repeat(121);

    expect(getLeadCaptureRawTextSummary(rawText)).toBe(`${'a'.repeat(120)}...`);
    expect(getLeadCaptureRawTextSummary('short raw')).toBe('short raw');
  });

  it('summarizes parsed capture JSON candidates for display', () => {
    const summary = getLeadCaptureParsedSummary(JSON.stringify({
      mobiles: ['13800138000'],
      tels: ['0757-88889999'],
      urls: ['https://example.com'],
      emails: ['sales@example.com'],
      possibleContact: ['张总'],
    }));

    expect(summary).toContain('13800138000');
    expect(summary).toContain('0757-88889999');
    expect(summary).toContain('https://example.com');
    expect(summary).toContain('sales@example.com');
    expect(summary).toContain('张总');
  });

  it('keeps full capture raw text and parsed JSON available for expanded display', () => {
    const event = createCaptureEvent({
      raw_text: '完整原文 '.repeat(30),
      parsed_json: JSON.stringify({ mobiles: ['13800138000'], possibleContact: ['张总'] }),
    });

    expect(event.raw_text.length).toBeGreaterThan(120);
    expect(JSON.parse(event.parsed_json)).toEqual({
      mobiles: ['13800138000'],
      possibleContact: ['张总'],
    });
  });

  it('builds an editable collected lead draft from the selected task and preview', () => {
    const item = createWorkItem({
      id: 'draft-work',
      import_row_id: 'row-1',
      customer_id: 'customer-1',
      company_name: 'Draft Co',
    });
    const preview = buildLeadPastePreviewResult(
      '张总 手机 13800138000 电话 0757-88889999 官网 https://example.com 邮箱 sales@example.com',
    );

    const draft = buildCollectedLeadDraftForm(item, 'raw text', preview);

    expect(draft).toMatchObject({
      work_item_id: 'draft-work',
      import_row_id: 'row-1',
      customer_id: 'customer-1',
      company_name: 'Draft Co',
      contact_name: '',
      position: '',
      mobile: '13800138000',
      tel: '0757-88889999',
      website: 'https://example.com',
      email: 'sales@example.com',
      raw_text: 'raw text',
    });
    expect(draft.contactNameSuggestion).toBe('张总');
  });

  it('enables collected lead draft save only after parsed useful data exists', () => {
    const item = createWorkItem();
    const preview = buildLeadPastePreviewResult('手机 13800138000');
    const draft = buildCollectedLeadDraftForm(item, '手机 13800138000', preview);

    expect(shouldEnableCollectedLeadDraftSave(null, preview, draft)).toBe(false);
    expect(shouldEnableCollectedLeadDraftSave(item, null, draft)).toBe(false);
    expect(shouldEnableCollectedLeadDraftSave(item, preview, { ...draft, mobile: '', tel: '', website: '', email: '', contact_name: '', note: '' })).toBe(false);
    expect(shouldEnableCollectedLeadDraftSave(item, preview, draft)).toBe(true);
  });

  it('requires confirmation before saving collected lead draft and includes company name', () => {
    const item = createWorkItem({ company_name: 'Draft Co' });
    const confirm = vi.fn().mockReturnValue(false);

    expect(getCollectedLeadDraftSaveConfirmationMessage(item)).toContain('Draft Co');
    expect(shouldRunCollectedLeadDraftSave(item, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Draft Co'));
  });

  it('shows collected lead draft save success and readable errors', () => {
    expect(getCollectedLeadDraftSaveSuccessMessage()).toBe('采集线索草稿已保存');
    expect(getCollectedLeadDraftSaveErrorMessage(new Error('duplicate mobile'))).toBe('duplicate mobile');
    expect(getCollectedLeadDraftSaveErrorMessage('save failed')).toBe('save failed');
  });

  it('shows collected lead draft history only for a selected task and has an empty state', () => {
    expect(isCollectedLeadDraftHistoryVisible(null)).toBe(false);
    expect(isCollectedLeadDraftHistoryVisible(createWorkItem())).toBe(true);
    expect(getCollectedLeadDraftHistoryEmptyMessage()).toBe('暂无采集线索草稿。');
  });

  it('summarizes collected lead draft notes to the first 120 characters', () => {
    const longNote = 'a'.repeat(121);

    expect(getCollectedLeadDraftNoteSummary(longNote)).toBe(`${'a'.repeat(120)}...`);
    expect(getCollectedLeadDraftNoteSummary('short note')).toBe('short note');
    expect(getCollectedLeadDraftNoteSummary(null)).toBe('-');
  });

  it('keeps collected lead draft fields available for read-only expanded display', () => {
    const draft = createCollectedLead({
      work_item_id: 'work-1',
      import_row_id: 'row-1',
      customer_id: 'customer-1',
      contact_name: '张三',
      position: '经理',
      mobile: '13800138000',
      tel: '0757-88889999',
      website: 'https://example.com',
      email: 'sales@example.com',
      raw_text: '完整原文 '.repeat(30),
      note: '完整备注 '.repeat(30),
      sync_status: 'UNSYNCED',
    });

    expect(draft).toMatchObject({
      work_item_id: 'work-1',
      import_row_id: 'row-1',
      customer_id: 'customer-1',
      contact_name: '张三',
      position: '经理',
      mobile: '13800138000',
      tel: '0757-88889999',
      website: 'https://example.com',
      email: 'sales@example.com',
      sync_status: 'UNSYNCED',
    });
    expect(draft.raw_text?.length).toBeGreaterThan(120);
    expect(draft.note?.length).toBeGreaterThan(120);
    expect(getCollectedLeadDraftDisplayValue(draft.contact_name)).toBe('张三');
    expect(getCollectedLeadDraftDisplayValue(null)).toBe('-');
  });

  it('shows CREATE_CUSTOMER actions only for unsynced or failed collected lead drafts without customer_id', () => {
    const unsyncedCreate = createCollectedLead({
      customer_id: null,
      sync_status: 'UNSYNCED',
    });
    const failedCreate = createCollectedLead({
      customer_id: null,
      sync_status: 'FAILED',
    });
    const syncedCreate = createCollectedLead({
      customer_id: null,
      sync_status: 'SYNCED',
    });
    const ignoredCreate = createCollectedLead({
      customer_id: null,
      sync_status: 'IGNORED',
    });

    expect(getCollectedLeadCreateCustomerActionLabel(unsyncedCreate)).toBe('创建 CRM 客户');
    expect(getCollectedLeadEnrichCustomerActionLabel(unsyncedCreate)).toBeNull();
    expect(getCollectedLeadCreateCustomerActionLabel(failedCreate)).toBe('重试创建 CRM 客户');
    expect(getCollectedLeadEnrichCustomerActionLabel(failedCreate)).toBeNull();
    expect(getCollectedLeadCreateCustomerActionLabel(syncedCreate)).toBeNull();
    expect(getCollectedLeadEnrichCustomerActionLabel(syncedCreate)).toBeNull();
    expect(getCollectedLeadCreateCustomerStateLabel(syncedCreate)).toBe('已同步');
    expect(getCollectedLeadCreateCustomerActionLabel(ignoredCreate)).toBeNull();
    expect(getCollectedLeadEnrichCustomerActionLabel(ignoredCreate)).toBeNull();
    expect(getCollectedLeadCreateCustomerStateLabel(ignoredCreate)).toBe('已忽略');
  });

  it('shows ENRICH_CUSTOMER actions only for unsynced or failed collected lead drafts with customer_id', () => {
    const unsyncedEnrich = createCollectedLead({
      customer_id: 'customer-existing',
      sync_status: 'UNSYNCED',
    });
    const failedEnrich = createCollectedLead({
      customer_id: 'customer-existing',
      sync_status: 'FAILED',
    });
    const syncedEnrich = createCollectedLead({
      customer_id: 'customer-existing',
      sync_status: 'SYNCED',
    });
    const ignoredEnrich = createCollectedLead({
      customer_id: 'customer-existing',
      sync_status: 'IGNORED',
    });

    expect(getCollectedLeadEnrichCustomerActionLabel(unsyncedEnrich)).toBe('补充已有客户');
    expect(getCollectedLeadCreateCustomerActionLabel(unsyncedEnrich)).toBeNull();
    expect(getCollectedLeadEnrichCustomerActionLabel(failedEnrich)).toBe('重试补充已有客户');
    expect(getCollectedLeadCreateCustomerActionLabel(failedEnrich)).toBeNull();
    expect(getCollectedLeadEnrichCustomerActionLabel(syncedEnrich)).toBeNull();
    expect(getCollectedLeadCreateCustomerActionLabel(syncedEnrich)).toBeNull();
    expect(getCollectedLeadEnrichCustomerStateLabel(syncedEnrich)).toBe('已同步');
    expect(getCollectedLeadEnrichCustomerActionLabel(ignoredEnrich)).toBeNull();
    expect(getCollectedLeadCreateCustomerActionLabel(ignoredEnrich)).toBeNull();
    expect(getCollectedLeadEnrichCustomerStateLabel(ignoredEnrich)).toBe('已忽略');
  });

  it('keeps CREATE_CUSTOMER actions for collected lead drafts without customer_id and hides ENRICH actions', () => {
    const draft = createCollectedLead({
      customer_id: null,
      sync_status: 'UNSYNCED',
    });

    expect(getCollectedLeadCreateCustomerActionLabel(draft)).toBe('创建 CRM 客户');
    expect(getCollectedLeadEnrichCustomerActionLabel(draft)).toBeNull();
  });

  it('requires confirmation before CREATE_CUSTOMER and includes collected lead details', () => {
    const draft = createCollectedLead({
      company_name: 'Create Co',
      contact_name: '张三',
      mobile: '13800138000',
      tel: '0757-88889999',
      website: 'https://example.com',
      email: 'sales@example.com',
      note: 'important collected note',
      sync_status: 'UNSYNCED',
    });
    const confirm = vi.fn().mockReturnValue(true);

    const confirmation = getCollectedLeadCreateCustomerConfirmationMessage(draft);

    expect(confirmation).toContain('Create Co');
    expect(confirmation).toContain('张三');
    expect(confirmation).toContain('13800138000');
    expect(confirmation).toContain('0757-88889999');
    expect(confirmation).toContain('https://example.com');
    expect(confirmation).toContain('sales@example.com');
    expect(confirmation).toContain('important collected note');
    expect(confirmation).toContain('将创建新的 CRM 客户');
    expect(confirmation).toContain('将创建新的 CRM 客户，不会补充已有客户');
    expect(shouldRunCollectedLeadCreateCustomer(draft, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(confirmation);
  });

  it('does not run CREATE_CUSTOMER when confirmation is cancelled or action is unavailable', () => {
    const confirm = vi.fn().mockReturnValue(false);

    expect(shouldRunCollectedLeadCreateCustomer(createCollectedLead({ sync_status: 'UNSYNCED' }), confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(shouldRunCollectedLeadCreateCustomer(createCollectedLead({ sync_status: 'SYNCED' }), confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('shows readable CREATE_CUSTOMER success and failure messages', () => {
    expect(getCollectedLeadCreateCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-created',
      status: 'SUCCESS',
      message: 'Created customer from collected lead',
    })).toContain('CRM 客户创建成功');
    expect(getCollectedLeadCreateCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-created',
      status: 'SUCCESS',
      message: 'Created customer from collected lead',
    })).toContain('customer-created');
    expect(getCollectedLeadCreateCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-duplicate',
      status: 'DUPLICATE_PHONE',
      message: 'Duplicate customer phone_number: 13800138000',
    })).toContain('发现重复客户，未创建 CRM 客户');
    expect(getCollectedLeadCreateCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-duplicate',
      status: 'DUPLICATE_NAME',
      message: 'Duplicate customer name: Create Co',
    })).toContain('发现重复客户，未创建 CRM 客户');
    expect(getCollectedLeadCreateCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-created',
      status: 'ALREADY_SYNCED',
      message: 'Collected lead is already synced',
    })).toBe('Collected lead is already synced');
    expect(getCollectedLeadCreateCustomerResultMessage({
      collectedLeadId: 'draft-1',
      status: 'INVALID_STATUS',
      message: 'Ignored collected lead cannot be synced',
    })).toBe('Ignored collected lead cannot be synced');
    expect(getCollectedLeadCreateCustomerErrorMessage(new Error('sync failed'))).toBe('sync failed');
  });

  it('requires confirmation before ENRICH_CUSTOMER and includes collected lead details', () => {
    const draft = createCollectedLead({
      customer_id: 'customer-existing',
      company_name: 'Enrich Co',
      contact_name: '李四',
      mobile: '13900139000',
      tel: '020-88889999',
      website: 'https://enrich.example.com',
      email: 'ops@example.com',
      note: 'enrich collected note',
      sync_status: 'UNSYNCED',
    });
    const confirm = vi.fn().mockReturnValue(true);

    const confirmation = getCollectedLeadEnrichCustomerConfirmationMessage(draft);

    expect(confirmation).toContain('Enrich Co');
    expect(confirmation).toContain('customer-existing');
    expect(confirmation).toContain('李四');
    expect(confirmation).toContain('13900139000');
    expect(confirmation).toContain('020-88889999');
    expect(confirmation).toContain('https://enrich.example.com');
    expect(confirmation).toContain('ops@example.com');
    expect(confirmation).toContain('enrich collected note');
    expect(confirmation).toContain('将补充已有 CRM 客户');
    expect(confirmation).toContain('只补充空字段');
    expect(confirmation).toContain('只补充已有客户的空字段，不覆盖已有电话、联系人、等级、阶段、source');
    expect(shouldRunCollectedLeadEnrichCustomer(draft, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(confirmation);
  });

  it('does not run ENRICH_CUSTOMER when confirmation is cancelled or action is unavailable', () => {
    const confirm = vi.fn().mockReturnValue(false);

    expect(shouldRunCollectedLeadEnrichCustomer(createCollectedLead({
      customer_id: 'customer-existing',
      sync_status: 'UNSYNCED',
    }), confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(shouldRunCollectedLeadEnrichCustomer(createCollectedLead({
      customer_id: 'customer-existing',
      sync_status: 'SYNCED',
    }), confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('shows readable ENRICH_CUSTOMER success and failure messages', () => {
    expect(getCollectedLeadEnrichCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-existing',
      status: 'SUCCESS',
      message: 'Enriched customer from collected lead',
    })).toContain('已有客户补充成功');
    expect(getCollectedLeadEnrichCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-existing',
      status: 'SUCCESS',
      message: 'Enriched customer from collected lead',
    })).toContain('customer-existing');
    expect(getCollectedLeadEnrichCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'missing-customer',
      status: 'CUSTOMER_NOT_FOUND',
      message: 'Customer not found: missing-customer',
    })).toBe('Customer not found: missing-customer');
    expect(getCollectedLeadEnrichCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-existing',
      status: 'NO_ENRICHABLE_FIELDS',
      message: 'No enrichable fields for collected lead',
    })).toBe('No enrichable fields for collected lead');
    expect(getCollectedLeadEnrichCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-existing',
      status: 'ALREADY_SYNCED',
      message: 'Collected lead is already synced',
    })).toBe('Collected lead is already synced');
    expect(getCollectedLeadEnrichCustomerResultMessage({
      collectedLeadId: 'draft-1',
      targetCustomerId: 'customer-existing',
      status: 'INVALID_STATUS',
      message: 'Ignored collected lead cannot be synced',
    })).toBe('Ignored collected lead cannot be synced');
    expect(getCollectedLeadEnrichCustomerErrorMessage(new Error('enrich failed'))).toBe('enrich failed');
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
    expect(pageSource).toContain('粘贴解析预览');
    expect(pageSource).toContain('解析预览');
    expect(pageSource).toContain('清空粘贴内容');
    expect(pageSource).toContain('保存捕获记录');
    expect(pageSource).toContain('保存为采集线索草稿');
    expect(pageSource).toContain('采集线索草稿已保存');
    expect(pageSource).toContain('insertCollectedLeadDraft');
    expect(pageSource).toContain('采集线索草稿');
    expect(pageSource).toContain('暂无采集线索草稿。');
    expect(pageSource).toContain('listCollectedLeadsByWorkItemId');
    expect(pageSource).toContain('await loadCollectedLeadDrafts(selectedItem.id)');
    expect(pageSource).toContain('setCollectedLeadDrafts([])');
    expect(pageSource).toContain('syncCollectedLeadCreateCustomer');
    expect(pageSource).toContain('getCollectedLeadCreateCustomerConfirmationMessage');
    expect(pageSource).toContain('syncCollectedLeadEnrichCustomer');
    expect(pageSource).toContain('getCollectedLeadEnrichCustomerConfirmationMessage');
    expect(pageSource).toContain('CRM 客户创建成功');
    expect(pageSource).toContain('已有客户补充成功');
    expect(pageSource).toContain('result.targetCustomerId');
    expect(pageSource).toContain('创建 CRM 客户');
    expect(pageSource).toContain('重试创建 CRM 客户');
    expect(pageSource).toContain('补充已有客户');
    expect(pageSource).toContain('重试补充已有客户');
    expect(pageSource).toContain('disabled={isCurrentDraftSyncing}');
    expect(pageSource).toContain('created_customer_id');
    expect(pageSource).toContain('updated_customer_id');
    expect(pageSource).toContain('sync_status');
    expect(pageSource).toContain('完整 raw_text');
    expect(pageSource).toContain('完整 note');
    expect(pageSource).toContain('work_item_id');
    expect(pageSource).toContain('import_row_id');
    expect(pageSource).toContain('customer_id');
    expect(pageSource).toContain('历史捕获记录');
    expect(pageSource).toContain('暂无捕获记录。');
    expect(pageSource).toContain('listLeadCaptureEventsByWorkItemId');
    expect(pageSource).toContain('捕获记录已保存');
    expect(pageSource).toContain('insertLeadCaptureEvent');
    expect(pageSource).toContain('parseLeadContactText');
    expect(pageSource).toContain('disabled={isLoading || isUpdating}');
    expect(pageSource).toContain('await loadCollectedLeadDrafts(workItemId)');
    expect(pageSource).not.toContain('保存线索');
    expect(pageSource).not.toContain('生成线索');
    expect(pageSource).not.toContain('保存 collected_lead');
    expect(pageSource).not.toContain('编辑采集线索');
    expect(pageSource).not.toContain('删除采集线索');
    expect(pageSource).not.toContain('编辑捕获记录');
    expect(pageSource).not.toContain('删除捕获记录');
    expect(pageSource).not.toContain('insertCustomerWithDb');
    expect(pageSource).not.toContain('createCustomer(');
    expect(pageSource).not.toContain('insertLeadSyncLog');
    expect(pageSource).not.toContain('updateCollectedLeadSyncState');
    expect(pageSource).not.toContain('INSERT INTO customers');
    expect(pageSource).not.toContain('UPDATE customers');
    expect(pageSource).not.toContain('INSERT INTO collected_leads');
    expect(pageSource).not.toContain('UPDATE collected_leads');
    expect(pageSource).not.toContain('INSERT INTO lead_sync_logs');
    expect(pageSource).not.toContain('UPDATE lead_sync_logs');
    expect(pageSource).not.toContain('insertLeadWorkItem');
    expect(pageSource).not.toContain('INSERT INTO lead_work_items');
    expect(pageSource).not.toContain('批量同步');
    expect(pageSource).not.toContain('批量创建');
    expect(pageSource).not.toContain('批量补充');
    expect(pageSource).not.toContain('collected_leads');
    expect(pageSource).not.toContain('lead_capture_events');
    expect(pageSource).not.toContain('lead_sync_logs');
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

function createCaptureEvent(overrides: Partial<LeadCaptureEvent> = {}): LeadCaptureEvent {
  return {
    id: 'capture-1',
    work_item_id: 'work-1',
    raw_text: 'raw text',
    parsed_json: '{}',
    confidence_json: '{}',
    action: 'PARSED',
    created_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function createCollectedLead(overrides: Partial<CollectedLead> = {}): CollectedLead {
  return {
    id: 'draft-1',
    work_item_id: 'work-1',
    import_row_id: null,
    customer_id: null,
    company_name: 'Draft Co',
    contact_name: null,
    position: null,
    mobile: null,
    tel: null,
    website: null,
    email: null,
    raw_text: null,
    note: null,
    sync_status: 'UNSYNCED',
    created_customer_id: null,
    updated_customer_id: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
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
