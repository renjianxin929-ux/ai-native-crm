import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const frontendBoundary = readFileSync(
  resolve(process.cwd(), 'src/lib/modelCapabilities/trustedHost.ts'),
  'utf8',
);
const hostBoundary = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/trusted_host.rs'),
  'utf8',
);
const tauriLibrary = readFileSync(resolve(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8');

describe('trusted host provider boundary', () => {
  it('keeps the frontend limited to a Tauri invoke command', () => {
    expect(frontendBoundary).toContain("invoke<TrustedHostAuthorizationResult>('authorize_model_capability'");
    expect(frontendBoundary).toContain("invoke<TrustedHostCompletionResult>('execute_model_capability'");
    for (const forbidden of ['process.env', 'import.meta.env', 'fetch(', 'axios', 'Bearer', 'apiKey', 'secret']) {
      expect(frontendBoundary).not.toContain(forbidden);
    }
  });

  it('registers a Rust Tauri command with a host-owned factory and secret boundary', () => {
    expect(hostBoundary).toContain('#[tauri::command]');
    expect(hostBoundary).toContain('trait HostSecretResolver');
    expect(hostBoundary).toContain('HostAuthorizationStore');
    expect(tauriLibrary).toContain('trusted_host::execute_model_capability');
  });

  it('keeps the absent host provider in a blocked state without network access', () => {
    expect(hostBoundary).toContain('missing_or_reused_authorization');
    expect(hostBoundary).toContain('authorization_binding_mismatch');
    expect(hostBoundary).toContain('explicit_user_action_required');
    expect(hostBoundary).toContain('reqwest::Client');
    expect(hostBoundary).toContain('std::env::var');
  });
});
