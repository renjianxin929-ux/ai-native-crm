import type {
  LiveProviderSandboxTransport,
  LiveProviderSandboxTransportResult,
  ProviderSecretResolver,
  ResolvedProviderSecret,
} from '../liveProviderSandboxCallReadiness';
import {
  MANUAL_LIVE_PROVIDER_SMOKE_AUTHORIZATION_PHRASE,
  type ManualLiveProviderSmokeRequest,
} from '../manualLiveProviderSmokeGateReadiness';

export function buildManualLiveProviderSmokeRequestFixtureV1(
  override: Partial<ManualLiveProviderSmokeRequest> = {},
): ManualLiveProviderSmokeRequest {
  const base: ManualLiveProviderSmokeRequest = {
    kind: 'MANUAL_LIVE_PROVIDER_SMOKE_REQUEST',
    version: 'v1',
    request_id: 'MANUAL_LIVE_PROVIDER_SMOKE_001',
    user_explicitly_authorized_live_call: true,
    authorization_phrase: MANUAL_LIVE_PROVIDER_SMOKE_AUTHORIZATION_PHRASE,
    provider_config: {
      provider_kind: 'openai_compatible',
      endpoint_url_redacted: '[REDACTED_PROVIDER_ENDPOINT]',
      model_name: 'manual-smoke-readiness-model',
      api_key_reference: 'manual-smoke-reference',
      api_key_resolved: true,
      resolved_by: 'injected_secret_resolver',
      exposes_secret: false,
      prints_secret: false,
    },
    prompt_input: {
      kind: 'MANUAL_LIVE_PROVIDER_SMOKE_PROMPT_INPUT',
      text: 'Return one harmless readiness sentence.',
      contains_pii: false,
      contains_secret: false,
      from_database: false,
      from_crm_customer: false,
      trusted_for_action: false,
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
    allow_network: true,
    allow_live_provider: true,
    allow_env_read: false,
    allow_db: false,
    allow_runner: false,
    allow_execution: false,
    allow_review_queue_entry: false,
    allow_confirmed_action: false,
    allow_human_confirmation: false,
    allow_write_plan_entry: false,
    dry_run_default: true,
  };

  return {
    ...base,
    ...override,
    provider_config: {
      ...base.provider_config,
      ...override.provider_config,
    },
    prompt_input: {
      ...base.prompt_input,
      ...override.prompt_input,
    },
    safety_policy: {
      ...base.safety_policy,
      ...override.safety_policy,
    },
  };
}

export function buildFakeManualResolvedProviderSecretV1(
  override: Partial<ResolvedProviderSecret> = {},
): ResolvedProviderSecret {
  return {
    resolved: true,
    secret_value_redacted: '[REDACTED_SECRET]',
    getSecretValue: () => 'manual-smoke-test-value',
    exposes_secret: false,
    prints_secret: false,
    ...override,
  };
}

export const fakeManualProviderSecretResolverV1: ProviderSecretResolver = () => (
  buildFakeManualResolvedProviderSecretV1()
);

export function buildFakeManualLiveProviderSmokeTransportV1(
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
      output_text_redacted: 'Manual smoke fake output: no live provider request was sent.',
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
