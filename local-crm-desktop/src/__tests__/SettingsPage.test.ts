import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildRestoreConfirmationMessage,
  buildRestorePreviewFromText,
  formatRestoreFailureMessage,
  formatRestoreSuccessMessage,
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

    expect(message).toContain('Restore will overwrite current local CRM data.');
    expect(message).toContain('Please manually export a backup before restoring.');
    expect(message).toContain('New-format backups restore all business tables.');
    expect(message).toContain('Restore failure will automatically roll back.');
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

    expect(message).toContain('Detected legacy backup.');
    expect(message).toContain('Legacy backups may not include Lead Workbench data.');
    expect(message).toContain('Missing tables:');
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
        lead_import_batches: 1,
        lead_import_rows: 1,
        lead_work_items: 1,
        lead_capture_events: 1,
        collected_leads: 1,
        lead_sync_logs: 1,
      },
      warnings: ['Legacy backup missing table lead_work_items; restored as empty array.'],
    });

    expect(message).toContain('Restore succeeded.');
    expect(message).toContain('customers: 1');
    expect(message).toContain('tasks: 1');
    expect(message).toContain('settings: 1');
    expect(message).toContain('ai_drafts: 1');
    expect(message).toContain('lead_work_items: 1');
    expect(message).toContain('Legacy backup: yes');
    expect(message).toContain('Legacy backup missing table lead_work_items');
    expect(message).toContain('Refresh the page to view restored data.');
  });

  it('formats restore failures with rollback and no-half-restore guidance', () => {
    const message = formatRestoreFailureMessage(new Error('forced failure'));

    expect(message).toContain('Restore failed: forced failure');
    expect(message).toContain('rolled back');
    expect(message).toContain('not left in a half-restored state');
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
});
