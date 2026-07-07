import type {
  LiveProviderSandboxCallRequest,
  LiveProviderSandboxErrorEnvelope,
  LiveProviderSandboxTransport,
  LiveProviderSandboxTransportResult,
  ResolvedProviderSecret,
} from '../liveProviderSandboxCallReadiness';

interface LiveProviderSandboxTransportConfig {
  endpointUrl: string;
}

export function createLiveProviderSandboxTransport(
  config: LiveProviderSandboxTransportConfig,
): LiveProviderSandboxTransport {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_TRANSPORT',
    transport_mode: 'live_capable',
    invokeSandboxCall: (
      request: LiveProviderSandboxCallRequest,
      resolvedSecret: ResolvedProviderSecret,
    ) => invokeLiveCapableSandboxCall(config, request, resolvedSecret),
  };
}

async function invokeLiveCapableSandboxCall(
  config: LiveProviderSandboxTransportConfig,
  request: LiveProviderSandboxCallRequest,
  resolvedSecret: ResolvedProviderSecret,
): Promise<LiveProviderSandboxTransportResult> {
  try {
    const response = await fetch(config.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedSecret.getSecretValue()}`,
      },
      body: JSON.stringify({
        model: request.provider_config.model_name,
        messages: [
          {
            role: 'user',
            content: request.prompt_input.text,
          },
        ],
        max_tokens: request.safety_policy.max_output_chars,
      }),
    });
    const payload = await response.json();
    const outputText = extractOutputText(payload).slice(0, request.safety_policy.max_output_chars);
    return buildTransportResult({
      live_call_succeeded: response.ok,
      output_text_redacted: outputText,
      error_envelope: response.ok ? null : buildTransportError('transport_error', response.status),
    });
  } catch {
    return buildTransportResult({
      live_call_succeeded: false,
      output_text_redacted: '',
      error_envelope: buildTransportError('transport_error', 0),
    });
  }
}

function buildTransportResult(
  override: Pick<LiveProviderSandboxTransportResult, 'live_call_succeeded' | 'output_text_redacted' | 'error_envelope'>,
): LiveProviderSandboxTransportResult {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_TRANSPORT_RESULT',
    transport_mode: 'live_capable',
    live_provider_response: override.live_call_succeeded,
    live_call_attempted: true,
    live_call_succeeded: override.live_call_succeeded,
    uses_network: true,
    calls_real_provider: true,
    output_text_redacted: override.output_text_redacted,
    error_envelope: override.error_envelope,
    raw_output_stored: false,
    contains_secret: false,
    contains_pii: false,
    trusted_for_action: false,
    executable: false,
    produces_proposal: false,
    enters_review_queue: false,
    persisted: false,
  };
}

function buildTransportError(
  errorCode: LiveProviderSandboxErrorEnvelope['error_code'],
  statusCode: number,
): LiveProviderSandboxErrorEnvelope {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_ERROR_ENVELOPE',
    error_code: errorCode,
    error_message_redacted: `Sandbox transport returned status ${statusCode}.`,
    includes_secret: false,
    includes_api_key: false,
    retryable: true,
  };
}

function extractOutputText(payload: unknown): string {
  const record = asRecord(payload);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message?.content;
  return typeof content === 'string' ? content : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
