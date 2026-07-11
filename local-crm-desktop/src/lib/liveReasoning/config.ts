import type { LiveReasoningActivation } from './types';

export interface LiveReasoningProviderConfig {
  endpoint: string;
  api_key: string;
  model_id: string;
  provider_kind: LiveReasoningActivation['provider_kind'];
  timeout_ms: number;
  max_response_bytes: number;
}

/** This is the only configuration boundary. Callers inject an environment reader; UI code never reads secrets. */
export function resolveLiveReasoningProviderConfig(
  readEnvironment: (name: string) => string | undefined,
  provider_kind: LiveReasoningActivation['provider_kind'],
): LiveReasoningProviderConfig {
  const endpoint = readEnvironment('LIVE_REASONING_ENDPOINT')?.trim() ?? '';
  const api_key = readEnvironment('LIVE_REASONING_API_KEY')?.trim() ?? '';
  const model_id = readEnvironment('LIVE_REASONING_MODEL_ID')?.trim() ?? '';
  if (!/^https:\/\//.test(endpoint) || !api_key || !model_id) throw new Error('Live reasoning provider configuration is unavailable.');
  return { endpoint, api_key, model_id, provider_kind, timeout_ms: 12_000, max_response_bytes: 128_000 };
}
