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
    for (const forbidden of ['process.env', 'import.meta.env', 'fetch(', 'axios', 'Bearer ', 'apiKey:', 'api_key:']) {
      expect(frontendBoundary).not.toContain(forbidden);
    }
  });

  it('registers a Rust Tauri command with a host-owned factory and secret boundary', () => {
    expect(hostBoundary).toContain('#[tauri::command]');
    expect(hostBoundary).toContain('WindowsCredentialStore');
    expect(hostBoundary).toContain('TrustedHostState');
    expect(tauriLibrary).toContain('trusted_host::execute_model_capability');
    expect(tauriLibrary).toContain('trusted_host::probe_trusted_host_provider_health');
    expect(tauriLibrary).toContain('trusted_host::list_trusted_host_provider_status');
  });

  it('keeps the absent host provider blocked and production credentials out of environment variables', () => {
    expect(hostBoundary).toContain('missing_or_reused_authorization');
    expect(hostBoundary).toContain('authorization_binding_mismatch');
    expect(hostBoundary).toContain('explicit_user_action_required');
    expect(hostBoundary).toContain('reqwest::Client');
    // Compile-time E2E-only controls may use environment variables for an
    // external evidence root and deterministic fault injection. Provider
    // credentials remain host-owned in Windows Credential Manager.
    for (const secretEnvironmentName of ['DEEPSEEK_API_KEY', 'DASHSCOPE_API_KEY', 'OPENAI_API_KEY', 'PROVIDER_API_KEY']) {
      expect(hostBoundary).not.toContain(secretEnvironmentName);
    }
    expect(hostBoundary).toContain('#[cfg(feature = "e2e")]');
    expect(hostBoundary).toContain('AI_NATIVE_CRM_E2E_EVIDENCE_ROOT');
  });
});
