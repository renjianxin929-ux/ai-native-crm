import {
  type InvocationInputPlaceholder,
  type InvocationPolicy,
  type ModelReadOnlyInvocationGateRequest,
} from '../modelReadOnlyInvocationGateReadiness';

interface InvocationGateFixtureOptions {
  kind?: string;
  allow_invocation?: boolean;
  allow_live_call?: boolean;
  allow_network?: boolean;
  allow_env_read?: boolean;
  allow_secret_material?: boolean;
  allow_db?: boolean;
  allow_runner?: boolean;
  allow_execution?: boolean;
  allow_review_queue_entry?: boolean;
  allow_write_plan_entry?: boolean;
  input_resolved?: boolean;
  input_contains_secret?: boolean;
  input_contains_pii?: boolean;
  input_from_database?: boolean;
  input_from_live_customer_data?: boolean;
  input_usable_for_live_call?: boolean;
  policy_allow_invocation?: boolean;
  policy_allow_live_call?: boolean;
  policy_allow_network?: boolean;
  policy_allow_env_read?: boolean;
  policy_allow_tool_calls?: boolean;
  policy_allow_db?: boolean;
  policy_allow_runner?: boolean;
  policy_allow_execution?: boolean;
  source_boundary_result?: ModelReadOnlyInvocationGateRequest['source_boundary_result'];
}

export function buildInvocationInputPlaceholderFixtureV1(
  options: InvocationGateFixtureOptions = {},
): InvocationInputPlaceholder {
  return {
    kind: 'MODEL_INVOCATION_INPUT_PLACEHOLDER',
    placeholder_only: true,
    source: 'future_redacted_prompt',
    resolved: (options.input_resolved ?? false) as false,
    contains_secret: (options.input_contains_secret ?? false) as false,
    contains_pii: (options.input_contains_pii ?? false) as false,
    from_live_customer_data: (options.input_from_live_customer_data ?? false) as false,
    from_database: (options.input_from_database ?? false) as false,
    persisted: false,
    usable_for_live_call: (options.input_usable_for_live_call ?? false) as false,
  };
}

export function buildInvocationPolicyFixtureV1(
  options: InvocationGateFixtureOptions = {},
): InvocationPolicy {
  return {
    kind: 'MODEL_READ_ONLY_INVOCATION_POLICY',
    policy_only: true,
    allow_invocation: (options.policy_allow_invocation ?? false) as false,
    allow_live_call: (options.policy_allow_live_call ?? false) as false,
    allow_network: (options.policy_allow_network ?? false) as false,
    allow_env_read: (options.policy_allow_env_read ?? false) as false,
    allow_tool_calls: (options.policy_allow_tool_calls ?? false) as false,
    allow_db: (options.policy_allow_db ?? false) as false,
    allow_runner: (options.policy_allow_runner ?? false) as false,
    allow_execution: (options.policy_allow_execution ?? false) as false,
    require_redacted_input: true,
    require_boundary_contract: true,
    require_user_approval_before_live_call: true,
    require_timeout_policy: true,
    require_cost_limit: true,
    require_audit_trace: true,
  };
}

export function buildModelReadOnlyInvocationGateRequestFixtureV1(
  options: InvocationGateFixtureOptions = {},
): ModelReadOnlyInvocationGateRequest {
  return {
    kind: (options.kind ?? 'MODEL_READ_ONLY_INVOCATION_GATE_REQUEST') as 'MODEL_READ_ONLY_INVOCATION_GATE_REQUEST',
    version: 'v1',
    request_id: 'MODEL_INVOCATION_GATE_FIXTURE_REQUEST_A',
    source_boundary_result: options.source_boundary_result,
    requested_provider_kind: 'future_provider_placeholder',
    requested_model_id: 'future-model-placeholder',
    invocation_input_placeholder: buildInvocationInputPlaceholderFixtureV1(options),
    invocation_policy: buildInvocationPolicyFixtureV1(options),
    caller_provided_only: true,
    invocation_gate_only: true,
    allow_invocation: (options.allow_invocation ?? false) as false,
    allow_live_call: (options.allow_live_call ?? false) as false,
    allow_network: (options.allow_network ?? false) as false,
    allow_env_read: (options.allow_env_read ?? false) as false,
    allow_secret_material: (options.allow_secret_material ?? false) as false,
    allow_db: (options.allow_db ?? false) as false,
    allow_runner: (options.allow_runner ?? false) as false,
    allow_execution: (options.allow_execution ?? false) as false,
    allow_review_queue_entry: (options.allow_review_queue_entry ?? false) as false,
    allow_write_plan_entry: (options.allow_write_plan_entry ?? false) as false,
  };
}
