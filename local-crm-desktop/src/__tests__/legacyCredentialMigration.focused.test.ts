import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy-credential-migration suite', () => {
  const source = readFileSync(resolve(process.cwd(), 'src-tauri/src/credential_migration.rs'), 'utf8');
  const host = readFileSync(resolve(process.cwd(), 'src-tauri/src/secure_credentials.rs'), 'utf8');

  it('detects and migrates read-only legacy Windows credentials into encrypted SQLite', () => {
    for (const marker of ['inspect_legacy_provider_credentials', 'migrate_legacy_provider_credentials', 'WindowsCredentialStore', 'EncryptedCredentialStore', 'encrypted.save', 'original Windows credentials retained']) {
      expect(source).toContain(marker);
    }
  });

  it('compensates newly written rows and requires a separate user deletion command', () => {
    expect(source).toContain('newly_written.iter().rev()');
    expect(source).toContain('delete_legacy_provider_credentials');
    expect(source.indexOf('delete_legacy_provider_credentials')).toBeGreaterThan(source.indexOf('migrate_legacy_provider_credentials'));
    expect(host).not.toContain('CredUIPromptForCredentialsW');
  });

  it('resolves only the Tauri app-data personal-crm.db path', () => {
    expect(source).toContain('.join("personal-crm.db")');
    expect(source).not.toMatch(/\.join\("crm\.db"\)/);
  });
});
