import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, FolderOpen, Brain, ArrowRight, Upload, AlertTriangle } from 'lucide-react';
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

export type RestorePreview = {
  rawPayload: unknown;
  normalized: NormalizedBackupPayload;
  validation: BackupValidationResult;
  errorMessage: string;
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
        errors: [`Invalid JSON: ${message}`],
        missingTables: [],
      },
      errorMessage: `Invalid JSON: ${message}`,
    };
  }
}

export function buildRestoreConfirmationMessage(preview: RestorePreview): string {
  const lines = [
    'Restore will overwrite current local CRM data.',
    'Please manually export a backup before restoring.',
    'New-format backups restore all business tables.',
    'Legacy backups may not include Lead Workbench data.',
    'Restore failure will automatically roll back.',
    'Current data should not be left in a half-restored state.',
  ];

  if (preview.normalized.isLegacy) {
    lines.push('Detected legacy backup.');
  }

  if (preview.normalized.missingTables.length > 0) {
    lines.push(`Missing tables: ${preview.normalized.missingTables.join(', ')}`);
  }

  if (!preview.validation.valid) {
    lines.push(`Validation errors: ${preview.validation.errors.join(' ')}`);
  }

  return lines.join('\n');
}

export function formatRestoreSuccessMessage(result: RestoreBackupResult): string {
  const counts = Object.entries(result.restoredCounts)
    .map(([table, count]) => `${table}: ${count}`)
    .join(', ');
  const warnings = result.warnings.length > 0 ? ` Warnings: ${result.warnings.join(' ')}` : '';
  return `Restore succeeded. Legacy backup: ${result.isLegacy ? 'yes' : 'no'}. Restored counts: ${counts}.${warnings} Refresh the page to view restored data.`;
}

export function formatRestoreFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Restore failed: ${message}. The restore was rolled back, and current data is not left in a half-restored state.`;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState('');
  const [dbPath, setDbPath] = useState<string>('');
  const [restoreWarning, setRestoreWarning] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getDbPath().then(setDbPath).catch(() => setMsg('Unable to get database path'));
  }, []);

  const isErrorMessage = msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('unable');

  const handleBackup = async () => {
    try {
      const { getDb } = await import('../lib/db');
      const db = await getDb();
      const payload = await buildFullBackupPayload(db, { version: APP_VERSION });
      const backup = JSON.stringify(payload, null, 2);

      const blob = new Blob([backup], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = payload.exported_at.replace(/[:.]/g, '-');
      a.href = url;
      a.download = `crm-backup-v${APP_VERSION}-${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Backup success: exported ${payload.counts.customers} customers, ${payload.counts.follow_up_records} follow-ups, ${payload.counts.visit_records} visits, ${payload.counts.tasks} tasks, and Lead Workbench data.`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMsg(`Backup failed: ${errMsg}`);
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
      setMsg(`Restore preview failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRestoreConfirm = async () => {
    if (!restoreFile || !restorePreview) return;

    if (!restorePreview.validation.valid) {
      setMsg(`Restore validation failed: ${restorePreview.errorMessage}`);
      return;
    }

    try {
      const { getDb } = await import('../lib/db');
      const db = await getDb();
      const result = await restoreBackupPayloadWithDb(db, restorePreview.rawPayload);
      setMsg(formatRestoreSuccessMessage(result));
      setRestoreWarning(false);
      setRestoreFile(null);
      setRestorePreview(null);
    } catch (e) {
      setMsg(formatRestoreFailureMessage(e));
    }
  };
  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
      </div>
      <div className="page-body">
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">Database</h3>
          <div style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
            <p style={{ marginBottom: 8 }}>Data is stored in the local SQLite database.</p>
            {dbPath ? (
              <p style={{
                fontSize: 13, fontFamily: 'monospace', background: 'var(--bg-secondary)',
                padding: '6px 10px', borderRadius: 4, wordBreak: 'break-all',
              }}>
                <FolderOpen size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {dbPath}
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading database path...</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleBackup}>
              <Database size={16} /> Export Backup
            </button>
            <button className="btn" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} /> Restore Backup
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
              marginTop: 12, padding: '8px 12px', borderRadius: 4, fontSize: 14,
              background: isErrorMessage ? '#fef2f2' : '#f0fdf4',
              color: isErrorMessage ? '#dc2626' : '#16a34a',
            }}>
              {msg}
            </p>
          )}
        </div>

        {restoreWarning && restoreFile && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}>
            <div className="card" style={{ maxWidth: 480, width: '90%' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f59e0b', marginBottom: 16 }}>
                <AlertTriangle size={20} /> Confirm Restore
              </h3>
              <p style={{ marginBottom: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
                Restore from backup file <strong>{restoreFile.name}</strong>.
              </p>
              {restorePreview && (
                <pre style={{
                  marginBottom: 12,
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                  color: restorePreview.validation.valid ? 'var(--text-secondary)' : '#dc2626',
                  background: 'var(--bg-secondary)',
                  padding: '8px 10px',
                  borderRadius: 4,
                }}>
                  {buildRestoreConfirmationMessage(restorePreview)}
                </pre>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => { setRestoreWarning(false); setRestoreFile(null); setRestorePreview(null); }}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleRestoreConfirm}>
                  Confirm Restore
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="section-title">About</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            Sales CRM personal edition v{APP_VERSION}<br />
            Local desktop CRM with data stored on this machine.
          </p>
        </div>

        <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/settings/ai')}>
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><Brain size={16} style={{ marginRight: 4, verticalAlign: 'middle' }} /> AI Settings</span>
            <ArrowRight size={16} style={{ color: '#9ca3af' }} />
          </h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            Configure AI providers and API keys for analysis, summaries, and suggestions.
          </p>
        </div>
      </div>
    </div>
  );
}
