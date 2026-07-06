import {
  type CallerProvidedModelOutputEnvelope,
  type ModelSuggestionPolicy,
  type ModelSuggestOnlyOutputGateRequest,
} from '../modelSuggestOnlyOutputGateReadiness';

interface ModelSuggestOnlyOutputGateFixtureOptions {
  kind?: string;
  allow_model_call?: boolean;
  allow_network?: boolean;
  allow_env_read?: boolean;
  allow_secret_material?: boolean;
  allow_db?: boolean;
  allow_runner?: boolean;
  allow_execution?: boolean;
  allow_review_queue_entry?: boolean;
  allow_confirmed_action?: boolean;
  allow_human_confirmation?: boolean;
  allow_write_plan_entry?: boolean;
  policy_allow_confirmed_action?: boolean;
  policy_allow_execution?: boolean;
  policy_allow_review_queue_entry?: boolean;
  policy_allow_write_plan_entry?: boolean;
  output_from_live_provider?: boolean;
  output_from_network?: boolean;
  output_from_database?: boolean;
  output_contains_secret?: boolean;
  output_contains_pii?: boolean;
  output_trusted_for_action?: boolean;
  output_executable?: boolean;
  output_produces_proposal?: boolean;
  output_text?: string;
  source_invocation_gate_result?: ModelSuggestOnlyOutputGateRequest['source_invocation_gate_result'];
}

export function buildCallerProvidedModelOutputEnvelopeFixtureV1(
  options: ModelSuggestOnlyOutputGateFixtureOptions = {},
): CallerProvidedModelOutputEnvelope {
  return {
    kind: 'CALLER_PROVIDED_MODEL_OUTPUT_ENVELOPE',
    version: 'v1',
    output_id: 'MODEL_SUGGEST_ONLY_OUTPUT_FIXTURE_A',
    source: 'fixture',
    output_text: options.output_text ?? 'fixture model output metadata for validation only',
    output_text_redacted: true,
    contains_secret: (options.output_contains_secret ?? false) as false,
    contains_pii: (options.output_contains_pii ?? false) as false,
    from_live_provider: (options.output_from_live_provider ?? false) as false,
    from_network: (options.output_from_network ?? false) as false,
    from_database: (options.output_from_database ?? false) as false,
    persisted: false,
    trusted_for_action: (options.output_trusted_for_action ?? false) as false,
    executable: (options.output_executable ?? false) as false,
    produces_proposal: (options.output_produces_proposal ?? false) as false,
    represents_model_call: false,
    calls_real_provider: false,
    uses_network: false,
  };
}

export function buildModelSuggestionPolicyFixtureV1(
  options: ModelSuggestOnlyOutputGateFixtureOptions = {},
): ModelSuggestionPolicy {
  return {
    kind: 'MODEL_SUGGESTION_POLICY',
    policy_only: true,
    allow_suggestion_candidate: true,
    allow_confirmed_action: (options.policy_allow_confirmed_action ?? false) as false,
    allow_execution: (options.policy_allow_execution ?? false) as false,
    allow_review_queue_entry: (options.policy_allow_review_queue_entry ?? false) as false,
    allow_write_plan_entry: (options.policy_allow_write_plan_entry ?? false) as false,
    require_human_review_before_any_action: true,
    require_evidence_refs: true,
    require_risk_flags: true,
    require_no_secret: true,
    require_no_pii: true,
    require_trace: true,
  };
}

export function buildModelSuggestOnlyOutputGateRequestFixtureV1(
  options: ModelSuggestOnlyOutputGateFixtureOptions = {},
): ModelSuggestOnlyOutputGateRequest {
  return {
    kind: (options.kind ?? 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_REQUEST') as 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_REQUEST',
    version: 'v1',
    request_id: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_FIXTURE_REQUEST_A',
    source_invocation_gate_result: options.source_invocation_gate_result,
    model_output_envelope: buildCallerProvidedModelOutputEnvelopeFixtureV1(options),
    suggestion_policy: buildModelSuggestionPolicyFixtureV1(options),
    caller_provided_only: true,
    fixture_output_only: true,
    suggestion_gate_only: true,
    allow_model_call: (options.allow_model_call ?? false) as false,
    allow_network: (options.allow_network ?? false) as false,
    allow_env_read: (options.allow_env_read ?? false) as false,
    allow_secret_material: (options.allow_secret_material ?? false) as false,
    allow_db: (options.allow_db ?? false) as false,
    allow_runner: (options.allow_runner ?? false) as false,
    allow_execution: (options.allow_execution ?? false) as false,
    allow_review_queue_entry: (options.allow_review_queue_entry ?? false) as false,
    allow_confirmed_action: (options.allow_confirmed_action ?? false) as false,
    allow_human_confirmation: (options.allow_human_confirmation ?? false) as false,
    allow_write_plan_entry: (options.allow_write_plan_entry ?? false) as false,
  };
}
