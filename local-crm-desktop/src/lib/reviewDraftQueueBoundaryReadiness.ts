import type {
  ModelSuggestionReviewDraftCandidate,
  ModelSuggestionReviewDraftGateResult,
} from './modelSuggestionReviewDraftGateReadiness';

export const REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ReviewDraftQueueBoundaryBlockedReason =
  | 'invalid_request_kind'
  | 'illegal_enqueue_allowed'
  | 'illegal_queue_item_allowed'
  | 'illegal_review_queue_entry_allowed'
  | 'illegal_confirmed_action_allowed'
  | 'illegal_confirmed_action_envelope_allowed'
  | 'illegal_human_confirmation_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_write_plan_entry_allowed'
  | 'illegal_db_allowed'
  | 'illegal_network_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_model_call_allowed'
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_review_draft_gate_blocked'
  | 'source_review_draft_candidates_missing'
  | 'source_review_draft_candidates_empty'
  | 'illegal_source_enqueues_review_items'
  | 'illegal_source_executes_review_items'
  | 'illegal_source_emits_confirmed_action_envelope'
  | 'illegal_source_entered_review_queue'
  | 'illegal_source_entered_human_confirmation'
  | 'illegal_source_entered_write_plan'
  | 'illegal_source_produced_confirmed_action'
  | 'illegal_source_produced_executable_proposal'
  | 'illegal_source_candidate_enqueued'
  | 'illegal_source_candidate_creates_queue_item'
  | 'illegal_source_candidate_confirmed_action'
  | 'illegal_source_candidate_confirmed_action_envelope'
  | 'illegal_source_candidate_emits_review_queue_candidate'
  | 'illegal_source_candidate_enters_review_queue'
  | 'illegal_source_candidate_enters_write_plan'
  | 'illegal_source_candidate_status'
  | 'illegal_output_text_propagated'
  | 'illegal_queue_candidate_enqueue_allowed'
  | 'illegal_queue_candidate_enqueued'
  | 'illegal_queue_candidate_creates_queue_item'
  | 'illegal_queue_candidate_queue_item_id'
  | 'illegal_queue_candidate_emits_review_queue_candidate'
  | 'illegal_queue_candidate_enters_review_queue'
  | 'illegal_queue_candidate_confirmed_action';

export type ReviewDraftQueueBoundaryStatus =
  | 'queue_boundary_blocked_permission_required'
  | 'queue_boundary_blocked_source_not_enrollable'
  | 'queue_boundary_policy_only';

export interface ReviewDraftQueueBoundaryRequest {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_REQUEST';
  version: typeof REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION;
  request_id: string;
  source_review_draft_gate_result: ModelSuggestionReviewDraftGateResult;
  queue_boundary_only: BoolTrue;
  enqueue_permission_gate_only: BoolTrue;
  caller_provided_only: BoolTrue;
  allow_enqueue: BoolFalse;
  allow_queue_item: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_confirmed_action: BoolFalse;
  allow_confirmed_action_envelope: BoolFalse;
  allow_human_confirmation: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_write_plan_entry: BoolFalse;
  allow_db: BoolFalse;
  allow_network: BoolFalse;
  allow_env_read: BoolFalse;
  allow_model_call: BoolFalse;
}

export interface ReviewDraftQueueBoundaryPlan {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_PLAN';
  version: typeof REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'review_draft_queue_boundary_readiness_only';
  request: ReviewDraftQueueBoundaryRequest;
  allowed_operations: readonly [
    'validate_caller_provided_review_draft_gate_result',
    'project_review_drafts_to_queue_boundary_candidates',
    'build_queue_boundary_result',
  ];
  forbidden_operations: readonly string[];
}

export interface ReviewDraftEnqueueDenial {
  kind: 'REVIEW_DRAFT_ENQUEUE_DENIAL';
  denial_only: BoolTrue;
  blocks_enqueue: BoolTrue;
  reason: ReviewDraftQueueBoundaryBlockedReason;
  enqueue_allowed: BoolFalse;
  creates_queue_item: BoolFalse;
  enters_review_queue: BoolFalse;
  emits_review_queue_candidate: BoolFalse;
}

export interface ReviewDraftQueueEligibilityCheck {
  kind: 'REVIEW_DRAFT_QUEUE_ELIGIBILITY_CHECK';
  check_name: string;
  required: BoolTrue;
  satisfied: BoolFalse;
  blocking: BoolTrue;
}

export interface ReviewDraftQueueBoundaryCandidate {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_CANDIDATE';
  version: typeof REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION;
  queue_boundary_candidate_id: string;
  source_review_draft_id: string;
  source_boundary_candidate_id: string;
  source_suggestion_candidate_id: string;
  source_output_id: string;
  queue_boundary_status: ReviewDraftQueueBoundaryStatus;
  blocked_reason: ReviewDraftQueueBoundaryBlockedReason;
  enqueue_denial: ReviewDraftEnqueueDenial;
  eligibility_checks: readonly ReviewDraftQueueEligibilityCheck[];
  title: string;
  summary: string;
  queue_boundary_only: BoolTrue;
  enqueue_permission_gate_only: BoolTrue;
  review_draft_only: BoolTrue;
  suggestion_only: BoolTrue;
  dry_run_only: BoolTrue;
  requires_human_review: BoolTrue;
  enqueue_allowed: BoolFalse;
  enqueued: BoolFalse;
  creates_queue_item: BoolFalse;
  queue_item_id: null;
  executable: BoolFalse;
  confirmed_action: BoolFalse;
  confirmed_action_envelope: BoolFalse;
  human_confirmed: BoolFalse;
  approval_recorded: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
  emits_confirmed_action_envelope: BoolFalse;
  emits_review_queue_candidate: BoolFalse;
  emits_confirmed_action_review_queue_result: BoolFalse;
  produces_confirmed_action: BoolFalse;
  produces_executable_proposal: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  calls_runner: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ReviewDraftQueueBoundarySummary {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_SUMMARY';
  total_candidates: number;
  blocked_candidates: number;
  enqueue_allowed_count: 0;
  enqueued_count: 0;
  queue_items_created_count: 0;
  queue_boundary_only: BoolTrue;
}

export interface ReviewDraftQueueBoundarySafety {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_SAFETY';
  any_enqueue: BoolFalse;
  any_queue_item: BoolFalse;
  any_review_queue_entry: BoolFalse;
  any_confirmed_action: BoolFalse;
  any_human_confirmation: BoolFalse;
  any_write_plan: BoolFalse;
  any_execution: BoolFalse;
  any_db_write: BoolFalse;
}

export interface ReviewDraftQueueBoundaryTraceSummary {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_TRACE_SUMMARY';
  version: typeof REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION;
  request_id: string;
  source_result_kind: string;
  source_reference_only: BoolTrue;
  validation_checked: BoolTrue;
  candidates_checked: BoolTrue;
  persisted: BoolFalse;
}

export interface ReviewDraftQueueBoundaryAnswer {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_ANSWER';
  version: typeof REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION;
  queue_boundary_blocked: boolean;
  blocked_reason: ReviewDraftQueueBoundaryBlockedReason | null;
  generated_queue_boundary_candidates: boolean;
  queue_boundary_candidates: readonly ReviewDraftQueueBoundaryCandidate[];
  queue_boundary_summary: ReviewDraftQueueBoundarySummary;
  queue_boundary_safety: ReviewDraftQueueBoundarySafety;
  trace_summary: ReviewDraftQueueBoundaryTraceSummary;
  source_review_draft_gate_result: ModelSuggestionReviewDraftGateResult;
  contract_only: BoolTrue;
  queue_boundary_only: BoolTrue;
  enqueue_permission_gate_only: BoolTrue;
  review_draft_only: BoolTrue;
  suggestion_only: BoolTrue;
  enqueues_review_items: BoolFalse;
  creates_queue_item: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
  produces_confirmed_action: BoolFalse;
  produces_executable_proposal: BoolFalse;
  emits_confirmed_action_envelope: BoolFalse;
  emits_review_queue_candidate: BoolFalse;
  emits_confirmed_action_review_queue_result: BoolFalse;
  executes_action: BoolFalse;
  calls_runner: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  persists_output: BoolFalse;
}

export interface ReviewDraftQueueBoundaryResult {
  kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_RESULT';
  version: typeof REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION;
  plan: ReviewDraftQueueBoundaryPlan;
  answer: ReviewDraftQueueBoundaryAnswer;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  reads_env: BoolFalse;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  represents_executed_action: BoolFalse;
  represents_confirmed_action: BoolFalse;
  represents_review_queue_entry: BoolFalse;
  represents_human_confirmation: BoolFalse;
  represents_write_plan: BoolFalse;
  enqueues_review_items: BoolFalse;
  creates_queue_item: BoolFalse;
  executes_review_items: BoolFalse;
  emits_confirmed_action_envelope: BoolFalse;
  emits_confirmed_action_review_queue_result: BoolFalse;
}

export interface ReviewDraftQueueBoundaryValidation {
  ok: boolean;
  blocked_reason: ReviewDraftQueueBoundaryBlockedReason | null;
}

export function buildReviewDraftQueueBoundaryPlan(
  request: ReviewDraftQueueBoundaryRequest,
): ReviewDraftQueueBoundaryPlan {
  return {
    kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_PLAN',
    version: REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'review_draft_queue_boundary_readiness_only',
    request,
    allowed_operations: [
      'validate_caller_provided_review_draft_gate_result',
      'project_review_drafts_to_queue_boundary_candidates',
      'build_queue_boundary_result',
    ],
    forbidden_operations: [
      'read_database',
      'write_database',
      'read_runtime_environment',
      'open_transport_channel',
      'perform_live_request',
      'copy_source_output_text',
      'allow_enqueue',
      'create_queue_item',
      'enter_review_queue',
      'produce_executable_proposal',
      'create_action_entry',
      'create_human_confirmation_flow',
      'create_write_plan',
      'execute_candidate',
      'use_runtime_runner',
    ],
  };
}

export function projectReviewDraftsToQueueBoundaryCandidates(
  sourceResult: ModelSuggestionReviewDraftGateResult,
): readonly ReviewDraftQueueBoundaryCandidate[] {
  return sourceResult.answer.review_draft_candidates.map((candidate, index) => ({
    kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_CANDIDATE',
    version: REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION,
    queue_boundary_candidate_id: buildQueueBoundaryCandidateId(index),
    source_review_draft_id: candidate.review_draft_id,
    source_boundary_candidate_id: candidate.source_boundary_candidate_id,
    source_suggestion_candidate_id: candidate.source_suggestion_candidate_id,
    source_output_id: candidate.source_output_id,
    queue_boundary_status: mapQueueBoundaryStatus(candidate),
    blocked_reason: 'illegal_enqueue_allowed',
    enqueue_denial: buildEnqueueDenial('illegal_enqueue_allowed'),
    eligibility_checks: buildEligibilityChecks(),
    title: `Queue boundary permission candidate ${String(index + 1).padStart(3, '0')}`,
    summary: 'Review draft metadata remains blocked at the queue boundary and does not create a queue item.',
    queue_boundary_only: TRUE_VALUE,
    enqueue_permission_gate_only: TRUE_VALUE,
    review_draft_only: TRUE_VALUE,
    suggestion_only: TRUE_VALUE,
    dry_run_only: TRUE_VALUE,
    requires_human_review: TRUE_VALUE,
    enqueue_allowed: FALSE_VALUE,
    enqueued: FALSE_VALUE,
    creates_queue_item: FALSE_VALUE,
    queue_item_id: null,
    executable: FALSE_VALUE,
    confirmed_action: FALSE_VALUE,
    confirmed_action_envelope: FALSE_VALUE,
    human_confirmed: FALSE_VALUE,
    approval_recorded: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    enters_human_confirmation: FALSE_VALUE,
    enters_write_plan: FALSE_VALUE,
    emits_confirmed_action_envelope: FALSE_VALUE,
    emits_review_queue_candidate: FALSE_VALUE,
    emits_confirmed_action_review_queue_result: FALSE_VALUE,
    produces_confirmed_action: FALSE_VALUE,
    produces_executable_proposal: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    calls_runner: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  }));
}

export function runReviewDraftQueueBoundary(
  plan: ReviewDraftQueueBoundaryPlan,
): ReviewDraftQueueBoundaryResult {
  const requestValidation = validateReviewDraftQueueBoundaryRequest(plan.request);
  if (!requestValidation.ok) return buildQueueBoundaryResult(plan, [], requestValidation.blocked_reason);

  const sourceResult = plan.request.source_review_draft_gate_result;
  const sourceValidation = validateSourceReviewDraftGateResult(sourceResult);
  if (!sourceValidation.ok) return buildQueueBoundaryResult(plan, [], sourceValidation.blocked_reason);

  const candidates = projectReviewDraftsToQueueBoundaryCandidates(sourceResult);
  for (const candidate of candidates) {
    const candidateValidation = validateReviewDraftQueueBoundaryCandidate(candidate, sourceResult);
    if (!candidateValidation.ok) return buildQueueBoundaryResult(plan, [], candidateValidation.blocked_reason);
  }

  const result = buildQueueBoundaryResult(plan, candidates, null);
  const resultValidation = validateReviewDraftQueueBoundaryResult(result);
  if (!resultValidation.ok) return buildQueueBoundaryResult(plan, [], resultValidation.blocked_reason);
  return result;
}

export function validateReviewDraftQueueBoundaryRequest(
  request: unknown,
): ReviewDraftQueueBoundaryValidation {
  const record = asRecord(request);
  if (record?.kind !== 'REVIEW_DRAFT_QUEUE_BOUNDARY_REQUEST') return blocked('invalid_request_kind');
  if (record.allow_enqueue === true) return blocked('illegal_enqueue_allowed');
  if (record.allow_queue_item === true) return blocked('illegal_queue_item_allowed');
  if (record.allow_review_queue_entry === true) return blocked('illegal_review_queue_entry_allowed');
  if (record.allow_confirmed_action === true) return blocked('illegal_confirmed_action_allowed');
  if (record.allow_confirmed_action_envelope === true) return blocked('illegal_confirmed_action_envelope_allowed');
  if (record.allow_human_confirmation === true) return blocked('illegal_human_confirmation_allowed');
  if (record.allow_runner === true) return blocked('illegal_runner_allowed');
  if (record.allow_execution === true) return blocked('illegal_execution_allowed');
  if (record.allow_write_plan_entry === true) return blocked('illegal_write_plan_entry_allowed');
  if (record.allow_db === true) return blocked('illegal_db_allowed');
  if (record.allow_network === true) return blocked('illegal_network_allowed');
  if (record.allow_env_read === true) return blocked('illegal_env_read_allowed');
  if (record.allow_model_call === true) return blocked('illegal_model_call_allowed');
  return { ok: true, blocked_reason: null };
}

export function validateSourceReviewDraftGateResult(
  result: unknown,
): ReviewDraftQueueBoundaryValidation {
  const record = asRecord(result);
  if (record?.kind !== 'MODEL_SUGGESTION_REVIEW_DRAFT_GATE_RESULT') return blocked('invalid_source_result_kind');
  if (record.enqueues_review_items === true) return blocked('illegal_source_enqueues_review_items');
  if (record.executes_review_items === true) return blocked('illegal_source_executes_review_items');
  if (record.emits_confirmed_action_envelope === true) {
    return blocked('illegal_source_emits_confirmed_action_envelope');
  }
  if (record.calls_real_provider === true) return blocked('illegal_model_call_allowed');
  if (record.uses_network === true) return blocked('illegal_network_allowed');
  if (record.reads_env === true) return blocked('illegal_env_read_allowed');
  if (record.reads_database === true || record.writes_database === true) return blocked('illegal_db_allowed');

  const answer = asRecord(record.answer);
  if (answer === null) return blocked('source_answer_missing');
  if (answer.review_draft_gate_blocked === true) return blocked('source_review_draft_gate_blocked');
  if (answer.generated_review_draft_candidates === false) {
    return blocked('source_review_draft_candidates_missing');
  }
  if (answer.enqueues_review_items === true) return blocked('illegal_source_enqueues_review_items');
  if (answer.executes_review_items === true) return blocked('illegal_source_executes_review_items');
  if (answer.enters_review_queue === true) return blocked('illegal_source_entered_review_queue');
  if (answer.enters_human_confirmation === true) return blocked('illegal_source_entered_human_confirmation');
  if (answer.enters_write_plan === true) return blocked('illegal_source_entered_write_plan');
  if (answer.produces_confirmed_action === true) return blocked('illegal_source_produced_confirmed_action');
  if (answer.produces_executable_proposal === true) {
    return blocked('illegal_source_produced_executable_proposal');
  }
  if (answer.emits_confirmed_action_envelope === true) {
    return blocked('illegal_source_emits_confirmed_action_envelope');
  }
  if (!('review_draft_candidates' in answer)) return blocked('source_review_draft_candidates_missing');
  if (!Array.isArray(answer.review_draft_candidates)) return blocked('source_review_draft_candidates_missing');
  if (answer.review_draft_candidates.length === 0) return blocked('source_review_draft_candidates_empty');

  for (const candidate of answer.review_draft_candidates) {
    const candidateValidation = validateSourceReviewDraftCandidate(
      candidate,
      result as ModelSuggestionReviewDraftGateResult,
    );
    if (!candidateValidation.ok) return candidateValidation;
  }

  return { ok: true, blocked_reason: null };
}

export function validateSourceReviewDraftCandidate(
  candidate: unknown,
  sourceResult?: ModelSuggestionReviewDraftGateResult,
): ReviewDraftQueueBoundaryValidation {
  const record = asRecord(candidate);
  const status = typeof record?.review_draft_status === 'string' ? record.review_draft_status : '';
  if (!ALLOWED_SOURCE_REVIEW_DRAFT_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (DANGEROUS_FORWARD_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (record?.enqueued === true) return blocked('illegal_source_candidate_enqueued');
  if (record?.creates_queue_item === true) return blocked('illegal_source_candidate_creates_queue_item');
  if (record?.confirmed_action === true) return blocked('illegal_source_candidate_confirmed_action');
  if (record?.confirmed_action_envelope === true) {
    return blocked('illegal_source_candidate_confirmed_action_envelope');
  }
  if (record?.emits_review_queue_candidate === true) {
    return blocked('illegal_source_candidate_emits_review_queue_candidate');
  }
  if (record?.enters_review_queue === true) return blocked('illegal_source_candidate_enters_review_queue');
  if (record?.enters_write_plan === true) return blocked('illegal_source_candidate_enters_write_plan');
  if ('output_text' in (record ?? {})) return blocked('illegal_output_text_propagated');
  if (containsSourceOutputText(record, sourceResult)) return blocked('illegal_output_text_propagated');
  return { ok: true, blocked_reason: null };
}

export function validateReviewDraftQueueBoundaryCandidate(
  candidate: unknown,
  sourceResult?: ModelSuggestionReviewDraftGateResult,
): ReviewDraftQueueBoundaryValidation {
  const record = asRecord(candidate);
  const status = typeof record?.queue_boundary_status === 'string' ? record.queue_boundary_status : '';
  if (!ALLOWED_QUEUE_BOUNDARY_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (DANGEROUS_FORWARD_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (record?.enqueue_allowed === true) return blocked('illegal_queue_candidate_enqueue_allowed');
  if (record?.enqueued === true) return blocked('illegal_queue_candidate_enqueued');
  if (record?.creates_queue_item === true) return blocked('illegal_queue_candidate_creates_queue_item');
  if (record?.queue_item_id !== null) return blocked('illegal_queue_candidate_queue_item_id');
  if (record?.emits_review_queue_candidate === true) {
    return blocked('illegal_queue_candidate_emits_review_queue_candidate');
  }
  if (record?.enters_review_queue === true) return blocked('illegal_queue_candidate_enters_review_queue');
  if (record?.confirmed_action === true) return blocked('illegal_queue_candidate_confirmed_action');
  if (record?.emits_confirmed_action_review_queue_result === true) {
    return blocked('illegal_queue_candidate_emits_review_queue_candidate');
  }
  if ('output_text' in (record ?? {})) return blocked('illegal_output_text_propagated');
  if (containsSourceOutputText(record, sourceResult)) return blocked('illegal_output_text_propagated');
  return { ok: true, blocked_reason: null };
}

export function validateReviewDraftQueueBoundaryResult(
  result: unknown,
): ReviewDraftQueueBoundaryValidation {
  const record = asRecord(result);
  const answer = asRecord(record?.answer);
  if (record?.persisted === true || answer?.persists_output === true) return blocked('illegal_execution_allowed');
  if (record?.enqueues_review_items === true || answer?.enqueues_review_items === true) {
    return blocked('illegal_source_enqueues_review_items');
  }
  if (record?.creates_queue_item === true || answer?.creates_queue_item === true) {
    return blocked('illegal_queue_candidate_creates_queue_item');
  }
  if (record?.executes_review_items === true) return blocked('illegal_source_executes_review_items');
  if (record?.emits_confirmed_action_envelope === true || answer?.emits_confirmed_action_envelope === true) {
    return blocked('illegal_source_emits_confirmed_action_envelope');
  }
  if (
    record?.emits_confirmed_action_review_queue_result === true
    || answer?.emits_confirmed_action_review_queue_result === true
  ) {
    return blocked('illegal_queue_candidate_emits_review_queue_candidate');
  }
  if (record?.calls_real_provider === true || answer?.calls_real_provider === true) {
    return blocked('illegal_model_call_allowed');
  }
  if (record?.uses_network === true || answer?.uses_network === true) return blocked('illegal_network_allowed');
  if (record?.reads_env === true || answer?.reads_env === true) return blocked('illegal_env_read_allowed');
  if (
    record?.reads_database === true
    || answer?.reads_database === true
    || record?.writes_database === true
    || answer?.writes_database === true
  ) {
    return blocked('illegal_db_allowed');
  }
  if (record?.represents_executed_action === true) return blocked('illegal_execution_allowed');
  if (record?.represents_confirmed_action === true) return blocked('illegal_source_produced_confirmed_action');
  if (record?.represents_review_queue_entry === true) return blocked('illegal_source_entered_review_queue');
  if (record?.represents_human_confirmation === true) return blocked('illegal_source_entered_human_confirmation');
  if (record?.represents_write_plan === true) return blocked('illegal_source_entered_write_plan');
  if (answer?.produces_confirmed_action === true) return blocked('illegal_source_produced_confirmed_action');
  if (answer?.produces_executable_proposal === true) {
    return blocked('illegal_source_produced_executable_proposal');
  }
  if (answer?.enters_review_queue === true) return blocked('illegal_source_entered_review_queue');
  if (answer?.enters_write_plan === true) return blocked('illegal_source_entered_write_plan');

  const sourceResult = answer?.source_review_draft_gate_result as ModelSuggestionReviewDraftGateResult | undefined;
  const candidates = Array.isArray(answer?.queue_boundary_candidates) ? answer.queue_boundary_candidates : [];
  for (const candidate of candidates) {
    const validation = validateReviewDraftQueueBoundaryCandidate(candidate, sourceResult);
    if (!validation.ok) return validation;
  }
  return { ok: true, blocked_reason: null };
}

function buildQueueBoundaryResult(
  plan: ReviewDraftQueueBoundaryPlan,
  candidates: readonly ReviewDraftQueueBoundaryCandidate[],
  blockedReason: ReviewDraftQueueBoundaryBlockedReason | null,
): ReviewDraftQueueBoundaryResult {
  const boundaryBlocked = blockedReason !== null;
  const visibleCandidates = boundaryBlocked ? [] : candidates;
  const sourceResult = plan.request.source_review_draft_gate_result;
  return {
    kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_RESULT',
    version: REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION,
    plan,
    answer: {
      kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_ANSWER',
      version: REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION,
      queue_boundary_blocked: boundaryBlocked,
      blocked_reason: blockedReason,
      generated_queue_boundary_candidates: !boundaryBlocked && visibleCandidates.length > 0,
      queue_boundary_candidates: visibleCandidates,
      queue_boundary_summary: {
        kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_SUMMARY',
        total_candidates: visibleCandidates.length,
        blocked_candidates: visibleCandidates.length,
        enqueue_allowed_count: 0,
        enqueued_count: 0,
        queue_items_created_count: 0,
        queue_boundary_only: TRUE_VALUE,
      },
      queue_boundary_safety: {
        kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_SAFETY',
        any_enqueue: FALSE_VALUE,
        any_queue_item: FALSE_VALUE,
        any_review_queue_entry: FALSE_VALUE,
        any_confirmed_action: FALSE_VALUE,
        any_human_confirmation: FALSE_VALUE,
        any_write_plan: FALSE_VALUE,
        any_execution: FALSE_VALUE,
        any_db_write: FALSE_VALUE,
      },
      trace_summary: {
        kind: 'REVIEW_DRAFT_QUEUE_BOUNDARY_TRACE_SUMMARY',
        version: REVIEW_DRAFT_QUEUE_BOUNDARY_VERSION,
        request_id: plan.request.request_id,
        source_result_kind: String(sourceResult?.kind ?? ''),
        source_reference_only: TRUE_VALUE,
        validation_checked: TRUE_VALUE,
        candidates_checked: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      source_review_draft_gate_result: sourceResult,
      contract_only: TRUE_VALUE,
      queue_boundary_only: TRUE_VALUE,
      enqueue_permission_gate_only: TRUE_VALUE,
      review_draft_only: TRUE_VALUE,
      suggestion_only: TRUE_VALUE,
      enqueues_review_items: FALSE_VALUE,
      creates_queue_item: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      enters_write_plan: FALSE_VALUE,
      produces_confirmed_action: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
      emits_confirmed_action_envelope: FALSE_VALUE,
      emits_review_queue_candidate: FALSE_VALUE,
      emits_confirmed_action_review_queue_result: FALSE_VALUE,
      executes_action: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      reads_env: FALSE_VALUE,
      persists_output: FALSE_VALUE,
    },
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_confirmed_action: FALSE_VALUE,
    represents_review_queue_entry: FALSE_VALUE,
    represents_human_confirmation: FALSE_VALUE,
    represents_write_plan: FALSE_VALUE,
    enqueues_review_items: FALSE_VALUE,
    creates_queue_item: FALSE_VALUE,
    executes_review_items: FALSE_VALUE,
    emits_confirmed_action_envelope: FALSE_VALUE,
    emits_confirmed_action_review_queue_result: FALSE_VALUE,
  };
}

function buildQueueBoundaryCandidateId(index: number): string {
  return `REVIEW_DRAFT_QUEUE_BOUNDARY_${String(index + 1).padStart(3, '0')}`;
}

function buildEnqueueDenial(reason: ReviewDraftQueueBoundaryBlockedReason): ReviewDraftEnqueueDenial {
  return {
    kind: 'REVIEW_DRAFT_ENQUEUE_DENIAL',
    denial_only: TRUE_VALUE,
    blocks_enqueue: TRUE_VALUE,
    reason,
    enqueue_allowed: FALSE_VALUE,
    creates_queue_item: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    emits_review_queue_candidate: FALSE_VALUE,
  };
}

function buildEligibilityChecks(): readonly ReviewDraftQueueEligibilityCheck[] {
  return [
    {
      kind: 'REVIEW_DRAFT_QUEUE_ELIGIBILITY_CHECK',
      check_name: 'separate_permission_required',
      required: TRUE_VALUE,
      satisfied: FALSE_VALUE,
      blocking: TRUE_VALUE,
    },
    {
      kind: 'REVIEW_DRAFT_QUEUE_ELIGIBILITY_CHECK',
      check_name: 'queue_item_creation_disallowed',
      required: TRUE_VALUE,
      satisfied: FALSE_VALUE,
      blocking: TRUE_VALUE,
    },
  ];
}

function mapQueueBoundaryStatus(
  candidate: ModelSuggestionReviewDraftCandidate,
): ReviewDraftQueueBoundaryStatus {
  if (candidate.review_draft_status === 'draft_policy_only') return 'queue_boundary_policy_only';
  if (candidate.review_draft_status === 'draft_blocked_source') return 'queue_boundary_blocked_source_not_enrollable';
  return 'queue_boundary_blocked_permission_required';
}

function containsSourceOutputText(
  candidate: Record<string, unknown> | null,
  sourceResult: ModelSuggestionReviewDraftGateResult | undefined,
): boolean {
  const sourceText = sourceResult
    ?.answer
    ?.source_adapter_boundary_result
    ?.answer
    ?.source_suggest_only_output_gate_result
    ?.answer
    ?.source_model_output_envelope
    ?.output_text;
  if (!sourceText || candidate === null) return false;
  const title = typeof candidate.title === 'string' ? candidate.title : '';
  const summary = typeof candidate.summary === 'string' ? candidate.summary : '';
  return [title, summary].some(value => value === sourceText || value.includes(sourceText));
}

function blocked(reason: ReviewDraftQueueBoundaryBlockedReason): ReviewDraftQueueBoundaryValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const ALLOWED_SOURCE_REVIEW_DRAFT_STATUS_VALUES = new Set([
  'draft_requires_human_review',
  'draft_blocked_source',
  'draft_policy_only',
]);

const ALLOWED_QUEUE_BOUNDARY_STATUS_VALUES = new Set([
  'queue_boundary_blocked_permission_required',
  'queue_boundary_blocked_source_not_enrollable',
  'queue_boundary_policy_only',
]);

const DANGEROUS_FORWARD_STATUS_VALUES = new Set([
  'ready',
  'approved',
  'confirmed',
  'executable',
  'queued',
  'sent_to_review',
  'runnable',
  'success',
  'completed',
  'written',
  'enqueued',
  'queue_ready',
  'enqueue_ready',
]);
