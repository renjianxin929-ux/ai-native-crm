import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clipboard, PhoneOff, RefreshCw, Search, SkipForward } from 'lucide-react';

import { getDb } from '../lib/db';
import {
  getLeadWorkItemStatusCounts,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
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

export default function LeadWorkbenchPage() {
  const [statusFilter, setStatusFilter] = useState<LeadWorkStatus>('TODO');
  const [items, setItems] = useState<LeadWorkItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<LeadWorkStatus, number>>(emptyStatusCounts);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const statusActions = selectedItem ? getLeadWorkItemStatusActions(selectedItem.status) : [];
  const searchKeyword = selectedItem ? getSuggestedTanjiSearchKeyword(selectedItem) : '';
  const searchKeywordFallback = Boolean(selectedItem && !hasConfiguredTanjiSearchKeyword(selectedItem));
  const terminalMessage = selectedItem ? getLeadWorkItemTerminalMessage(selectedItem.status) : null;

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
