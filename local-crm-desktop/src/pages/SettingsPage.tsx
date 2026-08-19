import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, FolderOpen, Brain, ArrowRight, Upload, AlertTriangle, Shield, Monitor, Info } from 'lucide-react';
import { getDbPath } from '../lib/db';
import { APP_VERSION } from '../lib/version';
import {
  buildFullBackupPayload,
  normalizeBackupPayload,
  restoreBackupPayloadWithDb,
  validateBackupPayload,
  type BackupValidationResult,
  type NormalizedBackupPayload,
  type RestoreBackupResult,
} from '../lib/backupRestore';
import { getAppLocale, setAppLocale, t } from '../lib/i18n/appLocale';
import { useAppLocale } from '../lib/i18n/LocaleProvider';

export type RestorePreview = {
  rawPayload: unknown;
  normalized: NormalizedBackupPayload;
  validation: BackupValidationResult;
  errorMessage: string;
};

export type RestoreStatus = 'idle' | 'backing_up' | 'restoring';

export type BackupDownloadKind = 'manual' | 'pre-restore';

export type BackupDownloadAdapter = {
  createObjectUrl(blob: Blob): string;
  clickDownload(url: string, fileName: string): void;
  revokeObjectUrl(url: string): void;
};

const browserBackupDownloadAdapter: BackupDownloadAdapter = {
  createObjectUrl(blob) {
    return URL.createObjectURL(blob);
  },
  clickDownload(url, fileName) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  },
  revokeObjectUrl(url) {
    URL.revokeObjectURL(url);
  },
};

export function buildRestorePreviewFromText(text: string): RestorePreview {
  try {
    const rawPayload = JSON.parse(text);
    const normalized = normalizeBackupPayload(rawPayload);
    const validation = validateBackupPayload(normalized);
    return {
      rawPayload,
      normalized,
      validation,
      errorMessage: validation.errors.join(' '),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = normalizeBackupPayload(null);
    return {
      rawPayload: null,
      normalized,
      validation: {
        valid: false,
        errors: [`JSON 解析失败：${message}`],
        missingTables: [],
      },
      errorMessage: `JSON 解析失败：${message}`,
    };
  }
}

export function buildRestoreConfirmationMessage(preview: RestorePreview): string {
  const lines = [
    '恢复会覆盖当前本地 CRM 数据。',
    '恢复前请先手动导出备份。',
    '系统将在恢复前自动下载当前数据备份。',
    '请确认浏览器没有阻止下载。',
    '如果自动备份失败，恢复不会继续。',
    '你也可以先手动点击“导出备份”。',
    '新格式备份会恢复完整业务表。',
    '旧格式备份可能不包含获客作业台数据。',
    '恢复失败会自动回滚。',
    '当前数据不应处于半恢复状态。',
  ];

  if (preview.normalized.isLegacy) {
    lines.push('检测到旧版备份。');
  }

  if (preview.normalized.missingTables.length > 0) {
    lines.push(`缺失表：${preview.normalized.missingTables.join(', ')}`);
  }

  if (!preview.validation.valid) {
    lines.push(`校验错误：${preview.validation.errors.join(' ')}`);
  }

  return lines.join('\n');
}

export function formatRestoreSuccessMessage(result: RestoreBackupResult): string {
  const counts = Object.entries(result.restoredCounts)
    .map(([table, count]) => `${table}: ${count}`)
    .join(', ');
  const warnings = result.warnings.length > 0 ? ` 警告：${result.warnings.join(' ')}` : '';
  return `恢复成功。旧版备份：${result.isLegacy ? '是' : '否'}。恢复数量：${counts}.${warnings} 请刷新页面查看恢复后的数据。`;
}

export function formatRestoreFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `恢复失败：${message}。本次恢复已回滚，当前数据不会处于半恢复状态。`;
}

export function buildBackupDownloadFileName(input: {
  kind: BackupDownloadKind;
  version: string;
  exportedAt: string;
}): string {
  const ts = input.exportedAt.replace(/[:.]/g, '-');
  const prefix = input.kind === 'pre-restore' ? 'crm-pre-restore-backup' : 'crm-backup';
  return `${prefix}-v${input.version}-${ts}.json`;
}

export function downloadBackupPayload(
  payload: Awaited<ReturnType<typeof buildFullBackupPayload>>,
  kind: BackupDownloadKind,
  adapter: BackupDownloadAdapter = browserBackupDownloadAdapter,
): string {
  const fileName = buildBackupDownloadFileName({
    kind,
    version: payload.version,
    exportedAt: payload.exported_at,
  });
  const backup = JSON.stringify(payload, null, 2);
  const blob = new Blob([backup], { type: 'application/json' });
  const url = adapter.createObjectUrl(blob);

  try {
    adapter.clickDownload(url, fileName);
    return fileName;
  } finally {
    adapter.revokeObjectUrl(url);
  }
}

export async function runRestoreWithPreRestoreBackup(input: {
  db: Parameters<typeof buildFullBackupPayload>[0] & Parameters<typeof restoreBackupPayloadWithDb>[0];
  rawPayload: unknown;
  download?: typeof downloadBackupPayload;
  restore?: typeof restoreBackupPayloadWithDb;
  setStatus?: (status: RestoreStatus) => void;
}): Promise<RestoreBackupResult> {
  const download = input.download ?? downloadBackupPayload;
  const restore = input.restore ?? restoreBackupPayloadWithDb;

  input.setStatus?.('backing_up');
  let preRestorePayload: Awaited<ReturnType<typeof buildFullBackupPayload>>;
  try {
    preRestorePayload = await buildFullBackupPayload(input.db, { version: APP_VERSION });
  } catch (error) {
    throw new Error('恢复前自动备份失败，已取消恢复，请先手动备份后重试。', { cause: error });
  }

  try {
    download(preRestorePayload, 'pre-restore');
  } catch (error) {
    throw new Error('恢复前自动备份下载失败，已取消恢复，请先手动备份后重试。', { cause: error });
  }

  input.setStatus?.('restoring');
  return restore(input.db, input.rawPayload);
}

export default function SettingsPage() {
  const navigate = useNavigate();
  useAppLocale();
  const [msg, setMsg] = useState('');
  const [dbPath, setDbPath] = useState<string>('');
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getDbPath().then(setDbPath).catch(() => setMsg('无法获取数据库路径'));
  }, []);

  const isErrorMessage = msg.toLowerCase().includes('failed')
    || msg.toLowerCase().includes('unable')
    || msg.includes('失败')
    || msg.includes('无法');

  const handleBackup = async () => {
    try {
      const { getDb } = await import('../lib/db');
      const db = await getDb();
      const payload = await buildFullBackupPayload(db, { version: APP_VERSION });
      downloadBackupPayload(payload, 'manual');
      setMsg(`备份成功：已导出 ${payload.counts.customers} 个客户、${payload.counts.follow_up_records} 条跟进记录、${payload.counts.visit_records} 条面访记录、${payload.counts.tasks} 个任务，以及获客作业台数据。`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMsg(`备份失败：${errMsg}`);
    }
  };

  const handleRestoreSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const text = await file.text();
      const preview = buildRestorePreviewFromText(text);
      setRestoreFile(file);
      setRestorePreview(preview);
      setRestoreWarning(true);
    } catch (error) {
      setRestoreFile(file);
      setRestorePreview(null);
      setRestoreWarning(true);
      setMsg(`恢复预览失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRestoreConfirm = async () => {
    if (!restoreFile || !restorePreview) return;
    if (restoreStatus !== 'idle') return;

    if (!restorePreview.validation.valid) {
      setMsg(`恢复校验失败：${restorePreview.errorMessage}`);
      return;
    }

    try {
      const { getDb } = await import('../lib/db');
      const db = await getDb();
      const result = await runRestoreWithPreRestoreBackup({
        db,
        rawPayload: restorePreview.rawPayload,
        setStatus: setRestoreStatus,
      });
      setMsg(formatRestoreSuccessMessage(result));
      setRestoreWarning(false);
      setRestoreFile(null);
      setRestorePreview(null);
    } catch (e) {
      setMsg(formatRestoreFailureMessage(e));
    } finally {
      setRestoreStatus('idle');
    }
  };
  return (
    <div className="product-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">SETTINGS</p>
          <h2>设置</h2>
          <p className="page-subtitle">管理本地数据、备份恢复、Sales Agent 宿主状态与应用偏好。</p>
        </div>
      </div>

      <div className="page-body">
        <div className="settings-grid">
          <section className="glass-card" aria-label="数据与备份">
            <h3 className="section-title"><Database size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />数据与备份</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>数据库</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
              数据存储在本地 SQLite 数据库中。导出完整业务备份，或在确认后从 JSON 恢复。
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleBackup}>
                <Database size={16} /> 导出备份
              </button>
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                <Upload size={16} /> 恢复备份
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleRestoreSelect}
              />
            </div>
            {msg && (
              <p style={{
                marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 14,
                background: isErrorMessage ? '#fef2f2' : '#f0fdf4',
                color: isErrorMessage ? '#dc2626' : '#16a34a',
              }}>
                {msg}
              </p>
            )}
            {restoreStatus === 'backing_up' && (
              <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
                正在生成恢复前备份…
              </p>
            )}
            {restoreStatus === 'restoring' && (
              <p style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
                正在恢复数据…
              </p>
            )}
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>数据库路径</summary>
              <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
                {dbPath ? (
                  <p style={{
                    fontSize: 12, fontFamily: 'monospace', background: 'var(--bg-secondary)',
                    padding: '6px 10px', borderRadius: 8, wordBreak: 'break-all', margin: 0,
                  }}>
                    <FolderOpen size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    {dbPath}
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>正在加载数据库路径...</p>
                )}
              </div>
            </details>
          </section>

          <section className="glass-card" aria-label="AI 与 Trusted Host 状态">
            <h3 className="section-title"><Brain size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />AI / Trusted Host 状态</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
              canonical Sales Agent 由宿主侧 Trusted Host 管理；未配置时请求会被安全阻断。前端页面不负责为 Agent 配置密钥。
            </p>
            <span className="status-pill info">Host-side Trusted Host</span>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '12px 0' }}>
              AI 设置（高级）：Legacy 分析与多模态调试入口；不改变 canonical Agent 的宿主边界。
            </p>
            <button className="btn btn-sm" onClick={() => navigate('/settings/ai')}>
              <ArrowRight size={14} /> AI 设置
            </button>
          </section>

          <section className="glass-card" aria-label="安全与确认策略">
            <h3 className="section-title"><Shield size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />安全与确认策略</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
              恢复备份前会要求明确确认，并自动下载恢复前备份；失败时自动回滚，避免半恢复状态。
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
              <li>恢复会覆盖当前本地 CRM 数据</li>
              <li>AI 建议与草稿需人工复核后再应用</li>
              <li>Sales Agent 客户范围入口保留上下文，不自动改写 CRM</li>
            </ul>
          </section>

          <section className="glass-card" aria-label="外观与辅助功能">
            <h3 className="section-title"><Monitor size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />外观与辅助功能</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
              {t('settings.languageHelp')}
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, color: 'var(--text-secondary)' }}>
              {t('settings.language')}
              <select
                aria-label={t('settings.language')}
                value={getAppLocale()}
                onChange={event => setAppLocale(event.target.value === 'en-US' ? 'en-US' : 'zh-CN')}
                style={{ minHeight: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 12, maxWidth: 240 }}
              >
                <option value="zh-CN">{t('settings.zh')}</option>
                <option value="en-US">{t('settings.en')}</option>
              </select>
            </label>
            <span className="status-pill ok" style={{ marginTop: 12 }}>减少动态效果遵循系统偏好</span>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '12px 0 0' }}>
              当操作系统开启「减少动态效果」时，Sales Agent 动效与过渡会自动降级。
            </p>
          </section>

          <section className="glass-card" aria-label="关于" style={{ gridColumn: '1 / -1' }}>
            <h3 className="section-title"><Info size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />关于</h3>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              销售CRM个人版 v{APP_VERSION}<br />
              本地桌面 CRM，数据保存在当前电脑。主入口为 Sales Agent。
            </p>
          </section>
        </div>
      </div>

      {restoreWarning && restoreFile && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div className="glass-card" style={{ maxWidth: 480, width: '90%' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', marginBottom: 16 }}>
              <AlertTriangle size={20} /> 确认恢复
            </h3>
            <p style={{ marginBottom: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
              从备份文件 <strong>{restoreFile.name}</strong> 恢复。
            </p>
            {restorePreview && (
              <pre style={{
                marginBottom: 12,
                whiteSpace: 'pre-wrap',
                fontSize: 13,
                color: restorePreview.validation.valid ? 'var(--text-secondary)' : '#dc2626',
                background: 'var(--bg-secondary)',
                padding: '8px 10px',
                borderRadius: 8,
              }}>
                {buildRestoreConfirmationMessage(restorePreview)}
              </pre>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setRestoreWarning(false); setRestoreFile(null); setRestorePreview(null); }}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRestoreConfirm}
                disabled={restoreStatus !== 'idle'}
              >
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
