import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  buildBackupDownloadFileName,
  buildRestoreConfirmationMessage,
  buildRestorePreviewFromText,
  downloadBackupPayload,
  formatRestoreFailureMessage,
  formatRestoreSuccessMessage,
  runRestoreWithPreRestoreBackup,
} from '../pages/SettingsPage';

function createCompleteBackupText() {
  return JSON.stringify({
    version: '0.4.0',
    exported_at: '2026-06-16T02:00:00.000Z',
    tables: {
      customers: [{ id: 'customer-1' }],
      follow_up_records: [{ id: 'follow-up-1' }],
      visit_records: [{ id: 'visit-1' }],
      tasks: [{ id: 'task-1' }],
      settings: [{ key: 'theme', value: 'dark', updated_at: '2026-06-16T02:00:00.000Z' }],
      ai_drafts: [{ id: 'draft-1' }],
      evidence: [{ id: 'evidence-1' }],
      lead_import_batches: [{ id: 'batch-1' }],
      lead_import_rows: [{ id: 'row-1' }],
      lead_work_items: [{ id: 'work-item-1' }],
      lead_capture_events: [{ id: 'capture-1' }],
      collected_leads: [{ id: 'collected-1' }],
      lead_sync_logs: [{ id: 'sync-log-1' }],
    },
  });
}

describe('SettingsPage restore integration helpers', () => {
  it('builds a valid preview and confirmation message for complete new-format backups', () => {
    const preview = buildRestorePreviewFromText(createCompleteBackupText());

    expect(preview.validation.valid).toBe(true);
    expect(preview.normalized.isLegacy).toBe(false);

    const message = buildRestoreConfirmationMessage(preview);

    expect(message).toContain('恢复会覆盖当前本地 CRM 数据。');
    expect(message).toContain('恢复前请先手动导出备份。');
    expect(message).toContain('新格式备份会恢复完整业务表。');
    expect(message).toContain('恢复失败会自动回滚。');
  });

  it('shows legacy compatibility and missing table hints without rejecting legacy backups', () => {
    const preview = buildRestorePreviewFromText(JSON.stringify({
      customers: [{ id: 'legacy-customer' }],
      followUps: [{ id: 'legacy-follow-up' }],
      visits: [{ id: 'legacy-visit' }],
      tasks: [{ id: 'legacy-task' }],
    }));

    expect(preview.validation.valid).toBe(true);
    expect(preview.normalized.isLegacy).toBe(true);
    expect(preview.normalized.missingTables).toContain('lead_work_items');

    const message = buildRestoreConfirmationMessage(preview);

    expect(message).toContain('检测到旧版备份。');
    expect(message).toContain('旧格式备份可能不包含获客作业台数据。');
    expect(message).toContain('缺失表：');
  });

  it('returns readable validation errors for invalid backups before restore execution', () => {
    const preview = buildRestorePreviewFromText(JSON.stringify({
      version: '0.4.0',
      tables: {
        customers: { id: 'not-array' },
      },
    }));

    expect(preview.validation.valid).toBe(false);
    expect(preview.errorMessage).toContain('Backup table customers must be an array.');
  });

  it('formats restore success with counts, legacy state, warnings, and refresh hint', () => {
    const message = formatRestoreSuccessMessage({
      ok: true,
      isLegacy: true,
      restoredCounts: {
        customers: 1,
        follow_up_records: 1,
        visit_records: 1,
        tasks: 1,
        settings: 1,
        ai_drafts: 1,
        evidence: 1,
        lead_import_batches: 1,
        lead_import_rows: 1,
        lead_work_items: 1,
        lead_capture_events: 1,
        collected_leads: 1,
        lead_sync_logs: 1,
      },
      warnings: ['Legacy backup missing table lead_work_items; restored as empty array.'],
    });

    expect(message).toContain('恢复成功。');
    expect(message).toContain('customers: 1');
    expect(message).toContain('tasks: 1');
    expect(message).toContain('settings: 1');
    expect(message).toContain('ai_drafts: 1');
    expect(message).toContain('lead_work_items: 1');
    expect(message).toContain('旧版备份：是');
    expect(message).toContain('Legacy backup missing table lead_work_items');
    expect(message).toContain('请刷新页面查看恢复后的数据。');
  });

  it('formats restore failures with rollback and no-half-restore guidance', () => {
    const message = formatRestoreFailureMessage(new Error('forced failure'));

    expect(message).toContain('恢复失败：forced failure');
    expect(message).toContain('已回滚');
    expect(message).toContain('不会处于半恢复状态');
  });

  it('uses restoreBackupPayloadWithDb and stops using old hand-written restore SQL', () => {
    const settingsSrc = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');
    const dataImportPage = readFileSync(new URL('../../src/pages/DataImportPage.tsx', import.meta.url), 'utf8');
    const importer = readFileSync(new URL('../../src/lib/importer.ts', import.meta.url), 'utf8');

    expect(settingsSrc).toContain('restoreBackupPayloadWithDb');
    expect(settingsSrc).toContain('normalizeBackupPayload');
    expect(settingsSrc).toContain('validateBackupPayload');
    expect(settingsSrc).not.toContain('confirm(');
    expect(settingsSrc).not.toContain('INSERT OR REPLACE INTO customers');
    expect(settingsSrc).not.toContain('INSERT OR REPLACE INTO follow_up_records');
    expect(settingsSrc).not.toContain('INSERT OR REPLACE INTO visit_records');
    const restoreConfirmBlock = settingsSrc.slice(
      settingsSrc.indexOf('const handleRestoreConfirm = async () => {'),
      settingsSrc.indexOf('return ('),
    );
    expect(restoreConfirmBlock).not.toContain('buildFullBackupPayload');
    expect(dataImportPage.length).toBeGreaterThan(0);
    expect(importer.length).toBeGreaterThan(0);
  });

  it('runs pre-restore backup download before restore execution', async () => {
    const events: string[] = [];
    const db = {
      select: vi.fn().mockImplementation(async (sql: string) => {
        events.push(`select:${sql}`);
        return [];
      }),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };
    const download = vi.fn().mockImplementation(() => {
      events.push('download');
    });
    const restore = vi.fn().mockImplementation(async () => {
      events.push('restore');
      return {
        ok: true,
        isLegacy: false,
        restoredCounts: {
          customers: 1,
          follow_up_records: 0,
          visit_records: 0,
          tasks: 1,
          settings: 1,
          ai_drafts: 1,
          lead_import_batches: 0,
          lead_import_rows: 0,
          lead_work_items: 0,
          lead_capture_events: 0,
          collected_leads: 0,
          lead_sync_logs: 0,
        },
        warnings: [],
      };
    });
    const setStatus = vi.fn();

    const result = await runRestoreWithPreRestoreBackup({
      db,
      rawPayload: JSON.parse(createCompleteBackupText()),
      download,
      restore,
      setStatus,
    });

    expect(result.ok).toBe(true);
    expect(download).toHaveBeenCalledBefore(restore);
    expect(events.indexOf('download')).toBeLessThan(events.indexOf('restore'));
    expect(setStatus).toHaveBeenNthCalledWith(1, 'backing_up');
    expect(setStatus).toHaveBeenNthCalledWith(2, 'restoring');
  });

  it('does not restore when pre-restore backup building fails', async () => {
    const db = {
      select: vi.fn().mockRejectedValue(new Error('select failed')),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };
    const restore = vi.fn();

    await expect(runRestoreWithPreRestoreBackup({
      db,
      rawPayload: JSON.parse(createCompleteBackupText()),
      download: vi.fn(),
      restore,
    })).rejects.toThrow('恢复前自动备份失败，已取消恢复，请先手动备份后重试。');

    expect(restore).not.toHaveBeenCalled();
  });

  it('does not restore when pre-restore backup download fails', async () => {
    const db = {
      select: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };
    const restore = vi.fn();

    await expect(runRestoreWithPreRestoreBackup({
      db,
      rawPayload: JSON.parse(createCompleteBackupText()),
      download: vi.fn(() => {
        throw new Error('download blocked');
      }),
      restore,
    })).rejects.toThrow('恢复前自动备份下载失败，已取消恢复，请先手动备份后重试。');

    expect(restore).not.toHaveBeenCalled();
  });

  it('builds and downloads pre-restore backup filenames safely', () => {
    const fileName = buildBackupDownloadFileName({
      kind: 'pre-restore',
      version: '0.4.0',
      exportedAt: '2026-06-16T02:00:00.000Z',
    });
    const adapter = {
      createObjectUrl: vi.fn(() => 'blob:url'),
      clickDownload: vi.fn(),
      revokeObjectUrl: vi.fn(),
    };

    downloadBackupPayload({
      version: '0.4.0',
      exported_at: '2026-06-16T02:00:00.000Z',
      counts: {} as never,
      tables: {} as never,
      customers: [],
      followUps: [],
      visits: [],
      tasks: [],
    }, 'pre-restore', adapter);

    expect(fileName).toContain('pre-restore');
    expect(fileName).toContain('v0.4.0');
    expect(fileName).toContain('2026-06-16T02-00-00-000Z');
    expect(adapter.createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(adapter.clickDownload).toHaveBeenCalledWith('blob:url', fileName);
    expect(adapter.revokeObjectUrl).toHaveBeenCalledWith('blob:url');
  });

  it('documents automatic backup warnings and loading states in SettingsPage', () => {
    const settingsSrc = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');

    expect(settingsSrc).toContain('系统将在恢复前自动下载当前数据备份。');
    expect(settingsSrc).toContain('请确认浏览器没有阻止下载。');
    expect(settingsSrc).toContain('如果自动备份失败，恢复不会继续。');
    expect(settingsSrc).toContain('你也可以先手动点击“导出备份”。');
    expect(settingsSrc).toContain('正在生成恢复前备份');
    expect(settingsSrc).toContain('正在恢复数据');
    expect(settingsSrc).toContain('disabled={restoreStatus !==');
  });

  it('uses Chinese fixed UI copy for the settings page', () => {
    const settingsSrc = readFileSync(new URL('../../src/pages/SettingsPage.tsx', import.meta.url), 'utf8');

    expect(settingsSrc).toContain('<h2>设置</h2>');
    expect(settingsSrc).toContain('数据库');
    expect(settingsSrc).toContain('数据存储在本地 SQLite 数据库中。');
    expect(settingsSrc).toContain('导出备份');
    expect(settingsSrc).toContain('恢复备份');
    expect(settingsSrc).toContain('关于');
    expect(settingsSrc).toContain('销售CRM个人版 v{APP_VERSION}');
    expect(settingsSrc).toContain('本地桌面 CRM，数据保存在当前电脑。');
    expect(settingsSrc).toContain('AI 设置');
    expect(settingsSrc).toContain('Trusted Host');
    expect(settingsSrc).toContain('前端页面不负责为 Agent 配置密钥');
    expect(settingsSrc).toContain('数据与备份');
    expect(settingsSrc).toContain('安全与确认策略');
    expect(settingsSrc).toContain('外观与辅助功能');
  });
});
