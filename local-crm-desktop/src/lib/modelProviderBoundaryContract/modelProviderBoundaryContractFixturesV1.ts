import {
  type LiveAdapterPolicy,
  type LiveProviderConfigPlaceholder,
  type ModelProviderBoundaryContractRequest,
} from '../modelProviderBoundaryContractReadiness';

interface BoundaryFixtureOptions {
  kind?: string;
  allow_live_call?: boolean;
  allow_network?: boolean;
  allow_env_read?: boolean;
  allow_secret_material?: boolean;
  allow_db?: boolean;
  allow_runner?: boolean;
  allow_execution?: boolean;
  config_resolved?: boolean;
  config_has_api_key?: boolean;
  config_reads_env?: boolean;
  config_reads_settings?: boolean;
  config_contains_secret?: boolean;
  config_usable_for_live_call?: boolean;
  policy_allow_live_call?: boolean;
  policy_allow_network?: boolean;
  policy_allow_env_read?: boolean;
  source_sandbox_result?: ModelProviderBoundaryContractRequest['source_sandbox_result'];
}

export function buildLiveProviderConfigPlaceholderFixtureV1(
  options: BoundaryFixtureOptions = {},
): LiveProviderConfigPlaceholder {
  return {
    kind: 'LIVE_PROVIDER_CONFIG_PLACEHOLDER',
    placeholder_only: true,
    provider_kind: 'future_provider_placeholder',
    model_id: 'future-model-placeholder',
    resolved: (options.config_resolved ?? false) as false,
    contains_secret: (options.config_contains_secret ?? false) as false,
    reads_env: (options.config_reads_env ?? false) as false,
    reads_settings: (options.config_reads_settings ?? false) as false,
    has_api_key: (options.config_has_api_key ?? false) as false,
    api_key_redacted: true,
    persisted: false,
    usable_for_live_call: (options.config_usable_for_live_call ?? false) as false,
  };
}

export function buildLiveAdapterPolicyFixtureV1(
  options: BoundaryFixtureOptions = {},
): LiveAdapterPolicy {
  return {
    kind: 'LIVE_PROVIDER_ADAPTER_POLICY',
    boundary_only: true,
    allow_live_call: (options.policy_allow_live_call ?? false) as false,
    allow_network: (options.policy_allow_network ?? false) as false,
    allow_env_read: (options.policy_allow_env_read ?? false) as false,
    allow_secret_material: false,
    allow_request_persistence: false,
    allow_response_persistence: false,
    require_redaction: true,
    require_timeout_policy: true,
    require_cost_limit: true,
    require_rate_limit: true,
    require_audit_trace: true,
    require_user_approval_before_live_call: true,
  };
}

export function buildModelProviderBoundaryContractRequestFixtureV1(
  options: BoundaryFixtureOptions = {},
): ModelProviderBoundaryContractRequest {
  return {
    kind: (options.kind ?? 'MODEL_PROVIDER_BOUNDARY_CONTRACT_REQUEST') as 'MODEL_PROVIDER_BOUNDARY_CONTRACT_REQUEST',
    version: 'v1',
    request_id: 'MODEL_PROVIDER_BOUNDARY_FIXTURE_REQUEST_A',
    source_sandbox_result: options.source_sandbox_result,
    requested_provider_kind: 'future_provider_placeholder',
    requested_model_id: 'future-model-placeholder',
    provider_config_placeholder: buildLiveProviderConfigPlaceholderFixtureV1(options),
    live_adapter_policy: buildLiveAdapterPolicyFixtureV1(options),
    caller_provided_only: true,
    boundary_contract_only: true,
    allow_live_call: (options.allow_live_call ?? false) as false,
    allow_network: (options.allow_network ?? false) as false,
    allow_env_read: (options.allow_env_read ?? false) as false,
    allow_secret_material: (options.allow_secret_material ?? false) as false,
    allow_db: (options.allow_db ?? false) as false,
    allow_runner: (options.allow_runner ?? false) as false,
    allow_execution: (options.allow_execution ?? false) as false,
  };
}
