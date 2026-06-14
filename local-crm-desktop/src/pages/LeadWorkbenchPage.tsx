import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { getDb } from '../lib/db';
import {
  getLeadWorkItemStatusCounts,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
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

export const LEAD_WORKBENCH_FORBIDDEN_ACTION_LABELS = [
  ['复制', '搜索词'].join(''),
  ['标记', '无电话'].join(''),
  ['跳', '过'].join(''),
  ['完', '成'].join(''),
  ['粘贴', '解析'].join(''),
];

export function filterLeadWorkItemsByStatus(
  items: LeadWorkItem[],
  status: LeadWorkStatus,
): LeadWorkItem[] {
  return items.filter(item => item.status === status);
}

export function getSuggestedTanjiSearchKeyword(item: Pick<LeadWorkItem, 'tanji_search_keyword' | 'company_name'>): string {
  return item.tanji_search_keyword || item.company_name || '';
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

export default function LeadWorkbenchPage() {
  const [statusFilter, setStatusFilter] = useState<LeadWorkStatus>('TODO');
  const [items, setItems] = useState<LeadWorkItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<LeadWorkStatus, number>>(emptyStatusCounts);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedItemId) || null,
    [items, selectedItemId],
  );

  const loadItems = useCallback(async (status: LeadWorkStatus) => {
    setIsLoading(true);
    setError(null);
    try {
      const db = await getDb();
      const [nextItems, nextCounts] = await Promise.all([
        listLeadWorkItemsByStatus(db, status),
        getLeadWorkItemStatusCounts(db),
      ]);
      setItems(nextItems);
      setCounts(nextCounts);
      setSelectedItemId(current => {
        if (current && nextItems.some(item => item.id === current)) return current;
        return nextItems[0]?.id ?? null;
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

        <section className="card">
          <div className="lead-section-header">
            <div className="section-title">任务统计</div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { void loadItems(statusFilter); }}
              disabled={isLoading}
            >
              <RefreshCw size={14} />
              {isLoading ? '加载中' : '刷新'}
            </button>
          </div>
          <div className="lead-workbench-status-tabs">
            {LEAD_WORKBENCH_STATUS_FILTERS.map(status => (
              <button
                type="button"
                key={status}
                className={`lead-workbench-status-tab ${status === statusFilter ? 'active' : ''}`}
                onClick={() => setStatusFilter(status)}
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
            {items.length === 0 ? (
              <div className="empty-state">当前状态下暂无获客任务</div>
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
                    {items.map(item => (
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
              <div className="empty-state">请选择一个任务查看详情</div>
            ) : (
              <div className="lead-workbench-detail-grid">
                <DetailItem label="id" value={selectedItem.id} />
                <DetailItem label="import_row_id" value={selectedItem.import_row_id} />
                <DetailItem label="customer_id" value={selectedItem.customer_id} />
                <DetailItem label="company_name" value={selectedItem.company_name} />
                <DetailItem label="city" value={selectedItem.city} />
                <DetailItem label="industry" value={selectedItem.industry} />
                <DetailItem label="work_type" value={selectedItem.work_type} />
                <DetailItem label="lookup_goal" value={selectedItem.lookup_goal} />
                <DetailItem label="tanji_search_keyword" value={getSuggestedTanjiSearchKeyword(selectedItem)} />
                <DetailItem label="status" value={selectedItem.status} />
                <DetailItem label="note" value={selectedItem.note} />
                <DetailItem label="created_at" value={selectedItem.created_at} />
                <DetailItem label="updated_at" value={selectedItem.updated_at} />
              </div>
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
