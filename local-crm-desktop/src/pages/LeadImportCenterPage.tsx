import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, FileJson, List, Play, Save } from 'lucide-react';

import { getDb, type DatabaseLike } from '../lib/db';
import {
  listLeadImportBatches,
  listLeadImportRowsByBatchId,
} from '../lib/leadWorkbench/db';
import { executeLeadImportBatchDecisions, type LeadDecisionExecutionResult } from '../lib/leadWorkbench/decision';
import {
  importLeadRowsToBatch,
  normalizeLeadImportRows,
  type LeadImportInputRow,
} from '../lib/leadWorkbench/importer';
import type {
  LeadBatchType,
  LeadDecisionStatus,
  LeadImportBatch,
  LeadImportDecision,
  LeadImportRow,
} from '../lib/leadWorkbench/types';

type PreviewRow = {
  rowIndex: number;
  company_name: string | null;
  city: string | null;
  industry: string | null;
  mobile: string | null;
  tel: string | null;
  score: number | null;
  grade: string | null;
  decision: LeadImportDecision | null;
  error: string | null;
};

type LeadImportPreviewResult = {
  rows: PreviewRow[];
  inputRows: LeadImportInputRow[];
  error: string | null;
};

type SavedBatchSummary = {
  batchId: string;
  totalRows: number;
  decisionCounts: Record<string, number>;
};

type LeadImportExecutionFailure = {
  company_name: string | null;
  error_message: string;
};

type LeadImportExecutionSummary = {
  doneCount: number;
  failedCount: number;
  createdCustomerCount: number;
  createdWorkItemCount: number;
  failures: LeadImportExecutionFailure[];
};

type LeadImportExecutionResult =
  | { status: 'CANCELLED' }
  | { status: 'EXECUTED'; rows: LeadImportRow[]; summary: LeadImportExecutionSummary };

const BATCH_TYPES: LeadBatchType[] = ['AI_DAILY', 'MANUAL', 'EXPO', 'WECHAT', 'OTHER'];
const DECISIONS: LeadImportDecision[] = ['DIRECT_TO_CRM', 'CRM_WITH_LOOKUP', 'LOOKUP_FIRST', 'RESERVE', 'IGNORE'];
const DECISION_STATUSES: LeadDecisionStatus[] = ['PENDING', 'EXECUTING', 'DONE', 'FAILED'];
const SUPPORTED_FIELDS = [
  'company_name',
  'city',
  'industry',
  'website',
  'contact_name',
  'mobile',
  'tel',
  'email',
  'score',
  'grade',
  'tanji_search_keyword',
  'matching_reason',
  'priority_contact_role',
  'source_evidence',
];

export const LEAD_IMPORT_SAMPLE_JSON = JSON.stringify([
  {
    company_name: '佛山有电话样例',
    city: '佛山',
    industry: '装备制造',
    mobile: '13800138000',
    score: 62,
    grade: 'A',
    matching_reason: '有手机号，默认 DIRECT_TO_CRM',
  },
  {
    company_name: '广州高分待查样例',
    city: '广州',
    industry: '照明工程',
    score: 86,
    grade: 'S',
    tanji_search_keyword: '广州高分待查样例',
    matching_reason: '高分无电话，默认 CRM_WITH_LOOKUP',
  },
  {
    company_name: '中山优先查询样例',
    city: '中山',
    industry: '五金',
    score: 75,
    grade: 'B',
    matching_reason: '70-79 分无电话，默认 LOOKUP_FIRST',
  },
], null, 2);

export const LEAD_IMPORT_CENTER_ACTION_LABELS = [
  '填入示例 JSON',
  '解析预览',
  '保存为导入批次',
  '执行分流，会创建 CRM 客户/获客任务',
];

export function buildLeadImportPreview(jsonText: string): LeadImportPreviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { rows: [], inputRows: [], error: `JSON 解析失败。具体原因：${reason}` };
  }

  if (!Array.isArray(parsed)) {
    return { rows: [], inputRows: [], error: '必须是 JSON 数组。' };
  }

  if (parsed.length === 0) {
    return { rows: [], inputRows: [], error: '至少需要一条数据。' };
  }

  const inputRows = parsed.map(row => (isRecord(row) ? row as LeadImportInputRow : {}));
  const rows = inputRows.map((inputRow, index) => {
    try {
      const normalized = normalizeLeadImportRows([inputRow])[0];
      return {
        rowIndex: index,
        company_name: normalized.company_name,
        city: normalized.city,
        industry: normalized.industry,
        mobile: normalized.mobile,
        tel: normalized.tel,
        score: normalized.score,
        grade: normalized.grade,
        decision: normalized.decision,
        error: null,
      };
    } catch (error) {
      return {
        rowIndex: index,
        company_name: stringOrNull(inputRow.company_name),
        city: stringOrNull(inputRow.city),
        industry: stringOrNull(inputRow.industry),
        mobile: stringOrNull(inputRow.mobile),
        tel: stringOrNull(inputRow.tel),
        score: numberOrNull(inputRow.score),
        grade: stringOrNull(inputRow.grade),
        decision: null,
        error: `第 ${index + 1} 行：${formatRowError(error)}`,
      };
    }
  });

  return { rows, inputRows, error: null };
}

export function buildLeadImportBatchStats(rows: Array<Pick<LeadImportRow, 'decision' | 'decision_status'>>) {
  return {
    decisionCounts: DECISIONS.reduce<Record<LeadImportDecision, number>>((counts, decision) => {
      counts[decision] = rows.filter(row => row.decision === decision).length;
      return counts;
    }, {} as Record<LeadImportDecision, number>),
    statusCounts: DECISION_STATUSES.reduce<Record<LeadDecisionStatus, number>>((counts, status) => {
      counts[status] = rows.filter(row => row.decision_status === status).length;
      return counts;
    }, {} as Record<LeadDecisionStatus, number>),
  };
}

export function buildLeadImportSaveConfirmation(input: {
  batchName: string;
  batchType: LeadBatchType;
  rows: PreviewRow[];
}) {
  const decisionCounts = countDecisions(input.rows);
  const lines = [
    '确认保存导入批次？',
    `batch_name: ${input.batchName}`,
    `batch_type: ${input.batchType}`,
    `总行数: ${input.rows.length}`,
    ...DECISIONS.map(decision => `${decision}: ${decisionCounts[decision] ?? 0}`),
    '',
    '保存只进入 lead_import_batches / lead_import_rows，不会创建 CRM 客户。',
  ];
  return { message: lines.join('\n') };
}

export function getLeadImportBatchExecutionState(rows: Pick<LeadImportRow, 'decision_status'>[]) {
  const executableRows = rows.filter(row => row.decision_status === 'PENDING' || row.decision_status === 'FAILED').length;
  return {
    canExecute: executableRows > 0,
    label: executableRows > 0 ? LEAD_IMPORT_CENTER_ACTION_LABELS[3] : '已完成/不可重复执行',
    executableRows,
  };
}

export function buildLeadImportExecutionConfirmation(
  batch: LeadImportBatch,
  rows: Array<Pick<LeadImportRow, 'decision' | 'decision_status'>>,
) {
  const stats = buildLeadImportBatchStats(rows);
  const lines = [
    '确认执行导入分流？',
    `batch_name: ${batch.batch_name}`,
    `total_rows: ${batch.total_rows}`,
    ...DECISIONS.map(decision => `${decision}: ${stats.decisionCounts[decision]}`),
    '',
    '执行后可能创建 CRM 客户和获客任务。',
  ];
  return { message: lines.join('\n') };
}

export function buildLeadImportExecutionSummary(
  beforeRows: Pick<LeadImportRow, 'id' | 'created_customer_id' | 'created_work_item_id'>[],
  afterRows: Pick<LeadImportRow, 'id' | 'company_name' | 'decision_status' | 'created_customer_id' | 'created_work_item_id' | 'error_message'>[],
): LeadImportExecutionSummary {
  const beforeById = new Map(beforeRows.map(row => [row.id, row]));
  return {
    doneCount: afterRows.filter(row => row.decision_status === 'DONE').length,
    failedCount: afterRows.filter(row => row.decision_status === 'FAILED').length,
    createdCustomerCount: afterRows.filter(row => {
      const before = beforeById.get(row.id);
      return Boolean(row.created_customer_id) && row.created_customer_id !== before?.created_customer_id;
    }).length,
    createdWorkItemCount: afterRows.filter(row => {
      const before = beforeById.get(row.id);
      return Boolean(row.created_work_item_id) && row.created_work_item_id !== before?.created_work_item_id;
    }).length,
    failures: afterRows
      .filter(row => row.decision_status === 'FAILED')
      .slice(0, 10)
      .map(row => ({
        company_name: row.company_name,
        error_message: row.error_message || '未知错误',
      })),
  };
}

export async function executeLeadImportBatchFromCenter(input: {
  db: DatabaseLike;
  batch: LeadImportBatch;
  rows: LeadImportRow[];
  confirm: (message: string) => boolean;
  execute?: (db: DatabaseLike, batchId: string) => Promise<LeadDecisionExecutionResult[]>;
  loadRows?: (db: DatabaseLike, batchId: string) => Promise<LeadImportRow[]>;
}): Promise<LeadImportExecutionResult> {
  const confirmation = buildLeadImportExecutionConfirmation(input.batch, input.rows);
  if (!input.confirm(confirmation.message)) {
    return { status: 'CANCELLED' };
  }

  const execute = input.execute ?? executeLeadImportBatchDecisions;
  const loadRows = input.loadRows ?? listLeadImportRowsByBatchId;
  await execute(input.db, input.batch.id);
  const refreshedRows = await loadRows(input.db, input.batch.id);
  return {
    status: 'EXECUTED',
    rows: refreshedRows,
    summary: buildLeadImportExecutionSummary(input.rows, refreshedRows),
  };
}

export default function LeadImportCenterPage() {
  const [batchName, setBatchName] = useState('');
  const [batchType, setBatchType] = useState<LeadBatchType>('AI_DAILY');
  const [jsonText, setJsonText] = useState('');
  const [preview, setPreview] = useState<LeadImportPreviewResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<SavedBatchSummary | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [batches, setBatches] = useState<LeadImportBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<LeadImportRow[]>([]);
  const [batchListError, setBatchListError] = useState<string | null>(null);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionSummary, setExecutionSummary] = useState<LeadImportExecutionSummary | null>(null);

  const hasPreviewErrors = preview?.rows.some(row => row.error) ?? false;
  const decisionCounts = useMemo(() => countDecisions(preview?.rows ?? []), [preview]);
  const selectedBatch = batches.find(batch => batch.id === selectedBatchId) ?? null;
  const selectedBatchStats = useMemo(() => buildLeadImportBatchStats(selectedRows), [selectedRows]);
  const executionState = useMemo(() => getLeadImportBatchExecutionState(selectedRows), [selectedRows]);

  const loadBatches = useCallback(async () => {
    setIsLoadingBatches(true);
    setBatchListError(null);
    try {
      const db = await getDb();
      setBatches(await listLeadImportBatches(db));
    } catch (error) {
      setBatchListError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingBatches(false);
    }
  }, []);

  const handleSelectBatch = useCallback(async (batchId: string) => {
    setSelectedBatchId(batchId);
    setBatchListError(null);
    setExecutionError(null);
    setExecutionSummary(null);
    try {
      const db = await getDb();
      setSelectedRows(await listLeadImportRowsByBatchId(db, batchId));
    } catch (error) {
      setSelectedRows([]);
      setBatchListError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const handleFillSample = () => {
    setJsonText(LEAD_IMPORT_SAMPLE_JSON);
    setPreview(null);
    setSaveError(null);
    setSavedSummary(null);
  };

  const handleParsePreview = () => {
    setSaveError(null);
    setSavedSummary(null);
    setPreview(buildLeadImportPreview(jsonText));
  };

  const handleSaveBatch = async () => {
    if (!preview || preview.error) return;
    if (hasPreviewErrors) {
      setSaveError('存在 company_name 为空或格式错误的行，请修正后再保存。');
      return;
    }
    if (!batchName.trim()) {
      setSaveError('请输入 batch_name。');
      return;
    }

    const confirmation = buildLeadImportSaveConfirmation({
      batchName: batchName.trim(),
      batchType,
      rows: preview.rows,
    });
    if (!window.confirm(confirmation.message)) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSavedSummary(null);

    try {
      const db = await getDb();
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: batchName.trim(), batch_type: batchType, source_label: null },
        preview.inputRows,
      );
      setSavedSummary({
        batchId: imported.batch.id,
        totalRows: imported.rows.length,
        decisionCounts: imported.rows.reduce<Record<string, number>>((counts, row) => {
          counts[row.decision] = (counts[row.decision] ?? 0) + 1;
          return counts;
        }, {}),
      });
      await loadBatches();
      await handleSelectBatch(imported.batch.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleExecuteBatch = async () => {
    if (!selectedBatch || !executionState.canExecute) return;

    setIsExecuting(true);
    setExecutionError(null);
    setExecutionSummary(null);

    try {
      const db = await getDb();
      const result = await executeLeadImportBatchFromCenter({
        db,
        batch: selectedBatch,
        rows: selectedRows,
        confirm: message => window.confirm(message),
      });
      if (result.status === 'EXECUTED') {
        setSelectedRows(result.rows);
        setExecutionSummary(result.summary);
      }
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h2>导入分流中心</h2>
        </div>
      </div>

      <div className="page-body lead-import-center">
        <div className="lead-import-form">
          <section className="card">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="lead-batch-name">batch_name</label>
                <input
                  id="lead-batch-name"
                  value={batchName}
                  onChange={event => setBatchName(event.target.value)}
                  placeholder="例如：2026-06-14 每日 AI 名单"
                />
              </div>
              <div className="form-group">
                <label htmlFor="lead-batch-type">batch_type</label>
                <select
                  id="lead-batch-type"
                  value={batchType}
                  onChange={event => setBatchType(event.target.value as LeadBatchType)}
                >
                  {BATCH_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="lead-input-help">
              <div className="lead-input-help-title">JSON 字段支持</div>
              <div className="lead-field-list">
                {SUPPORTED_FIELDS.map(field => (
                  <span key={field} className="badge badge-info">{field}</span>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="lead-json-input">JSON 数组</label>
              <textarea
                id="lead-json-input"
                className="lead-json-input"
                value={jsonText}
                onChange={event => setJsonText(event.target.value)}
                placeholder={LEAD_IMPORT_SAMPLE_JSON}
              />
            </div>

            <div className="btn-group">
              <button type="button" className="btn" onClick={handleFillSample}>
                <FileJson size={16} />
                {LEAD_IMPORT_CENTER_ACTION_LABELS[0]}
              </button>
              <button type="button" className="btn btn-primary" onClick={handleParsePreview}>
                <Eye size={16} />
                {LEAD_IMPORT_CENTER_ACTION_LABELS[1]}
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleSaveBatch}
                disabled={!preview || Boolean(preview.error) || hasPreviewErrors || isSaving}
              >
                <Save size={16} />
                {isSaving ? '保存中' : LEAD_IMPORT_CENTER_ACTION_LABELS[2]}
              </button>
            </div>
          </section>

          <section className="card">
            <div className="section-title">保存结果</div>
            {!savedSummary && !saveError && (
              <div className="empty-state">尚未保存导入批次</div>
            )}
            {saveError && (
              <div className="lead-alert lead-alert-danger">
                <AlertCircle size={16} />
                <span>{saveError}</span>
              </div>
            )}
            {savedSummary && (
              <div className="lead-save-summary">
                <div className="lead-alert lead-alert-success">
                  <CheckCircle2 size={16} />
                  <span>保存成功，尚未执行分流。</span>
                </div>
                <div className="detail-item">
                  <div className="label">batch id</div>
                  <div className="value">{savedSummary.batchId}</div>
                </div>
                <div className="detail-item">
                  <div className="label">total rows</div>
                  <div className="value">{savedSummary.totalRows}</div>
                </div>
                <DecisionCountList counts={savedSummary.decisionCounts} />
              </div>
            )}
          </section>
        </div>

        {preview?.error && (
          <div className="lead-alert lead-alert-danger">
            <AlertCircle size={16} />
            <span>{preview.error}</span>
          </div>
        )}

        {preview && !preview.error && (
          <>
            <div className="summary-cards">
              <div className="summary-card">
                <div className="count">{preview.rows.length}</div>
                <div className="label">预览行数</div>
              </div>
              {DECISIONS.map(decision => (
                <div className="summary-card" key={decision}>
                  <div className="count">{decisionCounts[decision] ?? 0}</div>
                  <div className="label">{decision}</div>
                </div>
              ))}
            </div>
            <ImportPreviewTable rows={preview.rows} />
          </>
        )}

        <div className="lead-batch-browser">
          <section className="card">
            <div className="lead-section-header">
              <div className="section-title">已保存批次</div>
              <button type="button" className="btn btn-sm" onClick={() => { void loadBatches(); }} disabled={isLoadingBatches}>
                <List size={14} />
                {isLoadingBatches ? '加载中' : '刷新'}
              </button>
            </div>
            {batchListError && (
              <div className="lead-alert lead-alert-danger">
                <AlertCircle size={16} />
                <span>{batchListError}</span>
              </div>
            )}
            {batches.length === 0 && !batchListError && (
              <div className="empty-state">暂无导入批次，请先粘贴 JSON 名单并保存</div>
            )}
            {batches.length > 0 && (
              <div className="lead-batch-list">
                {batches.map(batch => (
                  <button
                    type="button"
                    key={batch.id}
                    className={`lead-batch-list-item ${batch.id === selectedBatchId ? 'active' : ''}`}
                    onClick={() => { void handleSelectBatch(batch.id); }}
                  >
                    <span className="lead-batch-name">{batch.batch_name}</span>
                    <span>{batch.batch_type}</span>
                    <span>{batch.total_rows} 行</span>
                    <span>{formatDateTime(batch.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="lead-section-header">
              <div className="section-title">批次明细</div>
              {selectedBatch && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { void handleExecuteBatch(); }}
                  disabled={!executionState.canExecute || isExecuting}
                >
                  <Play size={14} />
                  {isExecuting ? '执行中' : executionState.label}
                </button>
              )}
            </div>
            {!selectedBatch && (
              <div className="empty-state">请选择一个批次查看明细</div>
            )}
            {selectedBatch && (
              <>
                <div className="lead-selected-batch-meta">
                  <span>{selectedBatch.batch_name}</span>
                  <span>{selectedBatch.batch_type}</span>
                  <span>{selectedBatch.total_rows} 行</span>
                  <span>{formatDateTime(selectedBatch.created_at)}</span>
                </div>
                <StatsStrip title="decision 统计" counts={selectedBatchStats.decisionCounts} />
                <StatsStrip title="decision_status 统计" counts={selectedBatchStats.statusCounts} />
                {executionError && (
                  <div className="lead-alert lead-alert-danger">
                    <AlertCircle size={16} />
                    <span>{executionError}</span>
                  </div>
                )}
                {executionSummary && (
                  <div className="lead-execution-summary">
                    <span className="badge badge-success">DONE: {executionSummary.doneCount}</span>
                    <span className="badge badge-danger">FAILED: {executionSummary.failedCount}</span>
                    <span className="badge badge-info">created customers: {executionSummary.createdCustomerCount}</span>
                    <span className="badge badge-info">created work items: {executionSummary.createdWorkItemCount}</span>
                  </div>
                )}
                {executionSummary && executionSummary.failures.length > 0 && (
                  <div className="lead-failure-list">
                    <div className="lead-input-help-title">失败明细（前 10 条）</div>
                    {executionSummary.failures.map((failure, index) => (
                      <div className="lead-failure-item" key={`${failure.company_name ?? 'unknown'}-${index}`}>
                        <span>{failure.company_name || '-'}</span>
                        <span>{failure.error_message}</span>
                      </div>
                    ))}
                  </div>
                )}
                <BatchRowsTable rows={selectedRows} />
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function ImportPreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="table-container lead-preview-table">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>company_name</th>
            <th>city</th>
            <th>industry</th>
            <th>mobile/tel</th>
            <th>score</th>
            <th>grade</th>
            <th>decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.rowIndex} className={row.error ? 'lead-preview-error-row' : ''}>
              <td>{row.rowIndex + 1}</td>
              <td>
                <div className="import-preview-name">{row.company_name || '-'}</div>
                {row.error && <div className="lead-row-error">{row.error}</div>}
              </td>
              <td>{row.city || '-'}</td>
              <td>{row.industry || '-'}</td>
              <td>{row.mobile || row.tel || '-'}</td>
              <td>{row.score ?? '-'}</td>
              <td>{row.grade || '-'}</td>
              <td>
                {row.decision ? (
                  <span className="badge badge-info">{row.decision}</span>
                ) : (
                  <span className="badge badge-danger">ERROR</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchRowsTable({ rows }: { rows: LeadImportRow[] }) {
  return (
    <div className="table-container lead-batch-rows-table">
      <table>
        <thead>
          <tr>
            <th>row_index</th>
            <th>company_name</th>
            <th>city</th>
            <th>industry</th>
            <th>score</th>
            <th>grade</th>
            <th>decision</th>
            <th>decision_status</th>
            <th>created_customer_id</th>
            <th>created_work_item_id</th>
            <th>error_message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.row_index}</td>
              <td>
                <div className="import-preview-name">{row.company_name}</div>
              </td>
              <td>{row.city || '-'}</td>
              <td>{row.industry || '-'}</td>
              <td>{row.score ?? '-'}</td>
              <td>{row.grade || '-'}</td>
              <td><span className="badge badge-info">{row.decision}</span></td>
              <td><span className="badge badge-warning">{row.decision_status}</span></td>
              <td>{row.created_customer_id || '-'}</td>
              <td>{row.created_work_item_id || '-'}</td>
              <td>{row.error_message || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecisionCountList({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="lead-decision-counts">
      {DECISIONS.map(decision => (
        <span key={decision} className="badge badge-info">{decision}: {counts[decision] ?? 0}</span>
      ))}
    </div>
  );
}

function StatsStrip({ title, counts }: { title: string; counts: Record<string, number> }) {
  return (
    <div className="lead-stats-strip">
      <span className="lead-stats-title">{title}</span>
      {Object.entries(counts).map(([key, count]) => (
        <span key={key} className="badge badge-info">{key}: {count}</span>
      ))}
    </div>
  );
}

function countDecisions(rows: PreviewRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    if (!row.decision) return counts;
    counts[row.decision] = (counts[row.decision] ?? 0) + 1;
    return counts;
  }, {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatRowError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('company_name')) {
    return 'company_name 不能为空。';
  }
  return message;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN');
}
