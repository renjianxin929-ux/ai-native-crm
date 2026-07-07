import type {
  LiveProviderSandboxCallRequest,
  LiveProviderSandboxTransport,
  LiveProviderSandboxTransportResult,
  ProviderSecretResolver,
  ResolvedProviderSecret,
} from '../liveProviderSandboxCallReadiness';

export function buildLiveProviderSandboxCallRequestFixtureV1(
  override: Partial<LiveProviderSandboxCallRequest> = {},
): LiveProviderSandboxCallRequest {
  const base: LiveProviderSandboxCallRequest = {
    kind: 'LIVE_PROVIDER_SANDBOX_CALL_REQUEST',
    version: 'v1',
    request_id: 'LIVE_PROVIDER_SANDBOX_CALL_001',
    prompt_input: {
      kind: 'LIVE_PROVIDER_SANDBOX_PROMPT_INPUT',
      text: 'Summarize a harmless sandbox readiness prompt.',
      contains_pii: false,
      contains_secret: false,
      from_database: false,
      from_crm_customer: false,
      trusted_for_action: false,
    },
    provider_config: {
      provider_kind: 'local_fake',
      endpoint_url_redacted: '[REDACTED_ENDPOINT]',
      model_name: 'sandbox-readiness-model',
      api_key_reference: 'sandbox-reference',
      api_key_resolved: true,
      exposes_secret: false,
      prints_secret: false,
      resolved_by: 'test_fake',
    },
    safety_policy: {
      redact_prompt: true,
      redact_response: true,
      max_output_chars: 96,
      timeout_ms: 1000,
      allow_persistence: false,
      allow_action_generation: false,
      allow_review_queue_entry: false,
      allow_db_write: false,
    },
    allow_live_call: true,
    allow_network: true,
    allow_env_read: false,
    allow_db: false,
    allow_runner: false,
    allow_execution: false,
    allow_review_queue_entry: false,
    allow_confirmed_action: false,
    allow_human_confirmation: false,
    allow_write_plan_entry: false,
  };

  return {
    ...base,
    ...override,
    prompt_input: {
      ...base.prompt_input,
      ...override.prompt_input,
    },
    provider_config: {
      ...base.provider_config,
      ...override.provider_config,
    },
    safety_policy: {
      ...base.safety_policy,
      ...override.safety_policy,
    },
  };
}

export function buildFakeResolvedProviderSecretV1(
  override: Partial<ResolvedProviderSecret> = {},
): ResolvedProviderSecret {
  return {
    resolved: true,
    secret_value_redacted: '[REDACTED_SECRET]',
    getSecretValue: () => 'sandbox-test-value',
    exposes_secret: false,
    prints_secret: false,
    ...override,
  };
}

export const fakeProviderSecretResolverV1: ProviderSecretResolver = () => buildFakeResolvedProviderSecretV1();

export function buildFakeLiveProviderSandboxTransportV1(
  override: Partial<LiveProviderSandboxTransportResult> = {},
): LiveProviderSandboxTransport {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_TRANSPORT',
    transport_mode: 'fake',
    invokeSandboxCall: (): LiveProviderSandboxTransportResult => ({
      kind: 'LIVE_PROVIDER_SANDBOX_TRANSPORT_RESULT',
      transport_mode: 'fake',
      live_provider_response: false,
      live_call_attempted: true,
      live_call_succeeded: true,
      uses_network: false,
      calls_real_provider: false,
      output_text_redacted: 'Sandbox fake output: no live provider request was sent.',
      error_envelope: null,
      raw_output_stored: false,
      contains_secret: false,
      contains_pii: false,
      trusted_for_action: false,
      executable: false,
      produces_proposal: false,
      enters_review_queue: false,
      persisted: false,
      ...override,
    }),
  };
}
