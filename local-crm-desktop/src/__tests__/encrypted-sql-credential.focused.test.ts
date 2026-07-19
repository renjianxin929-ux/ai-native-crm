import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rust = readFileSync(new URL('../../src-tauri/src/encrypted_credentials.rs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../pages/AISettingsPage.tsx', import.meta.url), 'utf8');
const backup = readFileSync(new URL('../lib/backupRestore.ts', import.meta.url), 'utf8');
const cargo = readFileSync(new URL('../../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const migrationBin = readFileSync(new URL('../../src-tauri/src/bin/migrate_plaintext_credentials.rs', import.meta.url), 'utf8');
const tauriLib = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');

describe('encrypted-sql-credential, plaintext-secret-zero, restart, delete and migration contracts', () => {
  it('uses DPAPI current-user entropy, BLOB storage, zeroizing and fail-closed readback', () => {
    expect(rust).toContain('CryptProtectData'); expect(rust).toContain('CryptUnprotectData');
    expect(rust).toContain('com.localcrm.desktop::ai_provider_credentials::v1');
    expect(rust).not.toContain('CRYPTPROTECT_LOCAL_MACHINE');
    expect(rust).toContain('encrypted_api_key BLOB NOT NULL');
    expect(rust).toContain('Zeroizing');
    expect(rust).toContain('credential decrypt verification failed');
    expect(rust).toContain('exact_plaintext_file_hits');
  });
  it('keeps React secret lifetime short and has no username/native prompt', () => {
    expect(ui).toContain('type="password"'); expect(ui).toContain('autoComplete="new-password"');
    expect(ui).toContain('apiKey: \'\''); expect(ui).not.toMatch(/username|CredUIPrompt/i);
    expect(ui).toContain('这是模型 API Key，不是 CRM 登录账号。');
  });
  it('excludes the credential table from backup and restore allowlists', () => {
    expect(backup).not.toMatch(/BACKUP_TABLES[\s\S]{0,500}ai_provider_credentials/);
  });
  it('keeps the one-shot migration binary out of normal GUI builds and arbitrary targets', () => {
    expect(cargo).toContain('autobins = false');
    expect(cargo).toContain('required-features = ["migration-tool"]');
    expect(migrationBin).not.toMatch(/--api[_-]?key|api_key\s*[:=]/i);
    expect(migrationBin).toContain('database_path');
    expect(migrationBin).toContain('backup_path');
    expect(migrationBin).toContain('args.next().is_some()');
    expect(tauriLib).not.toContain('migrate_plaintext_credentials');
    expect(rust).toContain('validate_exact_production_path(database_path)?');
    expect(rust).toContain('completed_migration_secrets');
  });
});
