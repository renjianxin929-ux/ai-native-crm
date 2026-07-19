import { describe, expect, it } from 'vitest';
import { buildFullBackupPayload, normalizeBackupPayload } from '../lib/backupRestore';
import type { DatabaseLike } from '../lib/db';

describe('credential-compensation', () => {
  it('excludes legacy credential settings from both backup export and restore normalization', async () => {
    const rows = [
      { key: 'theme', value: 'dark', updated_at: 'now' },
      { key: 'text_ai_config', value: JSON.stringify({ apiKey: 'dummy-secret' }), updated_at: 'now' },
      { key: 'multimodal_config', value: JSON.stringify({ token: 'dummy-token' }), updated_at: 'now' },
    ];
    const db: DatabaseLike = {
      async execute() { throw new Error('backup must not write'); },
      async select<T>(sql: string) { return (sql === 'SELECT * FROM settings' ? rows : []) as T[]; },
    };
    const backup = await buildFullBackupPayload(db, { version: 'test', exportedAt: '2026-07-16T00:00:00.000Z' });
    expect(backup.tables.settings).toEqual([{ key: 'theme', value: 'dark', updated_at: 'now' }]);
    const restored = normalizeBackupPayload({ ...backup, tables: { ...backup.tables, settings: rows } });
    expect(restored.tables.settings).toEqual([{ key: 'theme', value: 'dark', updated_at: 'now' }]);
  });
});
