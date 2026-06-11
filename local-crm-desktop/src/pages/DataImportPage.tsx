import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, XCircle, SkipForward, RefreshCw, Download, FileText, Users } from 'lucide-react';
import {
  parseExcelFile,
  computeImportStats,
  buildImportableRecord,
  executeImport,
  exportFailuresAsCSV,
} from '../lib/importer';
import type {
  FieldMapping,
  ImportableCrmField,
  ImportPreview,
  ImportStats,
  ImportResult,
  DuplicateMode,
} from '../lib/importer';
import type { Customer } from '../lib/types';

type Step = 'select' | 'parsing' | 'preview' | 'importing' | 'result';

interface Props {
  customers: Customer[];
  onRefresh: () => void;
}

const FIELD_LABELS: Record<ImportableCrmField, string> = {
  name: '客户名称',
  customer_grade: '客户等级',
  wechat_id: '微信号',
  phone_number: '手机号',
  is_key_decision_maker: '是否关键KP',
  wechat_search_status: '微信搜索状态',
  wechat_add_status: '微信添加状态',
  intent_level: '意向度',
  phone_feedback: '电话反馈',
  next_follow_up_at: '下次跟进时间',
  website: '官网',
  region: '城市/区域',
  industry: '行业',
  contact_person: '联系人',
  email: '邮箱',
  address: '地址',
  pitch_angle: '推荐切入点',
  qualification_reason: '判断原因',
  source: '来源',
  notes: '备注',
};

export default function DataImportPage({ customers, onRefresh }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('select');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<FieldMapping[]>([]);
  const [mode, setMode] = useState<DuplicateMode>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo<ImportStats | null>(() => {
    if (!preview) return null;
    return computeImportStats(preview.rows, preview.headers, mapping, customers);
  }, [preview, mapping, customers]);

  const hasNameMapping = mapping.some(m => m.crmField === 'name');
  const mappedFields = useMemo(() => mapping.filter(m => m.crmField), [mapping]);
  const mappedFieldCount = mappedFields.length;
  const noteFieldCount = mappedFields.filter(m => m.crmField === 'notes').length;

  const previewRecords = useMemo(() => {
    if (!preview) return [];
    return preview.rows.slice(0, 20).map((row, index) => ({
      index: index + 1,
      record: buildImportableRecord(row, preview.headers, mapping).record,
    }));
  }, [preview, mapping]);

  function reset() {
    setStep('select');
    setPreview(null);
    setMapping([]);
    setResult(null);
    setError(null);
  }

  async function handleFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      setError(`不支持的文件格式 .${ext}，请使用 .xlsx 或 .csv 文件${ext === 'xls' ? '（.xls 文件建议另存为 .xlsx）' : ''}`);
      return;
    }

    setStep('parsing');
    setError(null);

    try {
      const p = await parseExcelFile(file);
      if (p.headers.length === 0) {
        setError('文件为空或无法读取');
        setStep('select');
        return;
      }
      setPreview(p);
      setMapping(p.autoMapping);
      setStep('preview');
    } catch (e) {
      setError(`文件解析失败: ${e instanceof Error ? e.message : String(e)}`);
      setStep('select');
    }
  }

  function handleMappingChange(index: number, crmField: ImportableCrmField | '') {
    const next = mapping.map((m, i) =>
      i === index ? { ...m, crmField: (crmField || null) as ImportableCrmField | null } : m,
    );
    setMapping(next);
  }

  async function handleImport() {
    if (!preview) return;
    setStep('importing');
    setError(null);

    try {
      const r = await executeImport(preview.rows, preview.headers, mapping, mode, customers);
      setResult(r);
      setStep('result');
      onRefresh();
    } catch (e) {
      setError(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
      setStep('preview');
    }
  }

  function exportFailures() {
    if (!result || result.failures.length === 0) return;
    const json = JSON.stringify(result.failures, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `导入失败记录_${new Date().toLocaleDateString('zh-CN')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportFailuresCSV() {
    if (!result || result.failures.length === 0) return;
    const csv = exportFailuresAsCSV(result.failures);
    const bom = '﻿';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `导入失败记录_${new Date().toLocaleDateString('zh-CN')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render: Select step ──

  if (step === 'select') {
    return (
      <div>
        <div className="page-header">
          <h2>数据导入</h2>
        </div>
        <div className="page-body">
          <div
            className="dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
            onDragLeave={e => { e.currentTarget.classList.remove('drag-over'); }}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.classList.remove('drag-over');
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <Upload size={48} style={{ color: '#9ca3af', marginBottom: 16 }} />
            <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>点击上传或拖拽文件到此处</p>
            <p style={{ fontSize: 13, color: '#9ca3af' }}>
              支持 .xlsx、.csv 格式<span style={{ marginLeft: 8, color: '#f59e0b' }}>（.xls 文件建议另存为 .xlsx）</span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
          </div>
          {error && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={16} /> {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Parsing step ──

  if (step === 'parsing') {
    return (
      <div>
        <div className="page-header"><h2>数据导入</h2></div>
        <div className="page-body" style={{ textAlign: 'center', padding: 60 }}>
          <FileSpreadsheet size={48} style={{ color: '#6366f1', marginBottom: 16 }} />
          <p>正在解析文件...</p>
        </div>
      </div>
    );
  }

  // ── Render: Preview step ──

  if (step === 'preview' && preview && stats) {
    return (
      <div>
        <div className="page-header">
          <h2>数据导入 — 预览确认</h2>
          <div className="btn-group">
            <button className="btn btn-secondary" onClick={reset}>返回重选</button>
            <button
              className="btn btn-primary"
              disabled={!hasNameMapping}
              onClick={handleImport}
            >
              确认导入
            </button>
          </div>
        </div>

        <div className="page-body">
          {/* Stats cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.totalRows}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>总行数</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#059669' }}>{stats.importableRows}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>可导入</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>{stats.missingNameRows}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>缺名称</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{stats.possibleDuplicates}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>疑似重复</div>
            </div>
          </div>

          {/* Duplicate mode */}
          <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 500 }}>重复处理:</span>
            {(['skip', 'update', 'always_add'] as DuplicateMode[]).map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                <span style={{ fontSize: 14 }}>
                  {m === 'skip' ? '跳过重复' : m === 'update' ? '更新已有' : '总是新增'}
                </span>
              </label>
            ))}
          </div>

          <div className="import-detected-strip">
            <div>
              <div className="import-detected-title">已自动识别</div>
              <div className="import-detected-meta">
                {preview.sheetName ? `工作表：${preview.sheetName} · ` : ''}
                {mappedFieldCount} 个字段已映射，其中 {noteFieldCount} 个字段会合并进备注
              </div>
            </div>
            <div className="import-detected-badges">
              <span>客户等级</span>
              <span>客户名称</span>
              <span>手机号</span>
              <span>备注摘要</span>
            </div>
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>数据预览（前 20 行）</h3>
          <div className="table-container import-preview-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 52 }}>#</th>
                  <th style={{ width: 88 }}>等级</th>
                  <th style={{ width: 220 }}>客户名称</th>
                  <th style={{ width: 160 }}>手机号</th>
                  <th style={{ width: 140 }}>微信</th>
                  <th style={{ width: 96 }}>意向</th>
                  <th>备注摘要</th>
                </tr>
              </thead>
              <tbody>
                {previewRecords.map(({ index, record }) => (
                  <tr key={index}>
                    <td>{index}</td>
                    <td><span className={`badge badge-${String(record.customer_grade || 'c').toLowerCase()}`}>{record.customer_grade || '-'}</span></td>
                    <td className="import-preview-name">{record.name || '-'}</td>
                    <td>{record.phone_number || '-'}</td>
                    <td>{record.wechat_id || '-'}</td>
                    <td>{record.intent_level || '-'}</td>
                    <td className="import-preview-notes">{record.notes || '-'}</td>
                  </tr>
                ))}
                {previewRecords.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>无数据</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <details className="import-mapping-details">
            <summary>查看或调整字段映射</summary>
            <div className="import-mapping-grid">
              {mapping.map((m, i) => (
                <div key={`${m.sourceColumn}-${i}`} className="import-mapping-row">
                  <span title={m.sourceColumn}>{m.sourceColumn || `空列 ${i + 1}`}</span>
                  <span>→</span>
                  <select
                    value={m.crmField || ''}
                    onChange={e => handleMappingChange(i, e.target.value as ImportableCrmField | '')}
                  >
                    <option value="">不导入</option>
                    {(Object.keys(FIELD_LABELS) as ImportableCrmField[]).map(f => (
                      <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!hasNameMapping && (
              <div className="import-mapping-error">
                请至少配置“客户名称”字段映射才能导入
              </div>
            )}
          </details>

          {error && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={16} /> {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Importing step ──

  if (step === 'importing') {
    return (
      <div>
        <div className="page-header"><h2>数据导入 — 导入中</h2></div>
        <div className="page-body" style={{ textAlign: 'center', padding: 60 }}>
          <RefreshCw size={48} style={{ color: '#6366f1', marginBottom: 16, animation: 'spin 1s linear infinite' }} />
          <p>正在导入数据，请稍候...</p>
        </div>
      </div>
    );
  }

  // ── Render: Result step ──

  if (step === 'result' && result) {
    return (
      <div>
        <div className="page-header">
          <h2>数据导入 — 完成</h2>
          <div className="btn-group">
            {result.failures.length > 0 && (
              <>
                <button className="btn btn-secondary" onClick={exportFailuresCSV}>
                  <FileText size={14} /> 导出 CSV
                </button>
                <button className="btn btn-secondary" onClick={exportFailures}>
                  <Download size={14} /> 导出 JSON
                </button>
              </>
            )}
            <button className="btn btn-secondary" onClick={() => navigate('/customers')}>
              <Users size={14} /> 前往客户列表
            </button>
            <button className="btn btn-primary" onClick={reset}>继续导入</button>
          </div>
        </div>

        <div className="page-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <div className="card" style={{ textAlign: 'center' }}>
              <CheckCircle2 size={24} style={{ color: '#059669', marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#059669' }}>{result.success}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>成功导入</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <SkipForward size={24} style={{ color: '#f59e0b', marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{result.skipped}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>已跳过</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <RefreshCw size={24} style={{ color: '#3b82f6', marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#3b82f6' }}>{result.updated}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>已更新</div>
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <XCircle size={24} style={{ color: '#dc2626', marginBottom: 8 }} />
              <div style={{ fontSize: 28, fontWeight: 700, color: '#dc2626' }}>{result.failed}</div>
              <div style={{ fontSize: 13, color: '#6b7280' }}>失败</div>
            </div>
          </div>

          {result.failures.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#dc2626' }}>
                <AlertCircle size={14} style={{ display: 'inline', marginRight: 4 }} />
                失败明细
              </h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>失败原因</th>
                      <th>原始数据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failures.map((f, i) => (
                      <tr key={i}>
                        <td>{f.row}</td>
                        <td style={{ color: '#dc2626' }}>{f.reason}</td>
                        <td style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {Object.entries(f.rawData).map(([k, v]) => `${k}: ${v}`).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result.failed === 0 && result.success === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>
              没有数据被导入
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
