import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendBoundary = readFileSync(resolve(process.cwd(), 'src/lib/modelCapabilities/trustedHost.ts'), 'utf8');
const hostBoundary = readFileSync(resolve(process.cwd(), 'src-tauri/src/trusted_host.rs'), 'utf8');
const tauriLibrary = readFileSync(resolve(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8');
const adapter = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/trustedHostAdapter.ts'), 'utf8');

describe('trusted-host-provider suite', () => {
  it('keeps the frontend limited to Tauri invoke commands without secrets', () => {
    expect(frontendBoundary).toContain("invoke<TrustedHostAuthorizationResult>('authorize_model_capability'");
    expect(frontendBoundary).toContain("invoke<TrustedHostCompletionResult>('execute_model_capability'");
    expect(frontendBoundary).toContain("invoke<TrustedHostProviderHealth>('probe_trusted_host_provider_health'");
    expect(frontendBoundary).toContain("invoke<TrustedHostProviderHealth[]>('list_trusted_host_provider_status'");
    for (const forbidden of ['process.env', 'import.meta.env', 'fetch(', 'axios', 'Bearer ', 'api_key:']) {
      expect(frontendBoundary).not.toContain(forbidden);
    }
    expect(frontendBoundary).toContain('Sends the key once to Rust');
  });

  it('registers production host commands with timeout, size limits, and health probes', () => {
    expect(hostBoundary).toContain('REQUEST_TIMEOUT_SECS: u64 = 75');
    expect(hostBoundary).toContain('MAX_REQUEST_BYTES');
    expect(hostBoundary).toContain('MAX_RESPONSE_BYTES');
    expect(hostBoundary).toContain('rate_limited');
    expect(hostBoundary).toContain('unauthorized');
    expect(hostBoundary).toContain('timeout');
    expect(hostBoundary).toContain('request_id');
    expect(hostBoundary).toContain('latency_ms');
    expect(hostBoundary).toContain('token_usage');
    expect(hostBoundary).toContain('probe_trusted_host_provider_health');
    expect(hostBoundary).toContain('list_trusted_host_provider_status');
    expect(tauriLibrary).toContain('trusted_host::probe_trusted_host_provider_health');
    expect(adapter).toContain('createProductionModelCaller');
    expect(adapter).not.toMatch(/\bfetch\s*\(/);
    expect(adapter).not.toContain('apiKey');
  });
});
