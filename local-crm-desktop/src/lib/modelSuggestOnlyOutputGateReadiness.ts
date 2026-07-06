import type { ModelReadOnlyInvocationGateResult } from './modelReadOnlyInvocationGateReadiness';

export const MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ModelSuggestOnlyOutputGateBlockedReason =
  | 'invalid_request_kind'
  | 'illegal_model_call_allowed'
  | 'illegal_network_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_secret_material_allowed'
  | 'illegal_db_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_review_queue_entry_allowed'
  | 'illegal_confirmed_action_allowed'
  | 'illegal_human_confirmation_allowed'
  | 'illegal_write_plan_entry_allowed'
  | 'illegal_source_invocation_called_real_provider'
  | 'illegal_source_invocation_used_network'
  | 'illegal_source_invocation_produced_model_output'
  | 'illegal_source_invocation_produced_suggestion'
  | 'illegal_source_invocation_entered_review_queue'
  | 'illegal_source_invocation_entered_write_plan'
  | 'illegal_source_invocation_candidate_not_blocked'
  | 'illegal_model_output_from_live_provider'
  | 'illegal_model_output_from_network'
  | 'illegal_model_output_from_database'
  | 'illegal_model_output_contains_secret'
  | 'illegal_model_output_contains_pii'
  | 'illegal_model_output_trusted_for_action'
  | 'illegal_model_output_executable'
  | 'illegal_model_output_produces_proposal'
  | 'illegal_candidate_executable'
  | 'illegal_candidate_confirmed_action'
  | 'illegal_candidate_human_confirmed'
  | 'illegal_candidate_enters_review_queue'
  | 'illegal_candidate_enters_write_plan'
  | 'illegal_output_text_propagated';

export type ModelSuggestOnlyStatus =
  | 'requires_human_review'
  | 'blocked_output_untrusted'
  | 'blocked_missing_evidence'
  | 'blocked_risk_unacknowledged'
  | 'blocked_policy_only';

export interface CallerProvidedModelOutputEnvelope {
  kind: 'CALLER_PROVIDED_MODEL_OUTPUT_ENVELOPE';
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  output_id: string;
  source: 'fixture' | 'caller_provided';
  output_text: string;
  output_text_redacted: BoolTrue;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  from_live_provider: BoolFalse;
  from_network: BoolFalse;
  from_database: BoolFalse;
  persisted: BoolFalse;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
  produces_proposal: BoolFalse;
  represents_model_call: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
}

export interface ModelSuggestionPolicy {
  kind: 'MODEL_SUGGESTION_POLICY';
  policy_only: BoolTrue;
  allow_suggestion_candidate: BoolTrue;
  allow_confirmed_action: BoolFalse;
  allow_execution: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_write_plan_entry: BoolFalse;
  require_human_review_before_any_action: BoolTrue;
  require_evidence_refs: BoolTrue;
  require_risk_flags: BoolTrue;
  require_no_secret: BoolTrue;
  require_no_pii: BoolTrue;
  require_trace: BoolTrue;
}

export interface ModelSuggestOnlyOutputGateRequest {
  kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_REQUEST';
  version?: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  request_id: string;
  source_invocation_gate_result?: ModelReadOnlyInvocationGateResult;
  model_output_envelope: CallerProvidedModelOutputEnvelope;
  suggestion_policy: ModelSuggestionPolicy;
  caller_provided_only: BoolTrue;
  fixture_output_only: BoolTrue;
  suggestion_gate_only: BoolTrue;
  allow_model_call: BoolFalse;
  allow_network: BoolFalse;
  allow_env_read: BoolFalse;
  allow_secret_material: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_confirmed_action: BoolFalse;
  allow_human_confirmation: BoolFalse;
  allow_write_plan_entry: BoolFalse;
}

export interface NormalizedModelSuggestOnlyOutputGateRequest
  extends ModelSuggestOnlyOutputGateRequest {
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
}

export interface OutputSafetySummary {
  kind: 'MODEL_OUTPUT_SAFETY_SUMMARY';
  output_fixture_only: BoolTrue;
  output_redacted: BoolTrue;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  from_live_provider: BoolFalse;
  from_network: BoolFalse;
  from_database: BoolFalse;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
}

export interface SuggestionEvidenceRef {
  kind: 'MODEL_SUGGESTION_EVIDENCE_REF';
  evidence_ref_id: string;
  source: 'fixture' | 'caller_provided';
  verified: BoolFalse;
  persisted: BoolFalse;
}

export interface ModelSuggestionRiskFlag {
  kind: 'MODEL_SUGGESTION_RISK_FLAG';
  risk_code: string;
  severity: 'low' | 'medium' | 'high';
  requires_human_review: BoolTrue;
}

export interface ModelSuggestionLimitation {
  kind: 'MODEL_SUGGESTION_LIMITATION';
  limitation_code: string;
  description: string;
  blocks_execution: BoolTrue;
}

export interface HumanReviewRequirement {
  kind: 'MODEL_SUGGESTION_HUMAN_REVIEW_REQUIREMENT';
  required: BoolTrue;
  satisfied: BoolFalse;
  blocks_action: BoolTrue;
}

export interface ModelSuggestOnlyCandidate {
  kind: 'MODEL_SUGGEST_ONLY_CANDIDATE';
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  suggestion_candidate_id: string;
  source_output_id: string;
  source_invocation_candidate_id: string | null;
  suggestion_status: ModelSuggestOnlyStatus;
  title: string;
  summary: string;
  evidence_refs: readonly SuggestionEvidenceRef[];
  risk_flags: readonly ModelSuggestionRiskFlag[];
  limitations: readonly ModelSuggestionLimitation[];
  human_review_requirement: HumanReviewRequirement;
  required_human_review: BoolTrue;
  trace_refs: readonly string[];
  contract_only: BoolTrue;
  suggestion_only: BoolTrue;
  fixture_output_only: BoolTrue;
  executable: BoolFalse;
  confirmed_action: BoolFalse;
  human_confirmed: BoolFalse;
  approval_recorded: BoolFalse;
  writes_database: BoolFalse;
  reads_database: BoolFalse;
  calls_runner: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  produces_executable_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ModelSuggestOnlyOutputGatePlan {
  kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_PLAN';
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'model_suggest_only_output_gate_readiness_only';
  request: NormalizedModelSuggestOnlyOutputGateRequest;
  allowed_operations: readonly [
    'validate_caller_provided_fixture_output_envelope',
    'build_suggest_only_candidates',
    'build_suggest_only_output_gate_result',
  ];
  forbidden_operations: readonly string[];
}

export interface ModelSuggestOnlySuggestionSummary {
  kind: 'MODEL_SUGGEST_ONLY_SUMMARY';
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  candidates_built: number;
  required_human_review: BoolTrue;
  suggestion_only: BoolTrue;
  executable: BoolFalse;
}

export interface ModelSuggestOnlyTraceSummary {
  kind: 'MODEL_SUGGEST_ONLY_TRACE_SUMMARY';
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  request_id: string;
  source_output_id: string;
  validation_checked: BoolTrue;
  candidates_checked: BoolTrue;
  source_invocation_reference_only: BoolTrue;
  source_output_reference_only: BoolTrue;
  persisted: BoolFalse;
}

export interface ModelSuggestOnlyOutputGateAnswer {
  kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_ANSWER';
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  suggestion_gate_blocked: boolean;
  blocked_reason: ModelSuggestOnlyOutputGateBlockedReason | null;
  generated_suggestion_candidates: boolean;
  suggestion_candidates: readonly ModelSuggestOnlyCandidate[];
  suggestions_count: number;
  output_safety_summary: OutputSafetySummary;
  suggestion_summary: ModelSuggestOnlySuggestionSummary;
  trace_summary: ModelSuggestOnlyTraceSummary;
  source_invocation_gate_result: ModelReadOnlyInvocationGateResult | undefined;
  source_model_output_envelope: CallerProvidedModelOutputEnvelope;
  contract_only: BoolTrue;
  gate_only: BoolTrue;
  suggestion_only: BoolTrue;
  fixture_output_only: BoolTrue;
  source_contains_fixture_model_output: BoolTrue;
  model_call_performed: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  exposes_secret: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executes_action: BoolFalse;
  calls_runner: BoolFalse;
  produces_executable_proposal: BoolFalse;
  produces_confirmed_action: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
  persists_output: BoolFalse;
}

export interface ModelSuggestOnlyOutputGateResult {
  kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_RESULT';
  version: typeof MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION;
  plan: ModelSuggestOnlyOutputGatePlan;
  answer: ModelSuggestOnlyOutputGateAnswer;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  reads_env: BoolFalse;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  represents_live_model_call: BoolFalse;
  represents_model_output: BoolFalse;
  source_contains_fixture_model_output: BoolTrue;
  represents_executed_action: BoolFalse;
}

export interface ModelSuggestOnlyOutputGateValidation {
  ok: boolean;
  blocked_reason: ModelSuggestOnlyOutputGateBlockedReason | null;
}

export function buildModelSuggestOnlyOutputGatePlan(
  request: ModelSuggestOnlyOutputGateRequest,
): ModelSuggestOnlyOutputGatePlan {
  return {
    kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_PLAN',
    version: MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'model_suggest_only_output_gate_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_caller_provided_fixture_output_envelope',
      'build_suggest_only_candidates',
      'build_suggest_only_output_gate_result',
    ],
    forbidden_operations: [
      'read_database',
      'write_database',
      'read_runtime_environment',
      'open_transport_channel',
      'load_secret_material',
      'perform_live_request',
      'copy_source_output_text',
      'produce_executable_proposal',
      'enter_queue_for_action',
      'enter_human_confirmation_flow',
      'enter_write_plan',
      'execute_candidate',
      'use_runtime_runner',
    ],
  };
}

export function buildModelSuggestOnlyCandidatesFromFixtureOutput(
  request: NormalizedModelSuggestOnlyOutputGateRequest,
): readonly ModelSuggestOnlyCandidate[] {
  const source = request.model_output_envelope;
  return [
    {
      kind: 'MODEL_SUGGEST_ONLY_CANDIDATE',
      version: MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION,
      suggestion_candidate_id: 'MODEL_SUGGEST_ONLY_CANDIDATE_001',
      source_output_id: source.output_id,
      source_invocation_candidate_id: findSourceInvocationCandidateId(request.source_invocation_gate_result),
      suggestion_status: 'requires_human_review',
      title: 'Untrusted fixture output received',
      summary: 'Caller-provided fixture metadata was accepted only as a non-executable suggestion candidate.',
      evidence_refs: [
        {
          kind: 'MODEL_SUGGESTION_EVIDENCE_REF',
          evidence_ref_id: 'MODEL_SUGGESTION_EVIDENCE_001',
          source: source.source,
          verified: FALSE_VALUE,
          persisted: FALSE_VALUE,
        },
      ],
      risk_flags: [
        {
          kind: 'MODEL_SUGGESTION_RISK_FLAG',
          risk_code: 'UNTRUSTED_FIXTURE_OUTPUT',
          severity: 'medium',
          requires_human_review: TRUE_VALUE,
        },
      ],
      limitations: [
        {
          kind: 'MODEL_SUGGESTION_LIMITATION',
          limitation_code: 'NO_ACTION_WITHOUT_REVIEW',
          description: 'Fixture metadata cannot become an action without a separate reviewed flow.',
          blocks_execution: TRUE_VALUE,
        },
      ],
      human_review_requirement: {
        kind: 'MODEL_SUGGESTION_HUMAN_REVIEW_REQUIREMENT',
        required: TRUE_VALUE,
        satisfied: FALSE_VALUE,
        blocks_action: TRUE_VALUE,
      },
      required_human_review: TRUE_VALUE,
      trace_refs: ['MODEL_SUGGEST_ONLY_TRACE_001'],
      contract_only: TRUE_VALUE,
      suggestion_only: TRUE_VALUE,
      fixture_output_only: TRUE_VALUE,
      executable: FALSE_VALUE,
      confirmed_action: FALSE_VALUE,
      human_confirmed: FALSE_VALUE,
      approval_recorded: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      contains_secret: FALSE_VALUE,
      contains_pii: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      enters_write_plan: FALSE_VALUE,
      represents_executed_action: FALSE_VALUE,
    },
  ];
}

export function runModelSuggestOnlyOutputGate(
  plan: ModelSuggestOnlyOutputGatePlan,
): ModelSuggestOnlyOutputGateResult {
  const requestValidation = validateModelSuggestOnlyOutputGateRequest(plan.request);
  if (!requestValidation.ok) return buildGateResult(plan, [], requestValidation.blocked_reason);

  const candidates = buildModelSuggestOnlyCandidatesFromFixtureOutput(plan.request);
  for (const candidate of candidates) {
    const candidateValidation = validateModelSuggestOnlyCandidate(candidate, plan.request.model_output_envelope);
    if (!candidateValidation.ok) return buildGateResult(plan, [], candidateValidation.blocked_reason);
  }

  const result = buildGateResult(plan, candidates, null);
  const resultValidation = validateModelSuggestOnlyOutputGateResult(result);
  if (!resultValidation.ok) return buildGateResult(plan, [], resultValidation.blocked_reason);
  return result;
}

export function validateModelSuggestOnlyOutputGateRequest(
  request: unknown,
): ModelSuggestOnlyOutputGateValidation {
  const source = asRecord(request);
  if (source?.kind !== 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_REQUEST') return blocked('invalid_request_kind');
  if (source.allow_model_call === true) return blocked('illegal_model_call_allowed');
  if (source.allow_network === true) return blocked('illegal_network_allowed');
  if (source.allow_env_read === true) return blocked('illegal_env_read_allowed');
  if (source.allow_secret_material === true) return blocked('illegal_secret_material_allowed');
  if (source.allow_db === true) return blocked('illegal_db_allowed');
  if (source.allow_runner === true) return blocked('illegal_runner_allowed');
  if (source.allow_execution === true) return blocked('illegal_execution_allowed');
  if (source.allow_review_queue_entry === true) return blocked('illegal_review_queue_entry_allowed');
  if (source.allow_confirmed_action === true) return blocked('illegal_confirmed_action_allowed');
  if (source.allow_human_confirmation === true) return blocked('illegal_human_confirmation_allowed');
  if (source.allow_write_plan_entry === true) return blocked('illegal_write_plan_entry_allowed');

  const policy = asRecord(source.suggestion_policy);
  if (policy?.allow_confirmed_action === true) return blocked('illegal_confirmed_action_allowed');
  if (policy?.allow_execution === true) return blocked('illegal_execution_allowed');
  if (policy?.allow_review_queue_entry === true) return blocked('illegal_review_queue_entry_allowed');
  if (policy?.allow_write_plan_entry === true) return blocked('illegal_write_plan_entry_allowed');

  const invocation = asRecord(source.source_invocation_gate_result);
  if (invocation?.calls_real_provider === true) return blocked('illegal_source_invocation_called_real_provider');
  if (invocation?.uses_network === true) return blocked('illegal_source_invocation_used_network');
  const invocationAnswer = asRecord(invocation?.answer);
  if (invocationAnswer?.produces_model_output === true) {
    return blocked('illegal_source_invocation_produced_model_output');
  }
  if (invocationAnswer?.produces_suggestion === true) {
    return blocked('illegal_source_invocation_produced_suggestion');
  }
  if (invocationAnswer?.enters_review_queue === true) {
    return blocked('illegal_source_invocation_entered_review_queue');
  }
  if (invocationAnswer?.enters_write_plan === true) {
    return blocked('illegal_source_invocation_entered_write_plan');
  }
  const invocationCandidate = asRecord(invocationAnswer?.invocation_candidate);
  const invocationStatus = typeof invocationCandidate?.invocation_status === 'string'
    ? invocationCandidate.invocation_status
    : null;
  if (invocationStatus !== null && !invocationStatus.startsWith('blocked_')) {
    return blocked('illegal_source_invocation_candidate_not_blocked');
  }

  const envelopeValidation = validateCallerProvidedModelOutputEnvelope(source.model_output_envelope);
  if (!envelopeValidation.ok) return envelopeValidation;

  return { ok: true, blocked_reason: null };
}

export function validateCallerProvidedModelOutputEnvelope(
  envelope: unknown,
): ModelSuggestOnlyOutputGateValidation {
  const output = asRecord(envelope);
  if (output?.from_live_provider === true) return blocked('illegal_model_output_from_live_provider');
  if (output?.from_network === true) return blocked('illegal_model_output_from_network');
  if (output?.from_database === true) return blocked('illegal_model_output_from_database');
  if (output?.contains_secret === true) return blocked('illegal_model_output_contains_secret');
  if (output?.contains_pii === true) return blocked('illegal_model_output_contains_pii');
  if (output?.trusted_for_action === true) return blocked('illegal_model_output_trusted_for_action');
  if (output?.executable === true) return blocked('illegal_model_output_executable');
  if (output?.produces_proposal === true) return blocked('illegal_model_output_produces_proposal');
  if (output?.calls_real_provider === true) return blocked('illegal_source_invocation_called_real_provider');
  if (output?.uses_network === true) return blocked('illegal_network_allowed');
  return { ok: true, blocked_reason: null };
}

export function validateModelSuggestOnlyCandidate(
  candidate: unknown,
  sourceEnvelope?: CallerProvidedModelOutputEnvelope,
): ModelSuggestOnlyOutputGateValidation {
  const record = asRecord(candidate);
  const status = typeof record?.suggestion_status === 'string' ? record.suggestion_status : '';
  if (!ALLOWED_SUGGESTION_STATUS_VALUES.has(status)) return blocked('illegal_candidate_executable');
  if (DANGEROUS_SUGGESTION_STATUS_VALUES.has(status)) return blocked('illegal_candidate_executable');
  if (record?.executable === true) return blocked('illegal_candidate_executable');
  if (record?.confirmed_action === true) return blocked('illegal_candidate_confirmed_action');
  if (record?.human_confirmed === true) return blocked('illegal_candidate_human_confirmed');
  if (record?.enters_review_queue === true) return blocked('illegal_candidate_enters_review_queue');
  if (record?.enters_write_plan === true) return blocked('illegal_candidate_enters_write_plan');
  if ('output_text' in (record ?? {})) return blocked('illegal_output_text_propagated');
  const title = typeof record?.title === 'string' ? record.title : '';
  const summary = typeof record?.summary === 'string' ? record.summary : '';
  const sourceText = sourceEnvelope?.output_text;
  if (sourceText && (title === sourceText || summary === sourceText || summary.includes(sourceText))) {
    return blocked('illegal_output_text_propagated');
  }
  return { ok: true, blocked_reason: null };
}

export function validateModelSuggestOnlyOutputGateResult(
  result: unknown,
): ModelSuggestOnlyOutputGateValidation {
  const record = asRecord(result);
  const answer = asRecord(record?.answer);
  if (record?.persisted === true || answer?.persists_output === true) return blocked('illegal_execution_allowed');
  if (record?.calls_real_provider === true || answer?.calls_real_provider === true) {
    return blocked('illegal_source_invocation_called_real_provider');
  }
  if (record?.uses_network === true || answer?.uses_network === true) return blocked('illegal_network_allowed');
  if (record?.reads_env === true || answer?.reads_env === true) return blocked('illegal_env_read_allowed');
  if (record?.reads_database === true || answer?.reads_database === true) return blocked('illegal_db_allowed');
  if (record?.writes_database === true || answer?.writes_database === true) return blocked('illegal_db_allowed');
  if (record?.represents_model_output === true) return blocked('illegal_source_invocation_produced_model_output');
  if (answer?.produces_executable_proposal === true) return blocked('illegal_candidate_executable');
  if (answer?.produces_confirmed_action === true) return blocked('illegal_candidate_confirmed_action');
  if (answer?.enters_review_queue === true) return blocked('illegal_candidate_enters_review_queue');
  if (answer?.enters_write_plan === true) return blocked('illegal_candidate_enters_write_plan');
  if (answer?.exposes_secret === true) return blocked('illegal_model_output_contains_secret');
  const sourceEnvelope = answer?.source_model_output_envelope as CallerProvidedModelOutputEnvelope | undefined;
  const candidates = Array.isArray(answer?.suggestion_candidates) ? answer.suggestion_candidates : [];
  for (const candidate of candidates) {
    const validation = validateModelSuggestOnlyCandidate(candidate, sourceEnvelope);
    if (!validation.ok) return validation;
  }
  return { ok: true, blocked_reason: null };
}

function buildGateResult(
  plan: ModelSuggestOnlyOutputGatePlan,
  candidates: readonly ModelSuggestOnlyCandidate[],
  blockedReason: ModelSuggestOnlyOutputGateBlockedReason | null,
): ModelSuggestOnlyOutputGateResult {
  const gateBlocked = blockedReason !== null;
  const visibleCandidates = gateBlocked ? [] : candidates;
  return {
    kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_RESULT',
    version: MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION,
    plan,
    answer: {
      kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_ANSWER',
      version: MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION,
      suggestion_gate_blocked: gateBlocked,
      blocked_reason: blockedReason,
      generated_suggestion_candidates: !gateBlocked && visibleCandidates.length > 0,
      suggestion_candidates: visibleCandidates,
      suggestions_count: visibleCandidates.length,
      output_safety_summary: buildOutputSafetySummary(),
      suggestion_summary: {
        kind: 'MODEL_SUGGEST_ONLY_SUMMARY',
        version: MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION,
        candidates_built: visibleCandidates.length,
        required_human_review: TRUE_VALUE,
        suggestion_only: TRUE_VALUE,
        executable: FALSE_VALUE,
      },
      trace_summary: {
        kind: 'MODEL_SUGGEST_ONLY_TRACE_SUMMARY',
        version: MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION,
        request_id: plan.request.request_id,
        source_output_id: plan.request.model_output_envelope.output_id,
        validation_checked: TRUE_VALUE,
        candidates_checked: TRUE_VALUE,
        source_invocation_reference_only: TRUE_VALUE,
        source_output_reference_only: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      source_invocation_gate_result: plan.request.source_invocation_gate_result,
      source_model_output_envelope: plan.request.model_output_envelope,
      contract_only: TRUE_VALUE,
      gate_only: TRUE_VALUE,
      suggestion_only: TRUE_VALUE,
      fixture_output_only: TRUE_VALUE,
      source_contains_fixture_model_output: TRUE_VALUE,
      model_call_performed: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      reads_env: FALSE_VALUE,
      exposes_secret: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      executes_action: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
      produces_confirmed_action: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      enters_write_plan: FALSE_VALUE,
      persists_output: FALSE_VALUE,
    },
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    represents_model_output: FALSE_VALUE,
    source_contains_fixture_model_output: TRUE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function buildOutputSafetySummary(): OutputSafetySummary {
  return {
    kind: 'MODEL_OUTPUT_SAFETY_SUMMARY',
    output_fixture_only: TRUE_VALUE,
    output_redacted: TRUE_VALUE,
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    from_live_provider: FALSE_VALUE,
    from_network: FALSE_VALUE,
    from_database: FALSE_VALUE,
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
  };
}

function findSourceInvocationCandidateId(
  sourceInvocationGateResult: ModelReadOnlyInvocationGateResult | undefined,
): string | null {
  const candidate = sourceInvocationGateResult?.answer?.invocation_candidate;
  return candidate?.invocation_candidate_id ?? null;
}

function normalizeRequest(
  request: ModelSuggestOnlyOutputGateRequest,
): NormalizedModelSuggestOnlyOutputGateRequest {
  if (request.version === MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION) {
    return request as NormalizedModelSuggestOnlyOutputGateRequest;
  }
  return {
    ...request,
    version: MODEL_SUGGEST_ONLY_OUTPUT_GATE_VERSION,
  };
}

function blocked(
  reason: ModelSuggestOnlyOutputGateBlockedReason,
): ModelSuggestOnlyOutputGateValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const ALLOWED_SUGGESTION_STATUS_VALUES = new Set([
  'requires_human_review',
  'blocked_output_untrusted',
  'blocked_missing_evidence',
  'blocked_risk_unacknowledged',
  'blocked_policy_only',
]);

const DANGEROUS_SUGGESTION_STATUS_VALUES = new Set([
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
]);
