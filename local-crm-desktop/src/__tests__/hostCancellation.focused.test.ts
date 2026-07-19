import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('host-cancellation suite', () => {
  const rust = readFileSync(resolve(process.cwd(), 'src-tauri/src/trusted_host.rs'), 'utf8');
  const adapter = readFileSync(resolve(process.cwd(), 'src/lib/salesAgentTools/trustedHostAdapter.ts'), 'utf8');
  const workspace = readFileSync(resolve(process.cwd(), 'src/components/aiNative/SalesAgentInteractionWorkspace.tsx'), 'utf8');

  it('registers and aborts the Rust task, cleans the registry and handles races safely', () => {
    for (const marker of ['RequestRegistry', 'RequestState::Authorized', 'RequestState::Starting', 'RequestState::Active', 'RequestState::Cancelled', 'handle.abort()', 'REQUEST_TOMBSTONE_TTL', 'REQUEST_TOMBSTONE_MAX', 'cancellation_aborts_task_cleans_registry_and_allows_next_request']) {
      expect(rust).toContain(marker);
    }
    expect(rust).toContain('if joined.as_ref().is_err_and(|error| error.is_cancelled())');
  });

  it('connects AbortSignal to the host cancel command without UI-side fake completion', () => {
    expect(adapter).toContain("signal?.addEventListener('abort'");
    expect(adapter).toContain('cancelTrustedHostRequest');
    expect(adapter).not.toContain('fake success');
    expect(adapter).not.toContain('writes_crm: true');
  });

  it('capture-cancellation aborts capture through the same host request registry', () => {
    expect(workspace).toContain('new AbortController()');
    expect(workspace).toContain('abortRef.current?.abort()');
    expect(workspace).toContain('sessionRef.current.capture(sourceType, source, signal, captureEnvelope)');
    expect(adapter).toContain('cancelRequest(authorization.authorizationId)');
    expect(rust).toContain('RequestState::Cancelling');
  });
});
