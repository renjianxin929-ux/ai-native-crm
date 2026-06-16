import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clipboard, PhoneOff, RefreshCw, Search, SkipForward } from 'lucide-react';

import { getDb } from '../lib/db';
import {
  insertLeadCaptureEvent,
  listLeadCaptureEventsByWorkItemId,
  type LeadCaptureEvent,
} from '../lib/leadWorkbench/captureEvents';
import {
  insertCollectedLeadDraft,
  listCollectedLeadsByWorkItemId,
  type CollectedLead,
} from '../lib/leadWorkbench/collectedLeads';
import {
  getLeadWorkItemStatusCounts,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { parseLeadContactText } from '../lib/leadWorkbench/parser';
import {
  syncCollectedLeadCreateCustomer,
  type SyncCollectedLeadCreateCustomerResult,
} from '../lib/leadWorkbench/syncAdapter';
import { updateLeadWorkItemStatus } from '../lib/leadWorkbench/workItemActions';
import type { LeadWorkItem, LeadWorkStatus } from '../lib/leadWorkbench/types';

export const LEAD_WORKBENCH_STATUS_FILTERS: LeadWorkStatus[] = [
  'TODO',
  'SEARCHING',
  'STAGED',
  'COLLECTED',
  'NO_PHONE',
  'SKIPPED',
  'DONE',
];

export const LEAD_WORKBENCH_ACTION_LABELS = [
  '复制搜索词',
  '开始查询',
  '标记无电话',
  '跳过',
];

export type LeadWorkItemStatusAction = {
  label: string;
  nextStatus: LeadWorkStatus;
  icon: 'search' | 'phone-off' | 'skip';
};

type ClipboardWriter = {
  writeText(text: string): Promise<void>;
};

type ConfirmFn = (message: string) => boolean;

export type LeadPastePreviewResult = {
  mobiles: string[];
  tels: string[];
  urls: string[];
  emails: string[];
  contacts: string[];
  possibleContact: string[];
  note: string;
  raw_text: string;
  hasStructuredInfo: boolean;
};

export type LeadPastePreviewState = {
  text: string;
  result: LeadPastePreviewResult | null;
};

export type CollectedLeadDraftForm = {
  work_item_id: string;
  import_row_id: string | null;
  customer_id: string | null;
  company_name: string;
  contact_name: string;
  position: string;
  mobile: string;
  tel: string;
  website: string;
  email: string;
  raw_text: string;
  note: string;
  contactNameSuggestion: string;
};

export function filterLeadWorkItemsByStatus(
  items: LeadWorkItem[],
  status: LeadWorkStatus,
): LeadWorkItem[] {
  return items.filter(item => item.status === status);
}

export function sortLeadWorkItemsForDisplay(items: LeadWorkItem[]): LeadWorkItem[] {
  return [...items].sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;
    return left.created_at.localeCompare(right.created_at);
  });
}

export function getLeadWorkbenchListEmptyMessage(
  totalTaskCount: number,
  _status: LeadWorkStatus,
): string {
  if (totalTaskCount === 0) {
    return '暂无获客任务，请先在导入分流中心执行分流。';
  }
  return '当前状态下暂无任务。';
}

export function getLeadWorkbenchDetailEmptyMessage(): string {
  return '请选择左侧任务查看详情。';
}

export function getLeadCaptureHistoryEmptyMessage(): string {
  return '暂无捕获记录。';
}

export function getLeadCaptureSaveSuccessMessage(): string {
  return '捕获记录已保存';
}

export function getLeadCaptureSaveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getCollectedLeadDraftSaveSuccessMessage(): string {
  return '采集线索草稿已保存';
}

export function getCollectedLeadDraftSaveErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function getCollectedLeadDraftHistoryEmptyMessage(): string {
  return '暂无采集线索草稿。';
}

export function isCollectedLeadDraftHistoryVisible(item: LeadWorkItem | null): boolean {
  return Boolean(item);
}

export function getCollectedLeadDraftDisplayValue(value: string | number | null): string {
  const normalized = typeof value === 'number' ? String(value) : value?.trim() || '';
  return normalized || '-';
}

export function getCollectedLeadDraftNoteSummary(note: string | null): string {
  const value = note?.trim() || '';
  if (!value) return '-';
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

export function getCollectedLeadCreateCustomerActionLabel(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status'>,
): string | null {
  if (draft.customer_id) return null;
  if (draft.sync_status === 'UNSYNCED') return '创建 CRM 客户';
  if (draft.sync_status === 'FAILED') return '重试创建 CRM 客户';
  return null;
}

export function getCollectedLeadCreateCustomerStateLabel(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status'>,
): string | null {
  if (draft.customer_id) return '已有客户补充待后续阶段支持';
  if (draft.sync_status === 'SYNCED') return '已同步';
  if (draft.sync_status === 'IGNORED') return '已忽略';
  return null;
}

export function getCollectedLeadCreateCustomerConfirmationMessage(
  draft: Pick<CollectedLead, 'company_name' | 'contact_name' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>,
): string {
  return [
    '确认创建 CRM 客户？',
    `company_name: ${getCollectedLeadDraftDisplayValue(draft.company_name)}`,
    `contact_name: ${getCollectedLeadDraftDisplayValue(draft.contact_name)}`,
    `mobile / tel: ${getCollectedLeadDraftDisplayValue(draft.mobile)} / ${getCollectedLeadDraftDisplayValue(draft.tel)}`,
    `website: ${getCollectedLeadDraftDisplayValue(draft.website)}`,
    `email: ${getCollectedLeadDraftDisplayValue(draft.email)}`,
    `note 摘要: ${getCollectedLeadDraftNoteSummary(draft.note)}`,
    '将创建新的 CRM 客户，不会补充已有客户。',
  ].join('\n');
}

export function shouldRunCollectedLeadCreateCustomer(
  draft: Pick<CollectedLead, 'customer_id' | 'sync_status' | 'company_name' | 'contact_name' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>,
  confirm: ConfirmFn,
): boolean {
  if (!getCollectedLeadCreateCustomerActionLabel(draft)) return false;
  return confirm(getCollectedLeadCreateCustomerConfirmationMessage(draft));
}

export function getCollectedLeadCreateCustomerResultMessage(
  result: SyncCollectedLeadCreateCustomerResult,
): string {
  if (result.status === 'SUCCESS') return 'CRM 客户创建成功';
  if (result.status === 'DUPLICATE_PHONE' || result.status === 'DUPLICATE_NAME') {
    return `发现重复客户，未创建 CRM 客户：${result.message}`;
  }
  return result.message;
}

export function getCollectedLeadCreateCustomerErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isLeadCaptureHistoryVisible(item: LeadWorkItem | null): boolean {
  return Boolean(item);
}

export function getLeadCaptureRawTextSummary(rawText: string): string {
  return rawText.length > 120 ? `${rawText.slice(0, 120)}...` : rawText;
}

export function getLeadCaptureParsedSummary(parsedJson: string): string {
  try {
    const parsed = JSON.parse(parsedJson) as Record<string, unknown>;
    const values = [
      ...stringArrayFromUnknown(parsed.mobiles),
      ...stringArrayFromUnknown(parsed.tels),
      ...stringArrayFromUnknown(parsed.urls),
      ...stringArrayFromUnknown(parsed.emails),
      ...stringArrayFromUnknown(parsed.possibleContact),
      ...stringArrayFromUnknown(parsed.possibleContacts),
    ];
    return values.length > 0 ? values.join(' / ') : '-';
  } catch {
    return '-';
  }
}

export function isLeadPastePreviewVisible(item: LeadWorkItem | null): boolean {
  return Boolean(item);
}

export function getEmptyLeadPastePreviewState(): LeadPastePreviewState {
  return { text: '', result: null };
}

export function getNoStructuredLeadPastePreviewMessage(): string {
  return '未识别到电话、网址或邮箱，可作为备注参考。';
}

export function buildLeadPastePreviewResult(rawText: string): LeadPastePreviewResult {
  const parsed = parseLeadContactText(rawText);
  return {
    mobiles: parsed.mobiles,
    tels: parsed.tels,
    urls: parsed.urls,
    emails: parsed.emails,
    contacts: parsed.contacts,
    possibleContact: parsed.possibleContacts,
    note: rawText.trim(),
    raw_text: rawText,
    hasStructuredInfo: parsed.mobiles.length > 0
      || parsed.tels.length > 0
      || parsed.urls.length > 0
      || parsed.emails.length > 0,
  };
}

export function buildCollectedLeadDraftForm(
  item: LeadWorkItem,
  rawText: string,
  previewResult: LeadPastePreviewResult,
): CollectedLeadDraftForm {
  return {
    work_item_id: item.id,
    import_row_id: item.import_row_id,
    customer_id: item.customer_id,
    company_name: item.company_name?.trim() || '',
    contact_name: '',
    position: '',
    mobile: previewResult.mobiles[0] || '',
    tel: previewResult.tels[0] || '',
    website: previewResult.urls[0] || '',
    email: previewResult.emails[0] || '',
    raw_text: rawText,
    note: previewResult.note,
    contactNameSuggestion: previewResult.possibleContact[0] || '',
  };
}

export function shouldEnableCollectedLeadDraftSave(
  item: LeadWorkItem | null,
  previewResult: LeadPastePreviewResult | null,
  draft: CollectedLeadDraftForm | null,
): boolean {
  if (!item || !previewResult || !draft) return false;
  return [
    draft.mobile,
    draft.tel,
    draft.website,
    draft.email,
    draft.contact_name,
    draft.note,
  ].some(value => value.trim());
}

export function getCollectedLeadDraftSaveConfirmationMessage(
  item: Pick<LeadWorkItem, 'company_name'>,
): string {
  const companyName = item.company_name?.trim() || '未命名公司';
  return `确认将「${companyName}」保存为采集线索草稿吗？`;
}

export function shouldRunCollectedLeadDraftSave(
  item: Pick<LeadWorkItem, 'company_name'>,
  confirm: ConfirmFn,
): boolean {
  return confirm(getCollectedLeadDraftSaveConfirmationMessage(item));
}

export function shouldEnableLeadCaptureSave(
  item: LeadWorkItem | null,
  rawText: string,
  previewResult: LeadPastePreviewResult | null,
): boolean {
  return Boolean(item && rawText.trim() && previewResult);
}

export function getLeadCaptureSaveConfirmationMessage(
  item: Pick<LeadWorkItem, 'company_name'>,
): string {
  const companyName = item.company_name?.trim() || '未命名公司';
  return `确认将「${companyName}」的当前粘贴内容保存为捕获记录吗？`;
}

export function shouldRunLeadCaptureSave(
  item: Pick<LeadWorkItem, 'company_name'>,
  confirm: ConfirmFn,
): boolean {
  return confirm(getLeadCaptureSaveConfirmationMessage(item));
}

export function getSuggestedTanjiSearchKeyword(
  item: Pick<LeadWorkItem, 'tanji_search_keyword' | 'company_name'>,
): string {
  const configuredKeyword = item.tanji_search_keyword?.trim();
  return configuredKeyword || item.company_name?.trim() || '';
}

export function hasConfiguredTanjiSearchKeyword(
  item: Pick<LeadWorkItem, 'tanji_search_keyword'>,
): boolean {
  return Boolean(item.tanji_search_keyword?.trim());
}

export function isLeadWorkItemTerminalStatus(status: LeadWorkStatus): boolean {
  return status === 'NO_PHONE' || status === 'SKIPPED' || status === 'DONE';
}

export function getLeadWorkItemTerminalMessage(status: LeadWorkStatus): string | null {
  if (status === 'NO_PHONE') return '该任务已标记为无电话，不能继续流转。';
  if (status === 'SKIPPED') return '该任务已跳过，不能继续流转。';
  if (status === 'DONE') return '该任务已完成，不能继续流转。';
  return null;
}

export function getLeadWorkItemStatusActions(status: LeadWorkStatus): LeadWorkItemStatusAction[] {
  if (isLeadWorkItemTerminalStatus(status)) return [];

  if (status === 'TODO') {
    return [
      { label: '开始查询', nextStatus: 'SEARCHING', icon: 'search' },
      { label: '标记无电话', nextStatus: 'NO_PHONE', icon: 'phone-off' },
      { label: '跳过', nextStatus: 'SKIPPED', icon: 'skip' },
    ];
  }

  if (status === 'SEARCHING') {
    return [
      { label: '标记无电话', nextStatus: 'NO_PHONE', icon: 'phone-off' },
      { label: '跳过', nextStatus: 'SKIPPED', icon: 'skip' },
    ];
  }

  if (status === 'STAGED') {
    return [{ label: '跳过', nextStatus: 'SKIPPED', icon: 'skip' }];
  }

  return [];
}

export function getStatusActionConfirmationMessage(
  item: Pick<LeadWorkItem, 'company_name'>,
  nextStatus: LeadWorkStatus,
): string | null {
  const companyName = item.company_name?.trim() || '未命名公司';
  if (nextStatus === 'NO_PHONE') {
    return `确认将「${companyName}」标记为无电话吗？`;
  }
  if (nextStatus === 'SKIPPED') {
    return `确认跳过「${companyName}」吗？`;
  }
  return null;
}

export function shouldRunLeadWorkItemStatusUpdate(
  item: Pick<LeadWorkItem, 'company_name' | 'status'>,
  nextStatus: LeadWorkStatus,
  confirm: ConfirmFn,
): boolean {
  if (isLeadWorkItemTerminalStatus(item.status)) return false;

  const confirmationMessage = getStatusActionConfirmationMessage(item, nextStatus);
  if (!confirmationMessage) return true;

  return confirm(confirmationMessage);
}

export function getLeadWorkItemStatusUpdateSuccessMessage(nextStatus: LeadWorkStatus): string {
  return `任务状态已更新为 ${nextStatus}`;
}

export async function copyLeadSearchKeyword(
  item: Pick<LeadWorkItem, 'tanji_search_keyword' | 'company_name'>,
  clipboard?: ClipboardWriter,
): Promise<{ ok: boolean; message: string }> {
  const keyword = getSuggestedTanjiSearchKeyword(item);
  try {
    if (!clipboard || !keyword) {
      throw new Error('Clipboard unavailable');
    }
    await clipboard.writeText(keyword);
    return { ok: true, message: '已复制搜索词' };
  } catch {
    return { ok: false, message: '复制失败，请手动复制' };
  }
}

function emptyStatusCounts(): Record<LeadWorkStatus, number> {
  return {
    TODO: 0,
    SEARCHING: 0,
    STAGED: 0,
    COLLECTED: 0,
    NO_PHONE: 0,
    SKIPPED: 0,
    DONE: 0,
  };
}

function getTotalStatusCount(counts: Record<LeadWorkStatus, number>): number {
  return LEAD_WORKBENCH_STATUS_FILTERS.reduce((total, status) => total + counts[status], 0);
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

export default function LeadWorkbenchPage() {
  const [statusFilter, setStatusFilter] = useState<LeadWorkStatus>('TODO');
  const [items, setItems] = useState<LeadWorkItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<LeadWorkStatus, number>>(emptyStatusCounts);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSavingCapture, setIsSavingCapture] = useState(false);
  const [isSavingCollectedLead, setIsSavingCollectedLead] = useState(false);
  const [isSyncingCollectedLeadId, setIsSyncingCollectedLeadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pastePreviewState, setPastePreviewState] = useState<LeadPastePreviewState>(getEmptyLeadPastePreviewState);
  const [collectedLeadDraft, setCollectedLeadDraft] = useState<CollectedLeadDraftForm | null>(null);
  const [captureEvents, setCaptureEvents] = useState<LeadCaptureEvent[]>([]);
  const [collectedLeadDrafts, setCollectedLeadDrafts] = useState<CollectedLead[]>([]);

  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedItemId) || null,
    [items, selectedItemId],
  );

  const totalTaskCount = useMemo(() => getTotalStatusCount(counts), [counts]);
  const visibleItems = useMemo(() => sortLeadWorkItemsForDisplay(items), [items]);

  const loadItems = useCallback(async (status: LeadWorkStatus) => {
    setIsLoading(true);
    setError(null);
    try {
      const db = await getDb();
      const [nextItems, nextCounts] = await Promise.all([
        listLeadWorkItemsByStatus(db, status),
        getLeadWorkItemStatusCounts(db),
      ]);
      const sortedItems = sortLeadWorkItemsForDisplay(nextItems);
      setItems(sortedItems);
      setCounts(nextCounts);
      setSelectedItemId(current => {
        if (current && sortedItems.some(item => item.id === current)) return current;
        return sortedItems[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setSelectedItemId(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(statusFilter);
  }, [loadItems, statusFilter]);

  useEffect(() => {
    setPastePreviewState(getEmptyLeadPastePreviewState());
    setCollectedLeadDraft(null);
  }, [selectedItemId]);

  const loadCaptureEvents = useCallback(async (workItemId: string) => {
    const db = await getDb();
    const events = await listLeadCaptureEventsByWorkItemId(db, workItemId);
    setCaptureEvents(events);
  }, []);

  const loadCollectedLeadDrafts = useCallback(async (workItemId: string) => {
    const db = await getDb();
    const drafts = await listCollectedLeadsByWorkItemId(db, workItemId);
    setCollectedLeadDrafts(drafts);
  }, []);

  useEffect(() => {
    if (!selectedItemId) {
      setCaptureEvents([]);
      return;
    }

    setCaptureEvents([]);
    void loadCaptureEvents(selectedItemId).catch(err => {
      setError(getLeadCaptureSaveErrorMessage(err));
    });
  }, [loadCaptureEvents, selectedItemId]);

  useEffect(() => {
    if (!selectedItemId) {
      setCollectedLeadDrafts([]);
      return;
    }

    setCollectedLeadDrafts([]);
    void loadCollectedLeadDrafts(selectedItemId).catch(err => {
      setError(getCollectedLeadDraftSaveErrorMessage(err));
    });
  }, [loadCollectedLeadDrafts, selectedItemId]);

  const handleRefreshTasks = useCallback(async () => {
    setMessage(null);
    await loadItems(statusFilter);
  }, [loadItems, statusFilter]);

  const handleCopySearchKeyword = useCallback(async () => {
    if (!selectedItem) return;
    const clipboard = typeof navigator !== 'undefined' && navigator.clipboard?.writeText
      ? { writeText: (text: string) => navigator.clipboard.writeText(text) }
      : undefined;
    const result = await copyLeadSearchKeyword(selectedItem, clipboard);
    setMessage(result.message);
    if (!result.ok) {
      setError(result.message);
    } else {
      setError(null);
    }
  }, [selectedItem]);

  const handleStatusAction = useCallback(async (nextStatus: LeadWorkStatus) => {
    if (!selectedItem) return;
    if (!shouldRunLeadWorkItemStatusUpdate(selectedItem, nextStatus, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsUpdating(true);
    setError(null);
    setMessage(null);
    try {
      const db = await getDb();
      await updateLeadWorkItemStatus(db, selectedItem.id, nextStatus);
      setMessage(getLeadWorkItemStatusUpdateSuccessMessage(nextStatus));
      await loadItems(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdating(false);
    }
  }, [loadItems, selectedItem, statusFilter]);

  const handleParsePastePreview = useCallback(() => {
    if (!selectedItem) return;
    setPastePreviewState(current => {
      const result = buildLeadPastePreviewResult(current.text);
      setCollectedLeadDraft(buildCollectedLeadDraftForm(selectedItem, current.text, result));
      return {
        ...current,
        result,
      };
    });
  }, [selectedItem]);

  const handleClearPastePreview = useCallback(() => {
    setPastePreviewState(getEmptyLeadPastePreviewState());
    setCollectedLeadDraft(null);
  }, []);

  const handleSaveLeadCaptureEvent = useCallback(async () => {
    if (!selectedItem || !pastePreviewState.result) return;
    if (!shouldRunLeadCaptureSave(selectedItem, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsSavingCapture(true);
    setError(null);
    setMessage(null);
    try {
      const db = await getDb();
      await insertLeadCaptureEvent(db, {
        work_item_id: selectedItem.id,
        raw_text: pastePreviewState.text,
        parsed_json: pastePreviewState.result,
        confidence_json: {},
        action: 'PARSED',
      });
      await loadCaptureEvents(selectedItem.id);
      setMessage(getLeadCaptureSaveSuccessMessage());
    } catch (err) {
      setError(getLeadCaptureSaveErrorMessage(err));
    } finally {
      setIsSavingCapture(false);
    }
  }, [loadCaptureEvents, pastePreviewState.result, pastePreviewState.text, selectedItem]);

  const handleSaveCollectedLeadDraft = useCallback(async () => {
    if (!selectedItem || !collectedLeadDraft) return;
    if (!shouldRunCollectedLeadDraftSave(selectedItem, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsSavingCollectedLead(true);
    setError(null);
    setMessage(null);
    try {
      const { contactNameSuggestion: _contactNameSuggestion, ...input } = collectedLeadDraft;
      const db = await getDb();
      await insertCollectedLeadDraft(db, input);
      await loadCollectedLeadDrafts(selectedItem.id);
      setMessage(getCollectedLeadDraftSaveSuccessMessage());
    } catch (err) {
      setError(getCollectedLeadDraftSaveErrorMessage(err));
    } finally {
      setIsSavingCollectedLead(false);
    }
  }, [collectedLeadDraft, loadCollectedLeadDrafts, selectedItem]);

  const handleSyncCollectedLeadCreateCustomer = useCallback(async (draft: CollectedLead) => {
    if (!shouldRunCollectedLeadCreateCustomer(draft, messageToConfirm => window.confirm(messageToConfirm))) {
      return;
    }

    setIsSyncingCollectedLeadId(draft.id);
    setError(null);
    setMessage(null);
    try {
      const db = await getDb();
      const result = await syncCollectedLeadCreateCustomer(db, draft.id);
      const workItemId = draft.work_item_id ?? selectedItemId;
      if (workItemId) {
        await loadCollectedLeadDrafts(workItemId);
      }
      const resultMessage = getCollectedLeadCreateCustomerResultMessage(result);
      if (result.status === 'SUCCESS') {
        setMessage(resultMessage);
      } else {
        setError(resultMessage);
      }
    } catch (err) {
      setError(getCollectedLeadCreateCustomerErrorMessage(err));
      const workItemId = draft.work_item_id ?? selectedItemId;
      if (workItemId) {
        await loadCollectedLeadDrafts(workItemId).catch(() => undefined);
      }
    } finally {
      setIsSyncingCollectedLeadId(null);
    }
  }, [loadCollectedLeadDrafts, selectedItemId]);

  const statusActions = selectedItem ? getLeadWorkItemStatusActions(selectedItem.status) : [];
  const searchKeyword = selectedItem ? getSuggestedTanjiSearchKeyword(selectedItem) : '';
  const searchKeywordFallback = Boolean(selectedItem && !hasConfiguredTanjiSearchKeyword(selectedItem));
  const terminalMessage = selectedItem ? getLeadWorkItemTerminalMessage(selectedItem.status) : null;
  const canSaveLeadCapture = shouldEnableLeadCaptureSave(selectedItem, pastePreviewState.text, pastePreviewState.result);
  const canSaveCollectedLeadDraft = shouldEnableCollectedLeadDraftSave(selectedItem, pastePreviewState.result, collectedLeadDraft);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>获客作业台</h2>
        </div>
      </div>

      <div className="page-body lead-workbench">
        {error && (
          <div className="lead-alert lead-alert-danger">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        {message && !error && (
          <div className="lead-alert lead-alert-success">
            <span>{message}</span>
          </div>
        )}

        <section className="card">
          <div className="lead-section-header">
            <div className="section-title">任务统计</div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { void handleRefreshTasks(); }}
              disabled={isLoading || isUpdating}
            >
              <RefreshCw size={14} />
              {isLoading ? '加载中' : '刷新任务'}
            </button>
          </div>
          <div className="lead-workbench-status-tabs">
            {LEAD_WORKBENCH_STATUS_FILTERS.map(status => (
              <button
                type="button"
                key={status}
                className={`lead-workbench-status-tab ${status === statusFilter ? 'active' : ''}`}
                onClick={() => setStatusFilter(status)}
                disabled={isLoading || isUpdating}
              >
                <span>{status}</span>
                <strong>{counts[status]}</strong>
              </button>
            ))}
          </div>
        </section>

        <div className="lead-workbench-layout">
          <section className="card">
            <div className="section-title">任务列表</div>
            {visibleItems.length === 0 ? (
              <div className="empty-state">{getLeadWorkbenchListEmptyMessage(totalTaskCount, statusFilter)}</div>
            ) : (
              <div className="table-container lead-workbench-table">
                <table>
                  <thead>
                    <tr>
                      <th>company_name</th>
                      <th>city</th>
                      <th>industry</th>
                      <th>work_type</th>
                      <th>lookup_goal</th>
                      <th>status</th>
                      <th>priority</th>
                      <th>tanji_search_keyword</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map(item => (
                      <tr
                        key={item.id}
                        className={`clickable ${item.id === selectedItemId ? 'lead-workbench-selected-row' : ''}`}
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        <td>
                          <div className="import-preview-name">{item.company_name || '-'}</div>
                        </td>
                        <td>{item.city || '-'}</td>
                        <td>{item.industry || '-'}</td>
                        <td><span className="badge badge-info">{item.work_type}</span></td>
                        <td>{item.lookup_goal}</td>
                        <td><span className="badge badge-warning">{item.status}</span></td>
                        <td>{item.priority}</td>
                        <td>{getSuggestedTanjiSearchKeyword(item) || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-title">任务详情</div>
            {!selectedItem ? (
              <div className="empty-state">{getLeadWorkbenchDetailEmptyMessage()}</div>
            ) : (
              <>
                <div className="lead-workbench-search-panel">
                  <div className="lead-workbench-search-copy-zone">
                    <div className="label">探迹搜索词</div>
                    <textarea
                      className="lead-workbench-search-keyword"
                      readOnly
                      value={searchKeyword || '-'}
                      rows={2}
                    />
                    {searchKeywordFallback && (
                      <div className="lead-workbench-search-hint">未配置探迹搜索词，已使用公司名</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => { void handleCopySearchKeyword(); }}
                    disabled={isLoading || isUpdating || !searchKeyword}
                  >
                    <Clipboard size={14} />
                    复制搜索词
                  </button>
                </div>

                {terminalMessage && (
                  <div className="lead-alert lead-alert-info">
                    <span>{terminalMessage}</span>
                  </div>
                )}

                {statusActions.length > 0 && (
                  <div className="lead-workbench-action-row">
                    {statusActions.map(action => (
                      <button
                        type="button"
                        key={action.nextStatus}
                        className="btn btn-sm"
                        onClick={() => { void handleStatusAction(action.nextStatus); }}
                        disabled={isLoading || isUpdating}
                      >
                        {action.icon === 'search' && <Search size={14} />}
                        {action.icon === 'phone-off' && <PhoneOff size={14} />}
                        {action.icon === 'skip' && <SkipForward size={14} />}
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}

                {isLeadPastePreviewVisible(selectedItem) && (
                  <section className="lead-workbench-paste-preview">
                    <div className="lead-section-header">
                      <div className="section-title">粘贴解析预览</div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={handleClearPastePreview}
                        disabled={!pastePreviewState.text && !pastePreviewState.result}
                      >
                        清空粘贴内容
                      </button>
                    </div>
                    <textarea
                      className="lead-workbench-paste-input"
                      value={pastePreviewState.text}
                      onChange={event => {
                        setPastePreviewState({ text: event.target.value, result: null });
                        setCollectedLeadDraft(null);
                      }}
                      placeholder="手动粘贴从探迹复制的文本，仅用于本页解析预览"
                      rows={6}
                    />
                    <div className="lead-workbench-action-row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={handleParsePastePreview}
                        disabled={!pastePreviewState.text.trim()}
                      >
                        解析预览
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { void handleSaveLeadCaptureEvent(); }}
                        disabled={!canSaveLeadCapture || isSavingCapture}
                      >
                        {isSavingCapture ? '保存中' : '保存捕获记录'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { void handleSaveCollectedLeadDraft(); }}
                        disabled={!canSaveCollectedLeadDraft || isSavingCollectedLead}
                      >
                        {isSavingCollectedLead ? '保存中' : '保存为采集线索草稿'}
                      </button>
                    </div>

                    {pastePreviewState.result && (
                      <div className="lead-workbench-paste-result">
                        {!pastePreviewState.result.hasStructuredInfo && (
                          <div className="lead-alert lead-alert-info">
                            <span>{getNoStructuredLeadPastePreviewMessage()}</span>
                          </div>
                        )}
                        <PreviewList label="手机号候选" values={pastePreviewState.result.mobiles} />
                        <PreviewList label="座机候选" values={pastePreviewState.result.tels} />
                        <PreviewList label="URL 候选" values={pastePreviewState.result.urls} />
                        <PreviewList label="邮箱候选" values={pastePreviewState.result.emails} />
                        <PreviewList label="possibleContact / 可能联系人" values={pastePreviewState.result.possibleContact} />
                        <PreviewText label="note / 备注文本" value={pastePreviewState.result.note} />
                        <PreviewText label="raw_text 原文" value={pastePreviewState.result.raw_text} />
                      </div>
                    )}

                    {collectedLeadDraft && (
                      <div className="lead-workbench-draft-form">
                        {collectedLeadDraft.contactNameSuggestion && (
                          <div className="lead-workbench-search-hint">
                            可能联系人建议：{collectedLeadDraft.contactNameSuggestion}
                          </div>
                        )}
                        <DraftInput label="contact_name" field="contact_name" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="position" field="position" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="mobile" field="mobile" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="tel" field="tel" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="website" field="website" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="email" field="email" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} />
                        <DraftInput label="note" field="note" draft={collectedLeadDraft} onChange={setCollectedLeadDraft} multiline />
                      </div>
                    )}
                  </section>
                )}

                {isLeadCaptureHistoryVisible(selectedItem) && (
                  <section className="lead-workbench-capture-history">
                    <div className="section-title">历史捕获记录</div>
                    {captureEvents.length === 0 ? (
                      <div className="empty-state lead-workbench-history-empty">{getLeadCaptureHistoryEmptyMessage()}</div>
                    ) : (
                      <div className="lead-workbench-history-list">
                        {captureEvents.map(event => (
                          <details className="lead-workbench-history-item" key={event.id}>
                            <summary>
                              <span>{event.created_at}</span>
                              <span className="badge badge-info">{event.action}</span>
                              <span>{getLeadCaptureRawTextSummary(event.raw_text)}</span>
                            </summary>
                            <div className="lead-workbench-history-summary">
                              {getLeadCaptureParsedSummary(event.parsed_json)}
                            </div>
                            <PreviewText label="完整 raw_text" value={event.raw_text} />
                            <PreviewText label="完整 parsed_json" value={event.parsed_json} />
                          </details>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {isCollectedLeadDraftHistoryVisible(selectedItem) && (
                  <section className="lead-workbench-capture-history">
                    <div className="section-title">采集线索草稿</div>
                    {collectedLeadDrafts.length === 0 ? (
                      <div className="empty-state lead-workbench-history-empty">{getCollectedLeadDraftHistoryEmptyMessage()}</div>
                    ) : (
                      <div className="lead-workbench-history-list">
                        {collectedLeadDrafts.map(draft => {
                          const createCustomerLabel = getCollectedLeadCreateCustomerActionLabel(draft);
                          const createCustomerStateLabel = getCollectedLeadCreateCustomerStateLabel(draft);
                          const isCurrentDraftSyncing = isSyncingCollectedLeadId === draft.id;

                          return (
                            <details className="lead-workbench-history-item" key={draft.id}>
                              <summary className="lead-workbench-collected-summary">
                                <span>{draft.created_at}</span>
                                <span className="badge badge-info">{draft.sync_status}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.contact_name)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.position)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.mobile)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.tel)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.website)}</span>
                                <span>{getCollectedLeadDraftDisplayValue(draft.email)}</span>
                                <span>{getCollectedLeadDraftNoteSummary(draft.note)}</span>
                              </summary>
                              <PreviewText label="company_name" value={draft.company_name || ''} />
                              <PreviewText label="完整 raw_text" value={draft.raw_text || ''} />
                              <PreviewText label="完整 note" value={draft.note || ''} />
                              <PreviewText label="work_item_id" value={draft.work_item_id || ''} />
                              <PreviewText label="import_row_id" value={draft.import_row_id || ''} />
                              <PreviewText label="customer_id" value={draft.customer_id || ''} />
                              <PreviewText label="created_customer_id" value={draft.created_customer_id || ''} />
                              <div className="lead-workbench-collected-actions">
                                {createCustomerLabel ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-primary"
                                    onClick={() => { void handleSyncCollectedLeadCreateCustomer(draft); }}
                                    disabled={Boolean(isSyncingCollectedLeadId)}
                                  >
                                    {isCurrentDraftSyncing ? '创建中' : createCustomerLabel}
                                  </button>
                                ) : (
                                  createCustomerStateLabel && (
                                    <span className="lead-workbench-collected-state">{createCustomerStateLabel}</span>
                                  )
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

                <div className="lead-workbench-detail-grid">
                  <DetailItem label="id" value={selectedItem.id} />
                  <DetailItem label="import_row_id" value={selectedItem.import_row_id} />
                  <DetailItem label="customer_id" value={selectedItem.customer_id} />
                  <DetailItem label="company_name" value={selectedItem.company_name} />
                  <DetailItem label="city" value={selectedItem.city} />
                  <DetailItem label="industry" value={selectedItem.industry} />
                  <DetailItem label="work_type" value={selectedItem.work_type} />
                  <DetailItem label="lookup_goal" value={selectedItem.lookup_goal} />
                  <DetailItem label="tanji_search_keyword" value={searchKeyword} />
                  <DetailItem label="status" value={selectedItem.status} />
                  <DetailItem label="note" value={selectedItem.note} />
                  <DetailItem label="created_at" value={selectedItem.created_at} />
                  <DetailItem label="updated_at" value={selectedItem.updated_at} />
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="detail-item">
      <div className="label">{label}</div>
      <div className="value">{value ?? '-'}</div>
    </div>
  );
}

function PreviewList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="lead-workbench-preview-row">
      <div className="label">{label}</div>
      <div className="lead-workbench-preview-values">
        {values.length === 0 ? '-' : values.map(value => (
          <span className="badge badge-info" key={value}>{value}</span>
        ))}
      </div>
    </div>
  );
}

function PreviewText({ label, value }: { label: string; value: string }) {
  return (
    <div className="lead-workbench-preview-row">
      <div className="label">{label}</div>
      <pre className="lead-workbench-preview-text">{value || '-'}</pre>
    </div>
  );
}

function DraftInput({
  label,
  field,
  draft,
  onChange,
  multiline = false,
}: {
  label: string;
  field: keyof Pick<CollectedLeadDraftForm, 'contact_name' | 'position' | 'mobile' | 'tel' | 'website' | 'email' | 'note'>;
  draft: CollectedLeadDraftForm;
  onChange: (next: CollectedLeadDraftForm) => void;
  multiline?: boolean;
}) {
  const value = draft[field];
  const handleChange = (nextValue: string) => {
    onChange({ ...draft, [field]: nextValue });
  };

  return (
    <label className="lead-workbench-draft-field">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={event => handleChange(event.target.value)} rows={3} />
      ) : (
        <input value={value} onChange={event => handleChange(event.target.value)} />
      )}
    </label>
  );
}
