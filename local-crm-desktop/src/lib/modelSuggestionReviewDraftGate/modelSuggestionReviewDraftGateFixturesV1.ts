import type {
  AdaptedModelSuggestionBoundaryCandidate,
  ModelSuggestionAdapterBoundaryRequest,
  ModelSuggestionAdapterBoundaryResult,
} from '../modelSuggestionAdapterBoundaryReadiness';
import type {
  CallerProvidedModelOutputEnvelope,
  ModelSuggestOnlyCandidate,
  ModelSuggestOnlyOutputGateResult,
} from '../modelSuggestOnlyOutputGateReadiness';
import type {
  ModelSuggestionReviewDraftGateRequest,
} from '../modelSuggestionReviewDraftGateReadiness';

interface ModelSuggestionReviewDraftGateFixtureOptions {
  kind?: string;
  allow_enqueue?: boolean;
  allow_review_queue_entry?: boolean;
  allow_confirmed_action?: boolean;
  allow_confirmed_action_envelope?: boolean;
  allow_human_confirmation?: boolean;
  allow_runner?: boolean;
  allow_execution?: boolean;
  allow_write_plan_entry?: boolean;
  allow_db?: boolean;
  allow_network?: boolean;
  allow_env_read?: boolean;
  allow_model_call?: boolean;
  source_adapter_boundary_result?: ModelSuggestionAdapterBoundaryResult;
}

export function buildModelSuggestionReviewDraftGateRequestFixtureV1(
  options: ModelSuggestionReviewDraftGateFixtureOptions = {},
): ModelSuggestionReviewDraftGateRequest {
  return {
    kind: (options.kind ?? 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_REQUEST') as 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_REQUEST',
    version: 'v1',
    request_id: 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_FIXTURE_REQUEST_A',
    source_adapter_boundary_result: options.source_adapter_boundary_result
      ?? buildSafeModelSuggestionAdapterBoundaryResultFixtureV1(),
    review_draft_gate_only: true,
    caller_provided_only: true,
    allow_enqueue: (options.allow_enqueue ?? false) as false,
    allow_review_queue_entry: (options.allow_review_queue_entry ?? false) as false,
    allow_confirmed_action: (options.allow_confirmed_action ?? false) as false,
    allow_confirmed_action_envelope: (options.allow_confirmed_action_envelope ?? false) as false,
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

export function buildSafeModelSuggestionAdapterBoundaryResultFixtureV1(): ModelSuggestionAdapterBoundaryResult {
  const sourceResult = buildSafeModelSuggestOnlyOutputGateResultFixtureV1();
  const boundaryCandidate = buildBoundaryCandidateFixtureV1(sourceResult.answer.suggestion_candidates[0]);
  return {
    kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_RESULT',
    version: 'v1',
    plan: {
      kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_suggestion_adapter_boundary_readiness_only',
      request: {} as ModelSuggestionAdapterBoundaryRequest,
      allowed_operations: [
        'validate_caller_provided_suggest_only_result',
        'adapt_safe_suggestion_candidates',
        'build_adapter_boundary_result',
      ],
      forbidden_operations: [],
    },
    answer: {
      kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_ANSWER',
      version: 'v1',
      adapter_boundary_blocked: false,
      blocked_reason: null,
      generated_boundary_candidates: true,
      boundary_candidates: [boundaryCandidate],
      boundary_summary: {
        kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_SUMMARY',
        version: 'v1',
        candidates_built: 1,
        adapter_boundary_only: true,
        suggestion_only: true,
        executable: false,
      },
      trace_summary: {
        kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_TRACE_SUMMARY',
        version: 'v1',
        request_id: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_FIXTURE_REQUEST_A',
        source_result_kind: sourceResult.kind,
        source_reference_only: true,
        validation_checked: true,
        candidates_checked: true,
        persisted: false,
      },
      source_suggest_only_output_gate_result: sourceResult,
      contract_only: true,
      adapter_boundary_only: true,
      suggestion_only: true,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      produces_confirmed_action: false,
      produces_executable_proposal: false,
      executes_action: false,
      calls_runner: false,
      reads_database: false,
      writes_database: false,
      calls_real_provider: false,
      uses_network: false,
      reads_env: false,
      persists_output: false,
    },
    persisted: false,
    reads_database: false,
    writes_database: false,
    reads_env: false,
    uses_network: false,
    calls_real_provider: false,
    represents_executed_action: false,
    represents_confirmed_action: false,
    represents_review_queue_entry: false,
    represents_human_confirmation: false,
    represents_write_plan: false,
  };
}

function buildSafeModelSuggestOnlyOutputGateResultFixtureV1(): ModelSuggestOnlyOutputGateResult {
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
    summary: 'Caller-provided fixture metadata remains non-executable suggestion metadata.',
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

function buildBoundaryCandidateFixtureV1(
  sourceCandidate: ModelSuggestOnlyCandidate,
): AdaptedModelSuggestionBoundaryCandidate {
  return {
    kind: 'ADAPTED_MODEL_SUGGESTION_BOUNDARY_CANDIDATE',
    version: 'v1',
    boundary_candidate_id: 'ADAPTED_MODEL_SUGGESTION_BOUNDARY_001',
    source_suggestion_candidate_id: sourceCandidate.suggestion_candidate_id,
    source_output_id: sourceCandidate.source_output_id,
    adaptation_status: 'boundary_requires_human_review',
    title: 'Boundary candidate 001',
    summary: 'Safe suggestion metadata was adapted as a contract-only boundary candidate.',
    evidence_refs: sourceCandidate.evidence_refs,
    risk_flags: sourceCandidate.risk_flags,
    limitations: sourceCandidate.limitations,
    trace_refs: sourceCandidate.trace_refs,
    contract_only: true,
    adapter_boundary_only: true,
    suggestion_only: true,
    fixture_output_only: true,
    executable: false,
    confirmed_action: false,
    human_confirmed: false,
    approval_recorded: false,
    enters_review_queue: false,
    enters_human_confirmation: false,
    enters_write_plan: false,
    produces_confirmed_action: false,
    produces_executable_proposal: false,
    emits_confirmed_action_envelope: false,
    reads_database: false,
    writes_database: false,
    calls_runner: false,
    calls_real_provider: false,
    uses_network: false,
    reads_env: false,
    contains_secret: false,
    contains_pii: false,
    represents_executed_action: false,
  };
}
