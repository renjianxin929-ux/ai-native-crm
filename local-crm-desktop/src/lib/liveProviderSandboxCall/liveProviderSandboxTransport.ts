import type { LiveProviderSandboxTransport } from '../liveProviderSandboxCallReadiness';

interface LiveProviderSandboxTransportConfig {
  endpointUrl: string;
}

/**
 * Retired browser transport. Production provider calls are exclusively Rust Trusted Host calls.
 * This export remains only so older readiness imports fail closed instead of silently calling a Provider.
 */
export function createLiveProviderSandboxTransport(
  _config: LiveProviderSandboxTransportConfig,
): LiveProviderSandboxTransport {
  throw new Error('Browser live-provider transport was retired; use Rust Trusted Host.');
}
