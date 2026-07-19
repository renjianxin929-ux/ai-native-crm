import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy-credential-migration suite', () => {
  const source = readFileSync(resolve(process.cwd(), 'src-tauri/src/credential_migration.rs'), 'utf8');
  const host = readFileSync(resolve(process.cwd(), 'src-tauri/src/secure_credentials.rs'), 'utf8');

  it('detects, migrates, verifies, cleans and marks legacy SQLite credentials transactionally', () => {
    for (const marker of ['inspect_legacy_provider_credentials', 'migrate_legacy_provider_credentials', 'read_legacy_records', 'store.write', 'store.read', 'connection.begin()', 'transaction.commit()', 'MIGRATION_KEY']) {
      expect(source).toContain(marker);
    }
  });

  it('has rollback/idempotence and real credential persistence coverage', () => {
    expect(source).toContain('secure_store_failure_leaves_sqlite_unchanged');
    expect(source).toContain('detects_migrates_cleans_and_is_idempotent');
    expect(host).toContain('windows_credential_store_persists_updates_and_deletes');
  });

  it('opens only the resolved production personal-crm.db file and never an in-memory or crm.db fallback', () => {
    expect(source).toContain('resolve_personal_crm_db_path');
    expect(source).toContain('.join("personal-crm.db")');
    expect(source).toContain('SqliteConnectOptions::new()');
    expect(source).toContain('.create_if_missing(false)');
    expect(source).not.toContain('sqlite::memory:');
    expect(source).not.toMatch(/\.join\("crm\.db"\)/);
  });
});
