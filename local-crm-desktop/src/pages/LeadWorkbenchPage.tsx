import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clipboard, PhoneOff, RefreshCw, Search, SkipForward } from 'lucide-react';

import { getDb } from '../lib/db';
import {
  insertLeadCaptureEvent,
  listLeadCaptureEventsByWorkItemId,
  type LeadCaptureEvent,
} from '../lib/leadWorkbench/captureEvents';
import {
  getLeadWorkItemStatusCounts,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { parseLeadContactText } from '../lib/leadWorkbench/parser';
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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pastePreviewState, setPastePreviewState] = useState<LeadPastePreviewState>(getEmptyLeadPastePreviewState);
  const [captureEvents, setCaptureEvents] = useState<LeadCaptureEvent[]>([]);

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
  }, [selectedItemId]);

  const loadCaptureEvents = useCallback(async (workItemId: string) => {
    const db = await getDb();
    const events = await listLeadCaptureEventsByWorkItemId(db, workItemId);
    setCaptureEvents(events);
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
    setPastePreviewState(current => ({
      ...current,
      result: buildLeadPastePreviewResult(current.text),
    }));
  }, []);

  const handleClearPastePreview = useCallback(() => {
    setPastePreviewState(getEmptyLeadPastePreviewState());
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

  const statusActions = selectedItem ? getLeadWorkItemStatusActions(selectedItem.status) : [];
  const searchKeyword = selectedItem ? getSuggestedTanjiSearchKeyword(selectedItem) : '';
  const searchKeywordFallback = Boolean(selectedItem && !hasConfiguredTanjiSearchKeyword(selectedItem));
  const terminalMessage = selectedItem ? getLeadWorkItemTerminalMessage(selectedItem.status) : null;
  const canSaveLeadCapture = shouldEnableLeadCaptureSave(selectedItem, pastePreviewState.text, pastePreviewState.result);

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
                      onChange={event => setPastePreviewState({ text: event.target.value, result: null })}
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
