import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGraphSources, readProductionBundle } from './productionDependencyGraphHarness';

describe('secret-boundary suite', () => {
  it('keeps provider network and credential material outside reachable browser code', () => {
    const source = readGraphSources();
    expect(source).not.toMatch(/headers\s*:\s*\{[^}]*Authorization/s);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/localStorage\.(?:setItem|getItem)[^\n]*(?:api[_-]?key|credential|secret)/i);
    expect(source).not.toMatch(/execute\([^)]*(?:apiKey|api_key|secret)/);
  });

  it('uses DPAPI-encrypted SQLite credentials in Rust and strips legacy secret settings from backup/restore', () => {
    const secure = readFileSync(resolve(process.cwd(), 'src-tauri/src/secure_credentials.rs'), 'utf8');
    const encrypted = readFileSync(resolve(process.cwd(), 'src-tauri/src/encrypted_credentials.rs'), 'utf8');
    const migration = readFileSync(resolve(process.cwd(), 'src-tauri/src/credential_migration.rs'), 'utf8');
    const backup = readFileSync(resolve(process.cwd(), 'src/lib/backupRestore.ts'), 'utf8');
    expect(secure).toContain('CredReadW');
    expect(secure).toContain('CredDeleteW');
    expect(secure).not.toContain('CredUIPromptForCredentialsW');
    expect(encrypted).toContain('CryptProtectData');
    expect(encrypted).toContain('CryptUnprotectData');
    expect(encrypted).toContain('WINDOWS_DPAPI_CURRENT_USER_V1');
    expect(migration).toContain('EncryptedCredentialStore');
    expect(backup).toContain('isSafeSettingRow');
    expect(readProductionBundle()).not.toMatch(/sk-[a-z0-9_-]{8,}/i);
  });
});
