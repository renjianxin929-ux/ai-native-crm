import type {
  ModelSuggestionLimitation,
  ModelSuggestionRiskFlag,
  ModelSuggestOnlyOutputGateResult,
  SuggestionEvidenceRef,
} from './modelSuggestOnlyOutputGateReadiness';

export const MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ModelSuggestionAdapterBoundaryBlockedReason =
  | 'invalid_request_kind'
  | 'illegal_review_queue_entry_allowed'
  | 'illegal_confirmed_action_allowed'
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
  | 'source_suggestion_gate_blocked'
  | 'source_candidates_missing'
  | 'source_candidates_empty'
  | 'illegal_source_called_real_provider'
  | 'illegal_source_used_network'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'illegal_source_entered_review_queue'
  | 'illegal_source_entered_human_confirmation'
  | 'illegal_source_entered_write_plan'
  | 'illegal_source_produced_confirmed_action'
  | 'illegal_source_produced_executable_proposal'
  | 'illegal_source_candidate_executable'
  | 'illegal_source_candidate_confirmed_action'
  | 'illegal_source_candidate_human_confirmed'
  | 'illegal_source_candidate_enters_review_queue'
  | 'illegal_source_candidate_enters_write_plan'
  | 'illegal_source_candidate_status'
  | 'illegal_output_text_propagated'
  | 'illegal_boundary_candidate_executable'
  | 'illegal_boundary_candidate_confirmed_action'
  | 'illegal_boundary_candidate_enters_review_queue'
  | 'illegal_boundary_candidate_enters_write_plan';

export type ModelSuggestionBoundaryAdaptationStatus =
  | 'boundary_requires_human_review'
  | 'boundary_blocked_source'
  | 'boundary_policy_only';

export interface ModelSuggestionAdapterBoundaryRequest {
  kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_REQUEST';
  version: typeof MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION;
  request_id: string;
  source_suggest_only_output_gate_result: ModelSuggestOnlyOutputGateResult;
  adapter_boundary_only: BoolTrue;
  caller_provided_only: BoolTrue;
  allow_review_queue_entry: BoolFalse;
  allow_confirmed_action: BoolFalse;
  allow_human_confirmation: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_write_plan_entry: BoolFalse;
  allow_db: BoolFalse;
  allow_network: BoolFalse;
  allow_env_read: BoolFalse;
  allow_model_call: BoolFalse;
}

export interface ModelSuggestionAdapterBoundaryPlan {
  kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_PLAN';
  version: typeof MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'model_suggestion_adapter_boundary_readiness_only';
  request: ModelSuggestionAdapterBoundaryRequest;
  allowed_operations: readonly [
    'validate_caller_provided_suggest_only_result',
    'adapt_safe_suggestion_candidates',
    'build_adapter_boundary_result',
  ];
  forbidden_operations: readonly string[];
}

export interface AdaptedModelSuggestionBoundaryCandidate {
  kind: 'ADAPTED_MODEL_SUGGESTION_BOUNDARY_CANDIDATE';
  version: typeof MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION;
  boundary_candidate_id: string;
  source_suggestion_candidate_id: string;
  source_output_id: string;
  adaptation_status: ModelSuggestionBoundaryAdaptationStatus;
  title: string;
  summary: string;
  evidence_refs: readonly SuggestionEvidenceRef[];
  risk_flags: readonly ModelSuggestionRiskFlag[];
  limitations: readonly ModelSuggestionLimitation[];
  trace_refs: readonly string[];
  contract_only: BoolTrue;
  adapter_boundary_only: BoolTrue;
  suggestion_only: BoolTrue;
  fixture_output_only: BoolTrue;
  executable: BoolFalse;
  confirmed_action: BoolFalse;
  human_confirmed: BoolFalse;
  approval_recorded: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
  produces_confirmed_action: BoolFalse;
  produces_executable_proposal: BoolFalse;
  emits_confirmed_action_envelope: BoolFalse;
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

export interface ModelSuggestionAdapterBoundarySummary {
  kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_SUMMARY';
  version: typeof MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION;
  candidates_built: number;
  adapter_boundary_only: BoolTrue;
  suggestion_only: BoolTrue;
  executable: BoolFalse;
}

export interface ModelSuggestionAdapterBoundaryTraceSummary {
  kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_TRACE_SUMMARY';
  version: typeof MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION;
  request_id: string;
  source_result_kind: string;
  source_reference_only: BoolTrue;
  validation_checked: BoolTrue;
  candidates_checked: BoolTrue;
  persisted: BoolFalse;
}

export interface ModelSuggestionAdapterBoundaryAnswer {
  kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_ANSWER';
  version: typeof MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION;
  adapter_boundary_blocked: boolean;
  blocked_reason: ModelSuggestionAdapterBoundaryBlockedReason | null;
  generated_boundary_candidates: boolean;
  boundary_candidates: readonly AdaptedModelSuggestionBoundaryCandidate[];
  boundary_summary: ModelSuggestionAdapterBoundarySummary;
  trace_summary: ModelSuggestionAdapterBoundaryTraceSummary;
  source_suggest_only_output_gate_result: ModelSuggestOnlyOutputGateResult;
  contract_only: BoolTrue;
  adapter_boundary_only: BoolTrue;
  suggestion_only: BoolTrue;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
  produces_confirmed_action: BoolFalse;
  produces_executable_proposal: BoolFalse;
  executes_action: BoolFalse;
  calls_runner: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  persists_output: BoolFalse;
}

export interface ModelSuggestionAdapterBoundaryResult {
  kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_RESULT';
  version: typeof MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION;
  plan: ModelSuggestionAdapterBoundaryPlan;
  answer: ModelSuggestionAdapterBoundaryAnswer;
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
}

export interface ModelSuggestionAdapterBoundaryValidation {
  ok: boolean;
  blocked_reason: ModelSuggestionAdapterBoundaryBlockedReason | null;
}

export function buildModelSuggestionAdapterBoundaryPlan(
  request: ModelSuggestionAdapterBoundaryRequest,
): ModelSuggestionAdapterBoundaryPlan {
  return {
    kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_PLAN',
    version: MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'model_suggestion_adapter_boundary_readiness_only',
    request,
    allowed_operations: [
      'validate_caller_provided_suggest_only_result',
      'adapt_safe_suggestion_candidates',
      'build_adapter_boundary_result',
    ],
    forbidden_operations: [
      'read_database',
      'write_database',
      'read_runtime_environment',
      'open_transport_channel',
      'perform_live_request',
      'copy_source_output_text',
      'produce_executable_proposal',
      'create_action_entry',
      'create_human_confirmation_flow',
      'create_write_plan',
      'execute_candidate',
      'use_runtime_runner',
    ],
  };
}

export function adaptModelSuggestOnlyCandidatesToBoundary(
  sourceResult: ModelSuggestOnlyOutputGateResult,
): readonly AdaptedModelSuggestionBoundaryCandidate[] {
  return sourceResult.answer.suggestion_candidates.map((candidate, index) => ({
    kind: 'ADAPTED_MODEL_SUGGESTION_BOUNDARY_CANDIDATE',
    version: MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION,
    boundary_candidate_id: buildBoundaryCandidateId(index),
    source_suggestion_candidate_id: candidate.suggestion_candidate_id,
    source_output_id: candidate.source_output_id,
    adaptation_status: candidate.suggestion_status.startsWith('blocked_')
      ? 'boundary_blocked_source'
      : 'boundary_requires_human_review',
    title: `Boundary candidate ${String(index + 1).padStart(3, '0')}`,
    summary: 'Safe suggestion metadata was adapted as a contract-only boundary candidate.',
    evidence_refs: candidate.evidence_refs,
    risk_flags: candidate.risk_flags,
    limitations: candidate.limitations,
    trace_refs: candidate.trace_refs,
    contract_only: TRUE_VALUE,
    adapter_boundary_only: TRUE_VALUE,
    suggestion_only: TRUE_VALUE,
    fixture_output_only: TRUE_VALUE,
    executable: FALSE_VALUE,
    confirmed_action: FALSE_VALUE,
    human_confirmed: FALSE_VALUE,
    approval_recorded: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    enters_human_confirmation: FALSE_VALUE,
    enters_write_plan: FALSE_VALUE,
    produces_confirmed_action: FALSE_VALUE,
    produces_executable_proposal: FALSE_VALUE,
    emits_confirmed_action_envelope: FALSE_VALUE,
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

export function runModelSuggestionAdapterBoundary(
  plan: ModelSuggestionAdapterBoundaryPlan,
): ModelSuggestionAdapterBoundaryResult {
  const requestValidation = validateModelSuggestionAdapterBoundaryRequest(plan.request);
  if (!requestValidation.ok) return buildBoundaryResult(plan, [], requestValidation.blocked_reason);

  const sourceResult = plan.request.source_suggest_only_output_gate_result;
  const sourceValidation = validateSourceSuggestOnlyOutputGateResult(sourceResult);
  if (!sourceValidation.ok) return buildBoundaryResult(plan, [], sourceValidation.blocked_reason);

  const candidates = adaptModelSuggestOnlyCandidatesToBoundary(sourceResult);
  for (const candidate of candidates) {
    const candidateValidation = validateAdaptedModelSuggestionBoundaryCandidate(candidate, sourceResult);
    if (!candidateValidation.ok) return buildBoundaryResult(plan, [], candidateValidation.blocked_reason);
  }

  const result = buildBoundaryResult(plan, candidates, null);
  const resultValidation = validateModelSuggestionAdapterBoundaryResult(result);
  if (!resultValidation.ok) return buildBoundaryResult(plan, [], resultValidation.blocked_reason);
  return result;
}

export function validateModelSuggestionAdapterBoundaryRequest(
  request: unknown,
): ModelSuggestionAdapterBoundaryValidation {
  const record = asRecord(request);
  if (record?.kind !== 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_REQUEST') return blocked('invalid_request_kind');
  if (record.allow_review_queue_entry === true) return blocked('illegal_review_queue_entry_allowed');
  if (record.allow_confirmed_action === true) return blocked('illegal_confirmed_action_allowed');
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

export function validateSourceSuggestOnlyOutputGateResult(
  result: unknown,
): ModelSuggestionAdapterBoundaryValidation {
  const record = asRecord(result);
  if (record?.kind !== 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_RESULT') return blocked('invalid_source_result_kind');
  if (record.calls_real_provider === true) return blocked('illegal_source_called_real_provider');
  if (record.uses_network === true) return blocked('illegal_source_used_network');
  if (record.reads_database === true) return blocked('illegal_source_reads_database');
  if (record.writes_database === true) return blocked('illegal_source_writes_database');

  const answer = asRecord(record.answer);
  if (answer === null) return blocked('source_answer_missing');
  if (answer.suggestion_gate_blocked === true) return blocked('source_suggestion_gate_blocked');
  if (answer.generated_suggestion_candidates === false) return blocked('source_candidates_missing');
  if (answer.calls_real_provider === true) return blocked('illegal_source_called_real_provider');
  if (answer.uses_network === true) return blocked('illegal_source_used_network');
  if (answer.reads_database === true) return blocked('illegal_source_reads_database');
  if (answer.writes_database === true) return blocked('illegal_source_writes_database');
  if (answer.enters_review_queue === true) return blocked('illegal_source_entered_review_queue');
  if (answer.enters_human_confirmation === true) return blocked('illegal_source_entered_human_confirmation');
  if (answer.enters_write_plan === true) return blocked('illegal_source_entered_write_plan');
  if (answer.produces_confirmed_action === true) return blocked('illegal_source_produced_confirmed_action');
  if (answer.produces_executable_proposal === true) {
    return blocked('illegal_source_produced_executable_proposal');
  }
  if (!('suggestion_candidates' in answer)) return blocked('source_candidates_missing');
  if (!Array.isArray(answer.suggestion_candidates)) return blocked('source_candidates_missing');
  if (answer.suggestion_candidates.length === 0) return blocked('source_candidates_empty');

  for (const candidate of answer.suggestion_candidates) {
    const candidateValidation = validateSourceSuggestOnlyCandidate(candidate);
    if (!candidateValidation.ok) return candidateValidation;
  }

  return { ok: true, blocked_reason: null };
}

export function validateSourceSuggestOnlyCandidate(
  candidate: unknown,
): ModelSuggestionAdapterBoundaryValidation {
  const record = asRecord(candidate);
  const status = typeof record?.suggestion_status === 'string' ? record.suggestion_status : '';
  if (!ALLOWED_SOURCE_SUGGESTION_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (DANGEROUS_FORWARD_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (record?.executable === true) return blocked('illegal_source_candidate_executable');
  if (record?.confirmed_action === true) return blocked('illegal_source_candidate_confirmed_action');
  if (record?.human_confirmed === true) return blocked('illegal_source_candidate_human_confirmed');
  if (record?.enters_review_queue === true) return blocked('illegal_source_candidate_enters_review_queue');
  if (record?.enters_write_plan === true) return blocked('illegal_source_candidate_enters_write_plan');
  if ('output_text' in (record ?? {})) return blocked('illegal_output_text_propagated');
  return { ok: true, blocked_reason: null };
}

export function validateAdaptedModelSuggestionBoundaryCandidate(
  candidate: unknown,
  sourceResult?: ModelSuggestOnlyOutputGateResult,
): ModelSuggestionAdapterBoundaryValidation {
  const record = asRecord(candidate);
  const status = typeof record?.adaptation_status === 'string' ? record.adaptation_status : '';
  if (!ALLOWED_ADAPTATION_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (DANGEROUS_FORWARD_STATUS_VALUES.has(status)) return blocked('illegal_source_candidate_status');
  if (record?.executable === true) return blocked('illegal_boundary_candidate_executable');
  if (record?.confirmed_action === true) return blocked('illegal_boundary_candidate_confirmed_action');
  if (record?.enters_review_queue === true) return blocked('illegal_boundary_candidate_enters_review_queue');
  if (record?.enters_write_plan === true) return blocked('illegal_boundary_candidate_enters_write_plan');
  if ('output_text' in (record ?? {})) return blocked('illegal_output_text_propagated');
  if (containsSourceOutputText(record, sourceResult)) return blocked('illegal_output_text_propagated');
  return { ok: true, blocked_reason: null };
}

export function validateModelSuggestionAdapterBoundaryResult(
  result: unknown,
): ModelSuggestionAdapterBoundaryValidation {
  const record = asRecord(result);
  const answer = asRecord(record?.answer);
  if (record?.persisted === true || answer?.persists_output === true) return blocked('illegal_execution_allowed');
  if (record?.calls_real_provider === true || answer?.calls_real_provider === true) {
    return blocked('illegal_source_called_real_provider');
  }
  if (record?.uses_network === true || answer?.uses_network === true) return blocked('illegal_source_used_network');
  if (record?.reads_env === true || answer?.reads_env === true) return blocked('illegal_env_read_allowed');
  if (record?.reads_database === true || answer?.reads_database === true) {
    return blocked('illegal_source_reads_database');
  }
  if (record?.writes_database === true || answer?.writes_database === true) {
    return blocked('illegal_source_writes_database');
  }
  if (record?.represents_executed_action === true) return blocked('illegal_execution_allowed');
  if (record?.represents_confirmed_action === true) return blocked('illegal_source_produced_confirmed_action');
  if (record?.represents_review_queue_entry === true) return blocked('illegal_source_entered_review_queue');
  if (record?.represents_human_confirmation === true) {
    return blocked('illegal_source_entered_human_confirmation');
  }
  if (record?.represents_write_plan === true) return blocked('illegal_source_entered_write_plan');
  if (answer?.produces_executable_proposal === true) {
    return blocked('illegal_source_produced_executable_proposal');
  }
  if (answer?.produces_confirmed_action === true) return blocked('illegal_source_produced_confirmed_action');
  if (answer?.enters_review_queue === true) return blocked('illegal_source_entered_review_queue');
  if (answer?.enters_write_plan === true) return blocked('illegal_source_entered_write_plan');

  const sourceResult = answer?.source_suggest_only_output_gate_result as ModelSuggestOnlyOutputGateResult | undefined;
  const candidates = Array.isArray(answer?.boundary_candidates) ? answer.boundary_candidates : [];
  for (const candidate of candidates) {
    const validation = validateAdaptedModelSuggestionBoundaryCandidate(candidate, sourceResult);
    if (!validation.ok) return validation;
  }
  return { ok: true, blocked_reason: null };
}

function buildBoundaryResult(
  plan: ModelSuggestionAdapterBoundaryPlan,
  candidates: readonly AdaptedModelSuggestionBoundaryCandidate[],
  blockedReason: ModelSuggestionAdapterBoundaryBlockedReason | null,
): ModelSuggestionAdapterBoundaryResult {
  const boundaryBlocked = blockedReason !== null;
  const visibleCandidates = boundaryBlocked ? [] : candidates;
  const sourceResult = plan.request.source_suggest_only_output_gate_result;
  return {
    kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_RESULT',
    version: MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION,
    plan,
    answer: {
      kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_ANSWER',
      version: MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION,
      adapter_boundary_blocked: boundaryBlocked,
      blocked_reason: blockedReason,
      generated_boundary_candidates: !boundaryBlocked && visibleCandidates.length > 0,
      boundary_candidates: visibleCandidates,
      boundary_summary: {
        kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_SUMMARY',
        version: MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION,
        candidates_built: visibleCandidates.length,
        adapter_boundary_only: TRUE_VALUE,
        suggestion_only: TRUE_VALUE,
        executable: FALSE_VALUE,
      },
      trace_summary: {
        kind: 'MODEL_SUGGESTION_ADAPTER_BOUNDARY_TRACE_SUMMARY',
        version: MODEL_SUGGESTION_ADAPTER_BOUNDARY_VERSION,
        request_id: plan.request.request_id,
        source_result_kind: String(sourceResult?.kind ?? ''),
        source_reference_only: TRUE_VALUE,
        validation_checked: TRUE_VALUE,
        candidates_checked: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      source_suggest_only_output_gate_result: sourceResult,
      contract_only: TRUE_VALUE,
      adapter_boundary_only: TRUE_VALUE,
      suggestion_only: TRUE_VALUE,
      enters_review_queue: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      enters_write_plan: FALSE_VALUE,
      produces_confirmed_action: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
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
  };
}

function buildBoundaryCandidateId(index: number): string {
  return `ADAPTED_MODEL_SUGGESTION_BOUNDARY_${String(index + 1).padStart(3, '0')}`;
}

function containsSourceOutputText(
  candidate: Record<string, unknown> | null,
  sourceResult: ModelSuggestOnlyOutputGateResult | undefined,
): boolean {
  const sourceText = sourceResult?.answer?.source_model_output_envelope?.output_text;
  if (!sourceText || candidate === null) return false;
  const title = typeof candidate.title === 'string' ? candidate.title : '';
  const summary = typeof candidate.summary === 'string' ? candidate.summary : '';
  return title === sourceText || summary === sourceText || summary.includes(sourceText);
}

function blocked(
  reason: ModelSuggestionAdapterBoundaryBlockedReason,
): ModelSuggestionAdapterBoundaryValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const ALLOWED_SOURCE_SUGGESTION_STATUS_VALUES = new Set([
  'requires_human_review',
  'blocked_output_untrusted',
  'blocked_missing_evidence',
  'blocked_risk_unacknowledged',
  'blocked_policy_only',
]);

const ALLOWED_ADAPTATION_STATUS_VALUES = new Set([
  'boundary_requires_human_review',
  'boundary_blocked_source',
  'boundary_policy_only',
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
]);
