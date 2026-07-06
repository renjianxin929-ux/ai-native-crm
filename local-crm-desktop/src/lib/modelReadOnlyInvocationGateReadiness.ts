import type { ModelProviderBoundaryContractResult } from './modelProviderBoundaryContractReadiness';

export const MODEL_READ_ONLY_INVOCATION_GATE_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ModelReadOnlyInvocationGateBlockedReason =
  | 'invalid_request_kind'
  | 'illegal_invocation_allowed'
  | 'illegal_live_call_allowed'
  | 'illegal_network_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_secret_material_allowed'
  | 'illegal_db_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_review_queue_entry_allowed'
  | 'illegal_write_plan_entry_allowed'
  | 'illegal_invocation_input_resolved'
  | 'illegal_invocation_input_contains_secret'
  | 'illegal_invocation_input_contains_pii'
  | 'illegal_invocation_input_from_database'
  | 'illegal_invocation_input_from_live_customer_data'
  | 'illegal_invocation_input_usable_for_live_call'
  | 'illegal_source_boundary_called_real_provider'
  | 'illegal_source_boundary_used_network'
  | 'illegal_source_boundary_live_ready'
  | 'illegal_source_boundary_adapter_ready'
  | 'illegal_output_produces_model_output'
  | 'illegal_output_produces_suggestion'
  | 'illegal_output_enters_review_queue'
  | 'illegal_output_enters_write_plan'
  | 'illegal_output_contains_secret';

export type ModelReadOnlyInvocationStatus =
  | 'blocked_boundary_not_live_ready'
  | 'blocked_missing_redacted_input'
  | 'blocked_missing_user_approval'
  | 'blocked_network_not_allowed'
  | 'blocked_env_not_allowed'
  | 'blocked_invocation_policy_only';

export interface InvocationInputPlaceholder {
  kind: 'MODEL_INVOCATION_INPUT_PLACEHOLDER';
  placeholder_only: BoolTrue;
  source: 'future_redacted_prompt';
  resolved: BoolFalse;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  from_live_customer_data: BoolFalse;
  from_database: BoolFalse;
  persisted: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface InvocationPolicy {
  kind: 'MODEL_READ_ONLY_INVOCATION_POLICY';
  policy_only: BoolTrue;
  allow_invocation: BoolFalse;
  allow_live_call: BoolFalse;
  allow_network: BoolFalse;
  allow_env_read: BoolFalse;
  allow_tool_calls: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  require_redacted_input: BoolTrue;
  require_boundary_contract: BoolTrue;
  require_user_approval_before_live_call: BoolTrue;
  require_timeout_policy: BoolTrue;
  require_cost_limit: BoolTrue;
  require_audit_trace: BoolTrue;
}

export interface ModelReadOnlyInvocationGateRequest {
  kind: 'MODEL_READ_ONLY_INVOCATION_GATE_REQUEST';
  version?: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
  request_id: string;
  source_boundary_result?: ModelProviderBoundaryContractResult;
  requested_provider_kind: string;
  requested_model_id: string;
  invocation_input_placeholder: InvocationInputPlaceholder;
  invocation_policy: InvocationPolicy;
  caller_provided_only: BoolTrue;
  invocation_gate_only: BoolTrue;
  allow_invocation: BoolFalse;
  allow_live_call: BoolFalse;
  allow_network: BoolFalse;
  allow_env_read: BoolFalse;
  allow_secret_material: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_write_plan_entry: BoolFalse;
}

export interface NormalizedModelReadOnlyInvocationGateRequest
  extends ModelReadOnlyInvocationGateRequest {
  version: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
}

export interface InvocationDenial {
  kind: 'MODEL_INVOCATION_DENIAL';
  denial_only: BoolTrue;
  blocks_invocation: BoolTrue;
  reason: ModelReadOnlyInvocationStatus;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  produces_model_output: BoolFalse;
  missing_requirements: readonly string[];
}

export interface EligibilityCheck {
  kind: 'MODEL_INVOCATION_ELIGIBILITY_CHECK';
  check_name: string;
  required: BoolTrue;
  satisfied: BoolFalse;
  blocking: BoolTrue;
}

export interface InvocationSafetySummary {
  kind: 'MODEL_INVOCATION_SAFETY_SUMMARY';
  all_candidates_blocked: BoolTrue;
  any_invocation_ready: BoolFalse;
  any_live_call: BoolFalse;
  any_network: BoolFalse;
  any_env_read: BoolFalse;
  any_secret: BoolFalse;
  any_model_output: BoolFalse;
  any_review_queue_entry: BoolFalse;
  any_write_plan_entry: BoolFalse;
}

export interface ModelReadOnlyInvocationCandidate {
  kind: 'MODEL_READ_ONLY_INVOCATION_CANDIDATE';
  version: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
  invocation_candidate_id: string;
  provider_kind: string;
  model_id: string;
  invocation_status: ModelReadOnlyInvocationStatus;
  blocked_reason: ModelReadOnlyInvocationStatus;
  source_boundary_candidate_id: string | null;
  invocation_input_placeholder: InvocationInputPlaceholder;
  invocation_policy_snapshot: InvocationPolicy;
  required_eligibility_checks: readonly EligibilityCheck[];
  missing_requirements: readonly string[];
  invocation_denial: InvocationDenial;
  contract_only: BoolTrue;
  gate_only: BoolTrue;
  read_only: BoolTrue;
  invocation_ready: BoolFalse;
  live_call_ready: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  exposes_secret: BoolFalse;
  executable: BoolFalse;
  produces_model_output: BoolFalse;
  produces_suggestion: BoolFalse;
  produces_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_write_plan: BoolFalse;
  represents_live_model_call: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ModelReadOnlyInvocationGatePlan {
  kind: 'MODEL_READ_ONLY_INVOCATION_GATE_PLAN';
  version: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'model_read_only_invocation_gate_readiness_only';
  request: NormalizedModelReadOnlyInvocationGateRequest;
  allowed_operations: readonly [
    'validate_caller_provided_invocation_gate_request',
    'build_blocked_invocation_candidate',
    'build_invocation_gate_result',
  ];
  forbidden_operations: readonly string[];
}

export interface ModelReadOnlyInvocationEligibilitySummary {
  kind: 'MODEL_READ_ONLY_INVOCATION_ELIGIBILITY_SUMMARY';
  version: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
  all_required_checks_satisfied: BoolFalse;
  blocked_check_count: number;
  invocation_ready: BoolFalse;
  live_call_ready: BoolFalse;
}

export interface ModelReadOnlyInvocationTraceSummary {
  kind: 'MODEL_READ_ONLY_INVOCATION_TRACE_SUMMARY';
  version: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
  request_id: string;
  validation_checked: BoolTrue;
  candidate_checked: BoolTrue;
  source_boundary_reference_only: BoolTrue;
  persisted: BoolFalse;
}

export interface ModelReadOnlyInvocationGateAnswer {
  kind: 'MODEL_READ_ONLY_INVOCATION_GATE_ANSWER';
  version: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
  invocation_gate_blocked: boolean;
  blocked_reason: ModelReadOnlyInvocationGateBlockedReason | null;
  generated_invocation_candidate: boolean;
  invocation_candidate: ModelReadOnlyInvocationCandidate | null;
  invocation_denial: InvocationDenial;
  eligibility_summary: ModelReadOnlyInvocationEligibilitySummary;
  safety_summary: InvocationSafetySummary;
  trace_summary: ModelReadOnlyInvocationTraceSummary;
  source_boundary_result: ModelProviderBoundaryContractResult | undefined;
  contract_only: BoolTrue;
  gate_only: BoolTrue;
  read_only: BoolTrue;
  invocation_ready: BoolFalse;
  live_call_ready: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  exposes_secret: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executes_action: BoolFalse;
  calls_runner: BoolFalse;
  produces_model_output: BoolFalse;
  produces_suggestion: BoolFalse;
  produces_executable_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
}

export interface ModelReadOnlyInvocationGateResult {
  kind: 'MODEL_READ_ONLY_INVOCATION_GATE_RESULT';
  version: typeof MODEL_READ_ONLY_INVOCATION_GATE_VERSION;
  plan: ModelReadOnlyInvocationGatePlan;
  answer: ModelReadOnlyInvocationGateAnswer;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  reads_env: BoolFalse;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  represents_live_model_call: BoolFalse;
  represents_model_output: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ModelReadOnlyInvocationGateValidation {
  ok: boolean;
  blocked_reason: ModelReadOnlyInvocationGateBlockedReason | null;
}

export function buildModelReadOnlyInvocationGatePlan(
  request: ModelReadOnlyInvocationGateRequest,
): ModelReadOnlyInvocationGatePlan {
  return {
    kind: 'MODEL_READ_ONLY_INVOCATION_GATE_PLAN',
    version: MODEL_READ_ONLY_INVOCATION_GATE_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'model_read_only_invocation_gate_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_caller_provided_invocation_gate_request',
      'build_blocked_invocation_candidate',
      'build_invocation_gate_result',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'read_env_values',
      'open_network_channel',
      'load_secret_material',
      'perform_live_model_request',
      'produce_model_output',
      'produce_suggestion',
      'enter_review_queue',
      'enter_human_confirmation',
      'enter_write_plan',
      'execute_model_output',
      'use_runner',
    ],
  };
}

export function buildBlockedModelReadOnlyInvocationCandidate(
  request: NormalizedModelReadOnlyInvocationGateRequest,
  index = 0,
): ModelReadOnlyInvocationCandidate {
  const status: ModelReadOnlyInvocationStatus = 'blocked_invocation_policy_only';
  const missingRequirements = [
    'redacted_input_resolution',
    'live_model_user_approval',
    'network_approval',
    'runtime_secret_boundary',
    'timeout_policy',
    'cost_limit',
    'audit_trace',
  ];
  const eligibilityChecks = buildEligibilityChecks();
  const denial = buildInvocationDenial(status, missingRequirements);

  return {
    kind: 'MODEL_READ_ONLY_INVOCATION_CANDIDATE',
    version: MODEL_READ_ONLY_INVOCATION_GATE_VERSION,
    invocation_candidate_id: `MODEL_INVOCATION_GATE_CANDIDATE_${String(index + 1).padStart(3, '0')}`,
    provider_kind: request.requested_provider_kind,
    model_id: request.requested_model_id,
    invocation_status: status,
    blocked_reason: status,
    source_boundary_candidate_id: findSourceBoundaryCandidateId(request.source_boundary_result),
    invocation_input_placeholder: request.invocation_input_placeholder,
    invocation_policy_snapshot: request.invocation_policy,
    required_eligibility_checks: eligibilityChecks,
    missing_requirements: missingRequirements,
    invocation_denial: denial,
    contract_only: TRUE_VALUE,
    gate_only: TRUE_VALUE,
    read_only: TRUE_VALUE,
    invocation_ready: FALSE_VALUE,
    live_call_ready: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    exposes_secret: FALSE_VALUE,
    executable: FALSE_VALUE,
    produces_model_output: FALSE_VALUE,
    produces_suggestion: FALSE_VALUE,
    produces_proposal: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    enters_write_plan: FALSE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

export function runModelReadOnlyInvocationGate(
  plan: ModelReadOnlyInvocationGatePlan,
): ModelReadOnlyInvocationGateResult {
  const requestValidation = validateModelReadOnlyInvocationGateRequest(plan.request);
  if (!requestValidation.ok) return buildGateResult(plan, null, requestValidation.blocked_reason);

  const candidate = buildBlockedModelReadOnlyInvocationCandidate(plan.request);
  const candidateValidation = validateModelReadOnlyInvocationCandidate(candidate);
  if (!candidateValidation.ok) return buildGateResult(plan, null, candidateValidation.blocked_reason);

  const result = buildGateResult(plan, candidate, null);
  const resultValidation = validateModelReadOnlyInvocationGateResult(result);
  if (!resultValidation.ok) return buildGateResult(plan, null, resultValidation.blocked_reason);
  return result;
}

export function validateModelReadOnlyInvocationGateRequest(
  request: unknown,
): ModelReadOnlyInvocationGateValidation {
  const source = asRecord(request);
  if (source?.kind !== 'MODEL_READ_ONLY_INVOCATION_GATE_REQUEST') return blocked('invalid_request_kind');
  if (source.allow_invocation === true) return blocked('illegal_invocation_allowed');
  if (source.allow_live_call === true) return blocked('illegal_live_call_allowed');
  if (source.allow_network === true) return blocked('illegal_network_allowed');
  if (source.allow_env_read === true) return blocked('illegal_env_read_allowed');
  if (source.allow_secret_material === true) return blocked('illegal_secret_material_allowed');
  if (source.allow_db === true) return blocked('illegal_db_allowed');
  if (source.allow_runner === true) return blocked('illegal_runner_allowed');
  if (source.allow_execution === true) return blocked('illegal_execution_allowed');
  if (source.allow_review_queue_entry === true) return blocked('illegal_review_queue_entry_allowed');
  if (source.allow_write_plan_entry === true) return blocked('illegal_write_plan_entry_allowed');

  const input = asRecord(source.invocation_input_placeholder);
  if (input?.resolved === true) return blocked('illegal_invocation_input_resolved');
  if (input?.contains_secret === true) return blocked('illegal_invocation_input_contains_secret');
  if (input?.contains_pii === true) return blocked('illegal_invocation_input_contains_pii');
  if (input?.from_database === true) return blocked('illegal_invocation_input_from_database');
  if (input?.from_live_customer_data === true) {
    return blocked('illegal_invocation_input_from_live_customer_data');
  }
  if (input?.usable_for_live_call === true) return blocked('illegal_invocation_input_usable_for_live_call');

  const policy = asRecord(source.invocation_policy);
  if (policy?.allow_invocation === true) return blocked('illegal_invocation_allowed');
  if (policy?.allow_live_call === true) return blocked('illegal_live_call_allowed');
  if (policy?.allow_network === true) return blocked('illegal_network_allowed');
  if (policy?.allow_env_read === true) return blocked('illegal_env_read_allowed');
  if (policy?.allow_tool_calls === true) return blocked('illegal_execution_allowed');
  if (policy?.allow_db === true) return blocked('illegal_db_allowed');
  if (policy?.allow_runner === true) return blocked('illegal_runner_allowed');
  if (policy?.allow_execution === true) return blocked('illegal_execution_allowed');

  const boundary = asRecord(source.source_boundary_result);
  if (boundary?.calls_real_provider === true) return blocked('illegal_source_boundary_called_real_provider');
  if (boundary?.uses_network === true) return blocked('illegal_source_boundary_used_network');

  const answer = asRecord(boundary?.answer);
  if (answer?.live_call_ready === true) return blocked('illegal_source_boundary_live_ready');

  const candidate = asRecord(answer?.live_adapter_candidate);
  const adapterStatus = typeof candidate?.adapter_status === 'string' ? candidate.adapter_status : null;
  if (adapterStatus !== null && !adapterStatus.startsWith('blocked_')) {
    return blocked('illegal_source_boundary_adapter_ready');
  }

  return { ok: true, blocked_reason: null };
}

export function validateModelReadOnlyInvocationCandidate(
  candidate: unknown,
): ModelReadOnlyInvocationGateValidation {
  const record = asRecord(candidate);
  const status = typeof record?.invocation_status === 'string' ? record.invocation_status : '';
  if (!status.startsWith('blocked_')) return blocked('illegal_source_boundary_adapter_ready');
  if (DANGEROUS_INVOCATION_STATUS_VALUES.has(status)) return blocked('illegal_source_boundary_adapter_ready');
  if (record?.invocation_ready === true || record?.live_call_ready === true || record?.executable === true) {
    return blocked('illegal_invocation_allowed');
  }
  if (record?.calls_real_provider === true) return blocked('illegal_source_boundary_called_real_provider');
  if (record?.uses_network === true) return blocked('illegal_network_allowed');
  if (record?.reads_env === true) return blocked('illegal_env_read_allowed');
  if (record?.contains_secret === true || record?.contains_pii === true || record?.exposes_secret === true) {
    return blocked('illegal_output_contains_secret');
  }
  if (record?.produces_model_output === true) return blocked('illegal_output_produces_model_output');
  if (record?.produces_suggestion === true || record?.produces_proposal === true) {
    return blocked('illegal_output_produces_suggestion');
  }
  if (record?.enters_review_queue === true) return blocked('illegal_output_enters_review_queue');
  if (record?.enters_write_plan === true) return blocked('illegal_output_enters_write_plan');
  if (record?.represents_live_model_call === true) return blocked('illegal_live_call_allowed');
  if (record?.represents_executed_action === true) return blocked('illegal_execution_allowed');
  return { ok: true, blocked_reason: null };
}

export function validateModelReadOnlyInvocationGateResult(
  result: unknown,
): ModelReadOnlyInvocationGateValidation {
  const record = asRecord(result);
  const answer = asRecord(record?.answer);
  const candidate = asRecord(answer?.invocation_candidate);
  if (record?.persisted === true) return blocked('illegal_execution_allowed');
  if (record?.calls_real_provider === true || answer?.calls_real_provider === true) {
    return blocked('illegal_source_boundary_called_real_provider');
  }
  if (record?.uses_network === true || answer?.uses_network === true) return blocked('illegal_network_allowed');
  if (record?.reads_env === true || answer?.reads_env === true) return blocked('illegal_env_read_allowed');
  if (record?.reads_database === true || answer?.reads_database === true) return blocked('illegal_db_allowed');
  if (record?.writes_database === true || answer?.writes_database === true) return blocked('illegal_db_allowed');
  if (record?.represents_model_output === true || answer?.produces_model_output === true) {
    return blocked('illegal_output_produces_model_output');
  }
  if (answer?.produces_suggestion === true || answer?.produces_executable_proposal === true) {
    return blocked('illegal_output_produces_suggestion');
  }
  if (answer?.enters_review_queue === true) return blocked('illegal_output_enters_review_queue');
  if (answer?.enters_write_plan === true) return blocked('illegal_output_enters_write_plan');
  if (answer?.exposes_secret === true) return blocked('illegal_output_contains_secret');
  if (candidate) return validateModelReadOnlyInvocationCandidate(candidate);
  return { ok: true, blocked_reason: null };
}

function buildGateResult(
  plan: ModelReadOnlyInvocationGatePlan,
  candidate: ModelReadOnlyInvocationCandidate | null,
  blockedReason: ModelReadOnlyInvocationGateBlockedReason | null,
): ModelReadOnlyInvocationGateResult {
  const gateBlocked = blockedReason !== null;
  const denial = candidate?.invocation_denial
    ?? buildInvocationDenial('blocked_invocation_policy_only', [
      'redacted_input_resolution',
      'live_model_user_approval',
      'network_approval',
      'runtime_secret_boundary',
      'timeout_policy',
      'cost_limit',
      'audit_trace',
    ]);

  return {
    kind: 'MODEL_READ_ONLY_INVOCATION_GATE_RESULT',
    version: MODEL_READ_ONLY_INVOCATION_GATE_VERSION,
    plan,
    answer: {
      kind: 'MODEL_READ_ONLY_INVOCATION_GATE_ANSWER',
      version: MODEL_READ_ONLY_INVOCATION_GATE_VERSION,
      invocation_gate_blocked: gateBlocked,
      blocked_reason: blockedReason,
      generated_invocation_candidate: !gateBlocked && candidate !== null,
      invocation_candidate: gateBlocked ? null : candidate,
      invocation_denial: denial,
      eligibility_summary: {
        kind: 'MODEL_READ_ONLY_INVOCATION_ELIGIBILITY_SUMMARY',
        version: MODEL_READ_ONLY_INVOCATION_GATE_VERSION,
        all_required_checks_satisfied: FALSE_VALUE,
        blocked_check_count: denial.missing_requirements.length,
        invocation_ready: FALSE_VALUE,
        live_call_ready: FALSE_VALUE,
      },
      safety_summary: {
        kind: 'MODEL_INVOCATION_SAFETY_SUMMARY',
        all_candidates_blocked: TRUE_VALUE,
        any_invocation_ready: FALSE_VALUE,
        any_live_call: FALSE_VALUE,
        any_network: FALSE_VALUE,
        any_env_read: FALSE_VALUE,
        any_secret: FALSE_VALUE,
        any_model_output: FALSE_VALUE,
        any_review_queue_entry: FALSE_VALUE,
        any_write_plan_entry: FALSE_VALUE,
      },
      trace_summary: {
        kind: 'MODEL_READ_ONLY_INVOCATION_TRACE_SUMMARY',
        version: MODEL_READ_ONLY_INVOCATION_GATE_VERSION,
        request_id: plan.request.request_id,
        validation_checked: TRUE_VALUE,
        candidate_checked: TRUE_VALUE,
        source_boundary_reference_only: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      source_boundary_result: plan.request.source_boundary_result,
      contract_only: TRUE_VALUE,
      gate_only: TRUE_VALUE,
      read_only: TRUE_VALUE,
      invocation_ready: FALSE_VALUE,
      live_call_ready: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      reads_env: FALSE_VALUE,
      exposes_secret: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      executes_action: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
      produces_model_output: FALSE_VALUE,
      produces_suggestion: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      enters_write_plan: FALSE_VALUE,
    },
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    represents_model_output: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function buildInvocationDenial(
  reason: ModelReadOnlyInvocationStatus,
  missingRequirements: readonly string[],
): InvocationDenial {
  return {
    kind: 'MODEL_INVOCATION_DENIAL',
    denial_only: TRUE_VALUE,
    blocks_invocation: TRUE_VALUE,
    reason,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    produces_model_output: FALSE_VALUE,
    missing_requirements: missingRequirements,
  };
}

function buildEligibilityChecks(): readonly EligibilityCheck[] {
  return [
    'redacted_input_ready',
    'boundary_contract_ready',
    'user_approval_before_live_model',
    'network_permission_ready',
    'env_secret_boundary_ready',
    'timeout_policy_ready',
    'cost_limit_ready',
    'audit_trace_ready',
  ].map(checkName => ({
    kind: 'MODEL_INVOCATION_ELIGIBILITY_CHECK',
    check_name: checkName,
    required: TRUE_VALUE,
    satisfied: FALSE_VALUE,
    blocking: TRUE_VALUE,
  }));
}

function findSourceBoundaryCandidateId(
  sourceBoundaryResult: ModelProviderBoundaryContractResult | undefined,
): string | null {
  const candidate = sourceBoundaryResult?.answer?.live_adapter_candidate;
  return candidate?.adapter_candidate_id ?? null;
}

function normalizeRequest(
  request: ModelReadOnlyInvocationGateRequest,
): NormalizedModelReadOnlyInvocationGateRequest {
  if (request.version === MODEL_READ_ONLY_INVOCATION_GATE_VERSION) {
    return request as NormalizedModelReadOnlyInvocationGateRequest;
  }
  return {
    ...request,
    version: MODEL_READ_ONLY_INVOCATION_GATE_VERSION,
  };
}

function blocked(
  reason: ModelReadOnlyInvocationGateBlockedReason,
): ModelReadOnlyInvocationGateValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const DANGEROUS_INVOCATION_STATUS_VALUES = new Set([
  'ready',
  'enabled',
  'live',
  'connected',
  'callable',
  'invocable',
  'executable',
  'success',
  'invoked',
  'completed',
]);
