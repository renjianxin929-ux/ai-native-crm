import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, Save } from 'lucide-react';

import { getDb } from '../lib/db';
import {
  importLeadRowsToBatch,
  normalizeLeadImportRows,
  type LeadImportInputRow,
} from '../lib/leadWorkbench/importer';
import type { LeadBatchType, LeadImportDecision } from '../lib/leadWorkbench/types';

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

const BATCH_TYPES: LeadBatchType[] = ['AI_DAILY', 'MANUAL', 'EXPO', 'WECHAT', 'OTHER'];

export function buildLeadImportPreview(jsonText: string): LeadImportPreviewResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { rows: [], inputRows: [], error: 'JSON 解析失败，请粘贴合法的 JSON 数组。' };
  }

  if (!Array.isArray(parsed)) {
    return { rows: [], inputRows: [], error: 'JSON 内容必须是数组。' };
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
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return { rows, inputRows, error: null };
}

export default function LeadImportCenterPage() {
  const [batchName, setBatchName] = useState('');
  const [batchType, setBatchType] = useState<LeadBatchType>('AI_DAILY');
  const [jsonText, setJsonText] = useState('');
  const [preview, setPreview] = useState<LeadImportPreviewResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSummary, setSavedSummary] = useState<SavedBatchSummary | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const hasPreviewErrors = preview?.rows.some(row => row.error) ?? false;
  const decisionCounts = useMemo(() => countDecisions(preview?.rows ?? []), [preview]);

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
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
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

            <div className="form-group">
              <label htmlFor="lead-json-input">JSON 数组</label>
              <textarea
                id="lead-json-input"
                className="lead-json-input"
                value={jsonText}
                onChange={event => setJsonText(event.target.value)}
                placeholder={`[
  {"company_name":"佛山样板客户","mobile":"13800138000","score":88,"grade":"S"},
  {"company_name":"广州待查公司","score":82,"city":"广州"}
]`}
              />
            </div>

            <div className="btn-group">
              <button type="button" className="btn btn-primary" onClick={handleParsePreview}>
                <Eye size={16} />
                解析预览
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleSaveBatch}
                disabled={!preview || Boolean(preview.error) || hasPreviewErrors || isSaving}
              >
                <Save size={16} />
                {isSaving ? '保存中' : '保存为导入批次'}
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
                  <span>保存成功</span>
                </div>
                <div className="detail-item">
                  <div className="label">batch id</div>
                  <div className="value">{savedSummary.batchId}</div>
                </div>
                <div className="detail-item">
                  <div className="label">总行数</div>
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
              {Object.entries(decisionCounts).map(([decision, count]) => (
                <div className="summary-card" key={decision}>
                  <div className="count">{count}</div>
                  <div className="label">{decision}</div>
                </div>
              ))}
            </div>
            <ImportPreviewTable rows={preview.rows} />
          </>
        )}
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

function DecisionCountList({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="lead-decision-counts">
      {Object.entries(counts).map(([decision, count]) => (
        <span key={decision} className="badge badge-info">{decision}: {count}</span>
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
