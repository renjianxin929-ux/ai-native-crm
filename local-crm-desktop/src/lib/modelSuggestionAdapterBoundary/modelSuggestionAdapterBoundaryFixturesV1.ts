import type {
  ModelSuggestionAdapterBoundaryRequest,
} from '../modelSuggestionAdapterBoundaryReadiness';
import type {
  CallerProvidedModelOutputEnvelope,
  ModelSuggestOnlyCandidate,
  ModelSuggestOnlyOutputGateResult,
} from '../modelSuggestOnlyOutputGateReadiness';

interface ModelSuggestionAdapterBoundaryFixtureOptions {
  kind?: string;
  allow_review_queue_entry?: boolean;
  allow_confirmed_action?: boolean;
  allow_human_confirmation?: boolean;
  allow_runner?: boolean;
  allow_execution?: boolean;
  allow_write_plan_entry?: boolean;
  allow_db?: boolean;
  allow_network?: boolean;
  allow_env_read?: boolean;
  allow_model_call?: boolean;
  source_suggest_only_output_gate_result?: ModelSuggestOnlyOutputGateResult;
}

export function buildModelSuggestionAdapterBoundaryRequestFixtureV1(
  options: ModelSuggestionAdapterBoundaryFixtureOptions = {},
): ModelSuggestionAdapterBoundaryRequest {
  return {
    kind: (options.kind ?? 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_REQUEST') as 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_REQUEST',
    version: 'v1',
    request_id: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_FIXTURE_REQUEST_A',
    source_suggest_only_output_gate_result: options.source_suggest_only_output_gate_result
      ?? buildSafeModelSuggestOnlyOutputGateResultFixtureV1(),
    adapter_boundary_only: true,
    caller_provided_only: true,
    allow_review_queue_entry: (options.allow_review_queue_entry ?? false) as false,
    allow_confirmed_action: (options.allow_confirmed_action ?? false) as false,
    allow_human_confirmation: (options.allow_human_confirmation ?? false) as false,
    allow_runner: (options.allow_runner ?? false) as false,
    allow_execution: (options.allow_execution ?? false) as false,
    allow_write_plan_entry: (options.allow_write_plan_entry ?? false) as false,
    allow_db: (options.allow_db ?? false) as false,
    allow_network: (options.allow_network ?? false) as false,
    allow_env_read: (options.allow_env_read ?? false) as false,
    allow_model_call: (options.allow_model_call ?? false) as false,
  };
}

export function buildSafeModelSuggestOnlyOutputGateResultFixtureV1(): ModelSuggestOnlyOutputGateResult {
  const sourceEnvelope = buildSourceEnvelopeFixtureV1();
  const candidate = buildSourceSuggestionCandidateFixtureV1(sourceEnvelope);
  return {
    kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_RESULT',
    version: 'v1',
    plan: {
      kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_suggest_only_output_gate_readiness_only',
      request: {} as ModelSuggestOnlyOutputGateResult['plan']['request'],
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
      generated_suggestion_candidates: true,
      suggestion_candidates: [candidate],
      suggestions_count: 1,
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
        candidates_built: 1,
        required_human_review: true,
        suggestion_only: true,
        executable: false,
      },
      trace_summary: {
        kind: 'MODEL_SUGGEST_ONLY_TRACE_SUMMARY',
        version: 'v1',
        request_id: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_FIXTURE_REQUEST_A',
        source_output_id: sourceEnvelope.output_id,
        validation_checked: true,
        candidates_checked: true,
        source_invocation_reference_only: true,
        source_output_reference_only: true,
        persisted: false,
      },
      source_invocation_gate_result: undefined,
      source_model_output_envelope: sourceEnvelope,
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

function buildSourceEnvelopeFixtureV1(): CallerProvidedModelOutputEnvelope {
  return {
    kind: 'CALLER_PROVIDED_MODEL_OUTPUT_ENVELOPE',
    version: 'v1',
    output_id: 'MODEL_SUGGEST_ONLY_OUTPUT_FIXTURE_A',
    source: 'fixture',
    output_text: 'fixture model output metadata for validation only',
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
  };
}

function buildSourceSuggestionCandidateFixtureV1(
  sourceEnvelope: CallerProvidedModelOutputEnvelope,
): ModelSuggestOnlyCandidate {
  return {
    kind: 'MODEL_SUGGEST_ONLY_CANDIDATE',
    version: 'v1',
    suggestion_candidate_id: 'MODEL_SUGGEST_ONLY_CANDIDATE_001',
    source_output_id: sourceEnvelope.output_id,
    source_invocation_candidate_id: null,
    suggestion_status: 'requires_human_review',
    title: 'Untrusted fixture output received',
    summary: 'Caller-provided fixture metadata was accepted only as a non-executable suggestion candidate.',
    evidence_refs: [
      {
        kind: 'MODEL_SUGGESTION_EVIDENCE_REF',
        evidence_ref_id: 'MODEL_SUGGESTION_EVIDENCE_001',
        source: sourceEnvelope.source,
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
  };
}
