import type { LiveSandboxToSuggestOnlyBridgeResult } from '../liveSandboxToSuggestOnlyBridgeReadiness';
import type {
  ModelSuggestOnlyCandidate,
  ModelSuggestOnlyOutputGateResult,
} from '../modelSuggestOnlyOutputGateReadiness';
import type { ReadOnlyAISuggestionServiceRequest } from '../readOnlyAISuggestionServiceReadiness';

interface ServiceFixtureOptions {
  request_id?: string;
  source_bridge_result?: LiveSandboxToSuggestOnlyBridgeResult;
  allow_network?: boolean;
  allow_model_call?: boolean;
  allow_env_read?: boolean;
  allow_db?: boolean;
  allow_runner?: boolean;
  allow_execution?: boolean;
  allow_review_queue_entry?: boolean;
  allow_confirmed_action?: boolean;
  allow_human_confirmation?: boolean;
  allow_write_plan_entry?: boolean;
  allow_database_write?: boolean;
  allow_task_create?: boolean;
  allow_followup_create?: boolean;
  allow_customer_status_change?: boolean;
  allow_ui?: boolean;
}

export function buildReadOnlyAISuggestionServiceRequestFixtureV1(
  options: ServiceFixtureOptions = {},
): ReadOnlyAISuggestionServiceRequest {
  return {
    kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_REQUEST',
    version: 'v1',
    request_id: options.request_id ?? 'READ_ONLY_AI_SUGGESTION_SERVICE_FIXTURE_REQUEST_A',
    source_bridge_result: options.source_bridge_result ?? buildLiveSandboxToSuggestOnlyBridgeResultFixtureV1(),
    service_read_only: true,
    caller_provided_only: true,
    bridge_reference_only: true,
    allow_network: (options.allow_network ?? false) as false,
    allow_model_call: (options.allow_model_call ?? false) as false,
    allow_env_read: (options.allow_env_read ?? false) as false,
    allow_db: (options.allow_db ?? false) as false,
    allow_runner: (options.allow_runner ?? false) as false,
    allow_execution: (options.allow_execution ?? false) as false,
    allow_review_queue_entry: (options.allow_review_queue_entry ?? false) as false,
    allow_confirmed_action: (options.allow_confirmed_action ?? false) as false,
    allow_human_confirmation: (options.allow_human_confirmation ?? false) as false,
    allow_write_plan_entry: (options.allow_write_plan_entry ?? false) as false,
    allow_database_write: (options.allow_database_write ?? false) as false,
    allow_task_create: (options.allow_task_create ?? false) as false,
    allow_followup_create: (options.allow_followup_create ?? false) as false,
    allow_customer_status_change: (options.allow_customer_status_change ?? false) as false,
    allow_ui: (options.allow_ui ?? false) as false,
  };
}

export function buildLiveSandboxToSuggestOnlyBridgeResultFixtureV1(
  candidates: readonly ModelSuggestOnlyCandidate[] = [buildModelSuggestOnlyCandidateFixtureV1()],
): LiveSandboxToSuggestOnlyBridgeResult {
  const suggestOnlyResult = buildModelSuggestOnlyOutputGateResultFixtureV1(candidates);
  return {
    kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_RESULT',
    version: 'v1',
    answer: {
      kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_ANSWER',
      version: 'v1',
      bridge_blocked: false,
      blocked_reason: null,
      bridge_only: true,
      suggest_only: true,
      caller_provided_only: true,
      source_kind: 'manual_live_provider_smoke',
      source_request_id: 'MANUAL_SMOKE_SOURCE_REQUEST_A',
      source_provider_kind: 'openai_compatible',
      source_model_name: 'manual-smoke-readiness-model',
      source_was_live_sandbox: true,
      generated_model_output_envelope: true,
      model_output_envelope: suggestOnlyResult.answer.source_model_output_envelope,
      suggest_only_result: suggestOnlyResult,
      output_text_redacted: 'Redacted bridge provenance stays outside service cards.',
      trusted_for_action: false,
      enters_review_queue: false,
      writes_database: false,
      persisted: false,
      uses_network: false,
      calls_real_provider: false,
      represents_live_model_call: false,
      enters_human_confirmation: false,
      writes_database_plan: false,
    },
    bridge_only: true,
    suggest_only: true,
    caller_provided_only: true,
    uses_network: false,
    calls_real_provider: false,
    reads_env: false,
    reads_database: false,
    writes_database: false,
    trusted_for_action: false,
    persisted: false,
    enters_review_queue: false,
    represents_live_model_call: false,
    represents_executed_action: false,
    represents_confirmed_action: false,
    represents_review_queue_entry: false,
  };
}

export function buildModelSuggestOnlyCandidateFixtureV1(
  override: Partial<ModelSuggestOnlyCandidate> = {},
): ModelSuggestOnlyCandidate {
  return {
    kind: 'MODEL_SUGGEST_ONLY_CANDIDATE',
    version: 'v1',
    suggestion_candidate_id: 'MODEL_SUGGEST_ONLY_CANDIDATE_001',
    source_output_id: 'MODEL_SUGGEST_ONLY_OUTPUT_FIXTURE_A',
    source_invocation_candidate_id: null,
    suggestion_status: 'requires_human_review',
    title: 'Untrusted fixture output received',
    summary: 'Caller-provided fixture metadata was accepted only as a non-executable suggestion candidate.',
    evidence_refs: [
      {
        kind: 'MODEL_SUGGESTION_EVIDENCE_REF',
        evidence_ref_id: 'MODEL_SUGGESTION_EVIDENCE_001',
        source: 'caller_provided',
        verified: false,
        persisted: false,
      },
    ],
    risk_flags: [
      {
        kind: 'MODEL_SUGGESTION_RISK_FLAG',
        risk_code: 'UNTRUSTED_FIXTURE_OUTPUT',
        severity: 'medium',
        requires_human_review: true,
      },
    ],
    limitations: [
      {
        kind: 'MODEL_SUGGESTION_LIMITATION',
        limitation_code: 'NO_ACTION_WITHOUT_REVIEW',
        description: 'Fixture metadata cannot become an action without a separate reviewed flow.',
        blocks_execution: true,
      },
    ],
    human_review_requirement: {
      kind: 'MODEL_SUGGESTION_HUMAN_REVIEW_REQUIREMENT',
      required: true,
      satisfied: false,
      blocks_action: true,
    },
    required_human_review: true,
    trace_refs: ['MODEL_SUGGEST_ONLY_TRACE_001'],
    contract_only: true,
    suggestion_only: true,
    fixture_output_only: true,
    executable: false,
    confirmed_action: false,
    human_confirmed: false,
    approval_recorded: false,
    writes_database: false,
    reads_database: false,
    calls_runner: false,
    calls_real_provider: false,
    uses_network: false,
    contains_secret: false,
    contains_pii: false,
    produces_executable_proposal: false,
    enters_review_queue: false,
    enters_human_confirmation: false,
    enters_write_plan: false,
    represents_executed_action: false,
    ...override,
  };
}

function buildModelSuggestOnlyOutputGateResultFixtureV1(
  candidates: readonly ModelSuggestOnlyCandidate[],
): ModelSuggestOnlyOutputGateResult {
  return {
    kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_RESULT',
    version: 'v1',
    plan: {
      kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_suggest_only_output_gate_readiness_only',
      request: {
        kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_REQUEST',
        version: 'v1',
        request_id: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_FIXTURE_REQUEST_A',
        model_output_envelope: buildCallerProvidedEnvelopeFixtureV1(),
        suggestion_policy: {
          kind: 'MODEL_SUGGESTION_POLICY',
          policy_only: true,
          allow_suggestion_candidate: true,
          allow_confirmed_action: false,
          allow_execution: false,
          allow_review_queue_entry: false,
          allow_write_plan_entry: false,
          require_human_review_before_any_action: true,
          require_evidence_refs: true,
          require_risk_flags: true,
          require_no_secret: true,
          require_no_pii: true,
          require_trace: true,
        },
        caller_provided_only: true,
        fixture_output_only: true,
        suggestion_gate_only: true,
        allow_model_call: false,
        allow_network: false,
        allow_env_read: false,
        allow_secret_material: false,
        allow_db: false,
        allow_runner: false,
        allow_execution: false,
        allow_review_queue_entry: false,
        allow_confirmed_action: false,
        allow_human_confirmation: false,
        allow_write_plan_entry: false,
      },
      allowed_operations: [
        'validate_caller_provided_fixture_output_envelope',
        'build_suggest_only_candidates',
        'build_suggest_only_output_gate_result',
      ],
      forbidden_operations: [],
    },
    answer: {
      kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_ANSWER',
      version: 'v1',
      suggestion_gate_blocked: false,
      blocked_reason: null,
      generated_suggestion_candidates: candidates.length > 0,
      suggestion_candidates: candidates,
      suggestions_count: candidates.length,
      output_safety_summary: {
        kind: 'MODEL_OUTPUT_SAFETY_SUMMARY',
        output_fixture_only: true,
        output_redacted: true,
        contains_secret: false,
        contains_pii: false,
        from_live_provider: false,
        from_network: false,
        from_database: false,
        trusted_for_action: false,
        executable: false,
      },
      suggestion_summary: {
        kind: 'MODEL_SUGGEST_ONLY_SUMMARY',
        version: 'v1',
        candidates_built: candidates.length,
        required_human_review: true,
        suggestion_only: true,
        executable: false,
      },
      trace_summary: {
        kind: 'MODEL_SUGGEST_ONLY_TRACE_SUMMARY',
        version: 'v1',
        request_id: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_FIXTURE_REQUEST_A',
        source_output_id: 'MODEL_SUGGEST_ONLY_OUTPUT_FIXTURE_A',
        validation_checked: true,
        candidates_checked: true,
        source_invocation_reference_only: true,
        source_output_reference_only: true,
        persisted: false,
      },
      source_invocation_gate_result: undefined,
      source_model_output_envelope: buildCallerProvidedEnvelopeFixtureV1(),
      contract_only: true,
      gate_only: true,
      suggestion_only: true,
      fixture_output_only: true,
      source_contains_fixture_model_output: true,
      model_call_performed: false,
      calls_real_provider: false,
      uses_network: false,
      reads_env: false,
      exposes_secret: false,
      reads_database: false,
      writes_database: false,
      executes_action: false,
      calls_runner: false,
      produces_executable_proposal: false,
      produces_confirmed_action: false,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      persists_output: false,
    },
    persisted: false,
    reads_database: false,
    writes_database: false,
    reads_env: false,
    uses_network: false,
    calls_real_provider: false,
    represents_live_model_call: false,
    represents_model_output: false,
    source_contains_fixture_model_output: true,
    represents_executed_action: false,
  };
}

function buildCallerProvidedEnvelopeFixtureV1() {
  return {
    kind: 'CALLER_PROVIDED_MODEL_OUTPUT_ENVELOPE',
    version: 'v1',
    output_id: 'MODEL_SUGGEST_ONLY_OUTPUT_FIXTURE_A',
    source: 'caller_provided',
    output_text: 'Redacted source text is retained only inside the bridge fixture envelope.',
    output_text_redacted: true,
    contains_secret: false,
    contains_pii: false,
    from_live_provider: false,
    from_network: false,
    from_database: false,
    persisted: false,
    trusted_for_action: false,
    executable: false,
    produces_proposal: false,
    represents_model_call: false,
    calls_real_provider: false,
    uses_network: false,
  } as const;
}
