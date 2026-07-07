import type {
  ModelSuggestionReviewDraftGateRequest,
  ModelSuggestionReviewDraftGateResult,
} from '../modelSuggestionReviewDraftGateReadiness';
import {
  buildSafeModelSuggestionAdapterBoundaryResultFixtureV1,
} from '../modelSuggestionReviewDraftGate/modelSuggestionReviewDraftGateFixturesV1';
import type {
  ReviewDraftQueueBoundaryRequest,
} from '../reviewDraftQueueBoundaryReadiness';

interface ReviewDraftQueueBoundaryFixtureOptions {
  kind?: string;
  allow_enqueue?: boolean;
  allow_queue_item?: boolean;
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
  source_review_draft_gate_result?: ModelSuggestionReviewDraftGateResult;
}

export function buildReviewDraftQueueBoundaryRequestFixtureV1(
  options: ReviewDraftQueueBoundaryFixtureOptions = {},
): ReviewDraftQueueBoundaryRequest {
  return {
    kind: (options.kind ?? 'REVIEW_DRAFT_QUEUE_BOUNDARY_REQUEST') as 'REVIEW_DRAFT_QUEUE_BOUNDARY_REQUEST',
    version: 'v1',
    request_id: 'REVIEW_DRAFT_QUEUE_BOUNDARY_FIXTURE_REQUEST_A',
    source_review_draft_gate_result: options.source_review_draft_gate_result
      ?? buildSafeModelSuggestionReviewDraftGateResultFixtureV1(),
    queue_boundary_only: true,
    enqueue_permission_gate_only: true,
    caller_provided_only: true,
    allow_enqueue: (options.allow_enqueue ?? false) as false,
    allow_queue_item: (options.allow_queue_item ?? false) as false,
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

export function buildSafeModelSuggestionReviewDraftGateResultFixtureV1(): ModelSuggestionReviewDraftGateResult {
  const sourceResult = buildSafeModelSuggestionAdapterBoundaryResultFixtureV1();
  const sourceCandidate = sourceResult.answer.boundary_candidates[0];
  return {
    kind: 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_RESULT',
    version: 'v1',
    plan: {
      kind: 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'model_suggestion_review_draft_gate_readiness_only',
      request: {} as ModelSuggestionReviewDraftGateRequest,
      allowed_operations: [
        'validate_caller_provided_adapter_boundary_result',
        'project_safe_boundary_candidates_to_review_draft',
        'build_review_draft_gate_result',
      ],
      forbidden_operations: [],
    },
    answer: {
      kind: 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_ANSWER',
      version: 'v1',
      review_draft_gate_blocked: false,
      blocked_reason: null,
      generated_review_draft_candidates: true,
      review_draft_candidates: [
        {
          kind: 'MODEL_SUGGESTION_REVIEW_DRAFT_CANDIDATE',
          version: 'v1',
          review_draft_id: 'MODEL_SUGGESTION_REVIEW_DRAFT_001',
          source_boundary_candidate_id: sourceCandidate.boundary_candidate_id,
          source_suggestion_candidate_id: sourceCandidate.source_suggestion_candidate_id,
          source_output_id: sourceCandidate.source_output_id,
          review_draft_status: 'draft_requires_human_review',
          priority_band: 'medium',
          title: 'Review draft surface only 001',
          summary: 'Safe boundary metadata was projected to a draft-only review surface.',
          evidence_summary: '1 evidence reference carried as safe summary metadata.',
          risk_summary: '1 risk flag carried as safe summary metadata.',
          review_draft_only: true,
          suggestion_only: true,
          dry_run_only: true,
          requires_human_review: true,
          enqueued: false,
          executable: false,
          confirmed_action: false,
          confirmed_action_envelope: false,
          human_confirmed: false,
          approval_recorded: false,
          enters_review_queue: false,
          enters_human_confirmation: false,
          enters_write_plan: false,
          emits_confirmed_action_envelope: false,
          emits_review_queue_candidate: false,
          produces_confirmed_action: false,
          produces_executable_proposal: false,
          reads_database: false,
          writes_database: false,
          calls_runner: false,
          calls_real_provider: false,
          uses_network: false,
          reads_env: false,
          contains_secret: false,
          contains_pii: false,
          represents_executed_action: false,
        },
      ],
      review_draft_summary: {
        kind: 'MODEL_SUGGESTION_REVIEW_DRAFT_SUMMARY',
        version: 'v1',
        candidates_built: 1,
        review_draft_only: true,
        suggestion_only: true,
        dry_run_only: true,
        executable: false,
      },
      trace_summary: {
        kind: 'MODEL_SUGGESTION_REVIEW_DRAFT_TRACE_SUMMARY',
        version: 'v1',
        request_id: 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_FIXTURE_REQUEST_A',
        source_result_kind: sourceResult.kind,
        source_reference_only: true,
        validation_checked: true,
        candidates_checked: true,
        persisted: false,
      },
      emits_review_draft_surface_only: true,
      enqueues_review_items: false,
      executes_review_items: false,
      source_adapter_boundary_result: sourceResult,
      contract_only: true,
      review_draft_gate_only: true,
      review_draft_only: true,
      suggestion_only: true,
      enters_review_queue: false,
      enters_human_confirmation: false,
      enters_write_plan: false,
      produces_confirmed_action: false,
      produces_executable_proposal: false,
      emits_confirmed_action_envelope: false,
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
    enqueues_review_items: false,
    executes_review_items: false,
    emits_confirmed_action_envelope: false,
  };
}
