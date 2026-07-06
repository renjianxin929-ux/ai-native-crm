import type { ModelProviderReadOnlySandboxResult } from './modelProviderReadOnlySandboxReadiness';

export const MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ModelProviderBoundaryBlockedReason =
  | 'invalid_request_kind'
  | 'illegal_live_call_allowed'
  | 'illegal_network_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_secret_material_allowed'
  | 'illegal_db_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_provider_config_resolved'
  | 'illegal_provider_config_has_api_key'
  | 'illegal_provider_config_reads_env'
  | 'illegal_provider_config_reads_settings'
  | 'illegal_provider_config_contains_secret'
  | 'illegal_provider_config_usable_for_live_call'
  | 'illegal_policy_allows_live_call'
  | 'illegal_policy_allows_network'
  | 'illegal_policy_allows_env_read'
  | 'illegal_source_sandbox_called_real_provider'
  | 'illegal_source_sandbox_used_network'
  | 'illegal_live_adapter_ready'
  | 'illegal_live_adapter_uses_network'
  | 'illegal_live_adapter_calls_provider'
  | 'illegal_output_enters_review_queue'
  | 'illegal_output_enters_write_plan'
  | 'illegal_output_persisted'
  | 'illegal_output_contains_secret';

export type LiveProviderAdapterStatus =
  | 'blocked_missing_credentials'
  | 'blocked_network_not_allowed'
  | 'blocked_live_call_not_approved'
  | 'blocked_missing_timeout_policy'
  | 'blocked_missing_cost_limit'
  | 'blocked_boundary_contract_only';

export interface LiveProviderConfigPlaceholder {
  kind: 'LIVE_PROVIDER_CONFIG_PLACEHOLDER';
  placeholder_only: BoolTrue;
  provider_kind: string;
  model_id: string;
  resolved: BoolFalse;
  contains_secret: BoolFalse;
  reads_env: BoolFalse;
  reads_settings: BoolFalse;
  has_api_key: BoolFalse;
  api_key_redacted: BoolTrue;
  persisted: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface LiveAdapterPolicy {
  kind: 'LIVE_PROVIDER_ADAPTER_POLICY';
  boundary_only: BoolTrue;
  allow_live_call: BoolFalse;
  allow_network: BoolFalse;
  allow_env_read: BoolFalse;
  allow_secret_material: BoolFalse;
  allow_request_persistence: BoolFalse;
  allow_response_persistence: BoolFalse;
  require_redaction: BoolTrue;
  require_timeout_policy: BoolTrue;
  require_cost_limit: BoolTrue;
  require_rate_limit: BoolTrue;
  require_audit_trace: BoolTrue;
  require_user_approval_before_live_call: BoolTrue;
}

export interface ModelProviderBoundaryContractRequest {
  kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_REQUEST';
  version?: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
  request_id: string;
  source_sandbox_result?: ModelProviderReadOnlySandboxResult;
  requested_provider_kind: string;
  requested_model_id: string;
  provider_config_placeholder: LiveProviderConfigPlaceholder;
  live_adapter_policy: LiveAdapterPolicy;
  caller_provided_only: BoolTrue;
  boundary_contract_only: BoolTrue;
  allow_live_call: BoolFalse;
  allow_network: BoolFalse;
  allow_env_read: BoolFalse;
  allow_secret_material: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
}

export interface NormalizedModelProviderBoundaryContractRequest
  extends ModelProviderBoundaryContractRequest {
  version: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
}

export interface BlockedLiveProviderBoundaryDescriptor {
  kind: 'BLOCKED_LIVE_PROVIDER_BOUNDARY_DESCRIPTOR';
  adapter_enabled: BoolFalse;
  live_call_blocked: BoolTrue;
  transport_usable: BoolFalse;
  credentials_resolved: BoolFalse;
}

export interface LiveTransportBoundary {
  kind: 'LIVE_TRANSPORT_BOUNDARY';
  transport_kind: 'blocked_live_transport';
  allow_network: BoolFalse;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  usable_for_live_call: BoolFalse;
  requires_future_network_approval: BoolTrue;
}

export interface CredentialBoundary {
  kind: 'CREDENTIAL_BOUNDARY';
  credentials_resolved: BoolFalse;
  contains_secret: BoolFalse;
  reads_env: BoolFalse;
  reads_settings: BoolFalse;
  api_key_present: BoolFalse;
  api_key_redacted: BoolTrue;
  exposes_secret: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface RedactionRequirement {
  kind: 'REDACTION_REQUIREMENT';
  required: BoolTrue;
  satisfied: BoolFalse;
  blocking: BoolTrue;
  blocks_live_call: BoolTrue;
}

export interface TimeoutPolicyPlaceholder {
  kind: 'TIMEOUT_POLICY_PLACEHOLDER';
  required: BoolTrue;
  resolved: BoolFalse;
  timeout_ms: null;
  usable_for_live_call: BoolFalse;
}

export interface RetryPolicyPlaceholder {
  kind: 'RETRY_POLICY_PLACEHOLDER';
  required: BoolTrue;
  resolved: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface CostLimitPlaceholder {
  kind: 'COST_LIMIT_PLACEHOLDER';
  required: BoolTrue;
  resolved: BoolFalse;
  max_cost: null;
  currency: null;
  usable_for_live_call: BoolFalse;
}

export interface RateLimitPlaceholder {
  kind: 'RATE_LIMIT_PLACEHOLDER';
  required: BoolTrue;
  resolved: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface AuditTracePlaceholder {
  kind: 'AUDIT_TRACE_PLACEHOLDER';
  required: BoolTrue;
  resolved: BoolFalse;
  persisted: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface LiveCallDenial {
  kind: 'LIVE_CALL_DENIAL';
  denial_only: BoolTrue;
  reason: LiveProviderAdapterStatus;
  blocks_live_call: BoolTrue;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  missing_requirements: readonly string[];
}

export interface LiveProviderAdapterCandidate {
  kind: 'LIVE_PROVIDER_ADAPTER_CANDIDATE';
  version: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
  adapter_candidate_id: string;
  provider_kind: string;
  model_id: string;
  adapter_status: LiveProviderAdapterStatus;
  blocked_reason: LiveProviderAdapterStatus;
  boundary_descriptor: BlockedLiveProviderBoundaryDescriptor;
  config_placeholder: LiveProviderConfigPlaceholder;
  transport_boundary: LiveTransportBoundary;
  credential_boundary: CredentialBoundary;
  redaction_requirements: RedactionRequirement;
  timeout_policy_placeholder: TimeoutPolicyPlaceholder;
  retry_policy_placeholder: RetryPolicyPlaceholder;
  cost_limit_placeholder: CostLimitPlaceholder;
  rate_limit_placeholder: RateLimitPlaceholder;
  audit_trace_placeholder: AuditTracePlaceholder;
  live_call_denial: LiveCallDenial;
  contract_only: BoolTrue;
  boundary_only: BoolTrue;
  adapter_enabled: BoolFalse;
  live_call_ready: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  contains_secret: BoolFalse;
  exposes_secret: BoolFalse;
  persists_request: BoolFalse;
  persists_response: BoolFalse;
  executable: BoolFalse;
  represents_live_model_call: BoolFalse;
  produces_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_write_plan: BoolFalse;
}

export interface ModelProviderBoundaryContractPlan {
  kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_PLAN';
  version: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'model_provider_boundary_contract_readiness_only';
  request: NormalizedModelProviderBoundaryContractRequest;
  allowed_operations: readonly [
    'validate_caller_provided_boundary_contract_request',
    'build_blocked_live_provider_adapter_candidate',
    'build_boundary_contract_result',
  ];
  forbidden_operations: readonly string[];
}

export interface ProviderConfigAssessment {
  kind: 'PROVIDER_CONFIG_ASSESSMENT';
  placeholder_only: BoolTrue;
  resolved: BoolFalse;
  contains_secret: BoolFalse;
  reads_env: BoolFalse;
  reads_settings: BoolFalse;
  has_api_key: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface ModelProviderBoundaryContractSummary {
  kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_SUMMARY';
  version: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
  boundary_blocked: boolean;
  generated_boundary_contract: boolean;
  live_call_ready: BoolFalse;
  contract_only: BoolTrue;
}

export interface ModelProviderBoundaryContractTraceSummary {
  kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_TRACE_SUMMARY';
  version: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
  request_id: string;
  validation_checked: BoolTrue;
  candidate_checked: BoolTrue;
  persisted: BoolFalse;
}

export interface ModelProviderBoundaryContractAnswer {
  kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_ANSWER';
  version: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
  boundary_blocked: boolean;
  blocked_reason: ModelProviderBoundaryBlockedReason | null;
  generated_boundary_contract: boolean;
  live_adapter_candidate: LiveProviderAdapterCandidate | null;
  provider_config_assessment: ProviderConfigAssessment;
  live_call_denial: LiveCallDenial;
  safety_summary: ModelProviderBoundaryContractSummary;
  trace_summary: ModelProviderBoundaryContractTraceSummary;
  source_sandbox_result: ModelProviderReadOnlySandboxResult | undefined;
  contract_only: BoolTrue;
  boundary_only: BoolTrue;
  defines_live_adapter_boundary: BoolTrue;
  live_call_ready: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_env: BoolFalse;
  exposes_secret: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executes_action: BoolFalse;
  calls_runner: BoolFalse;
  persists_request: BoolFalse;
  persists_response: BoolFalse;
  produces_executable_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
}

export interface ModelProviderBoundaryContractResult {
  kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_RESULT';
  version: typeof MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION;
  plan: ModelProviderBoundaryContractPlan;
  answer: ModelProviderBoundaryContractAnswer;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  reads_env: BoolFalse;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  represents_live_model_call: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ModelProviderBoundaryContractValidation {
  ok: boolean;
  blocked_reason: ModelProviderBoundaryBlockedReason | null;
}

export function buildModelProviderBoundaryContractPlan(
  request: ModelProviderBoundaryContractRequest,
): ModelProviderBoundaryContractPlan {
  return {
    kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_PLAN',
    version: MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'model_provider_boundary_contract_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_caller_provided_boundary_contract_request',
      'build_blocked_live_provider_adapter_candidate',
      'build_boundary_contract_result',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'read_env_values',
      'open_network_channel',
      'load_secret_material',
      'perform_live_model_request',
      'persist_provider_request',
      'persist_provider_response',
      'enter_review_queue',
      'enter_human_confirmation',
      'enter_write_plan',
      'execute_model_output',
      'call_runner',
    ],
  };
}

export function runModelProviderBoundaryContract(
  plan: ModelProviderBoundaryContractPlan,
): ModelProviderBoundaryContractResult {
  const requestValidation = validateModelProviderBoundaryContractRequest(plan.request);
  if (!requestValidation.ok) return buildBoundaryResult(plan, null, requestValidation.blocked_reason);

  const candidate = buildBlockedLiveProviderAdapterCandidate(plan.request);
  const candidateValidation = validateLiveProviderAdapterCandidate(candidate);
  if (!candidateValidation.ok) return buildBoundaryResult(plan, null, candidateValidation.blocked_reason);

  return buildBoundaryResult(plan, candidate, null);
}

export function buildBlockedLiveProviderAdapterCandidate(
  request: NormalizedModelProviderBoundaryContractRequest,
  index = 0,
): LiveProviderAdapterCandidate {
  const status: LiveProviderAdapterStatus = 'blocked_boundary_contract_only';
  const denial = buildLiveCallDenial(status);

  return {
    kind: 'LIVE_PROVIDER_ADAPTER_CANDIDATE',
    version: MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION,
    adapter_candidate_id: `MODEL_PROVIDER_BOUNDARY_CANDIDATE_${String(index + 1).padStart(3, '0')}`,
    provider_kind: request.requested_provider_kind,
    model_id: request.requested_model_id,
    adapter_status: status,
    blocked_reason: status,
    boundary_descriptor: {
      kind: 'BLOCKED_LIVE_PROVIDER_BOUNDARY_DESCRIPTOR',
      adapter_enabled: FALSE_VALUE,
      live_call_blocked: TRUE_VALUE,
      transport_usable: FALSE_VALUE,
      credentials_resolved: FALSE_VALUE,
    },
    config_placeholder: request.provider_config_placeholder,
    transport_boundary: {
      kind: 'LIVE_TRANSPORT_BOUNDARY',
      transport_kind: 'blocked_live_transport',
      allow_network: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      usable_for_live_call: FALSE_VALUE,
      requires_future_network_approval: TRUE_VALUE,
    },
    credential_boundary: {
      kind: 'CREDENTIAL_BOUNDARY',
      credentials_resolved: FALSE_VALUE,
      contains_secret: FALSE_VALUE,
      reads_env: FALSE_VALUE,
      reads_settings: FALSE_VALUE,
      api_key_present: FALSE_VALUE,
      api_key_redacted: TRUE_VALUE,
      exposes_secret: FALSE_VALUE,
      usable_for_live_call: FALSE_VALUE,
    },
    redaction_requirements: {
      kind: 'REDACTION_REQUIREMENT',
      required: TRUE_VALUE,
      satisfied: FALSE_VALUE,
      blocking: TRUE_VALUE,
      blocks_live_call: TRUE_VALUE,
    },
    timeout_policy_placeholder: {
      kind: 'TIMEOUT_POLICY_PLACEHOLDER',
      required: TRUE_VALUE,
      resolved: FALSE_VALUE,
      timeout_ms: null,
      usable_for_live_call: FALSE_VALUE,
    },
    retry_policy_placeholder: {
      kind: 'RETRY_POLICY_PLACEHOLDER',
      required: TRUE_VALUE,
      resolved: FALSE_VALUE,
      usable_for_live_call: FALSE_VALUE,
    },
    cost_limit_placeholder: {
      kind: 'COST_LIMIT_PLACEHOLDER',
      required: TRUE_VALUE,
      resolved: FALSE_VALUE,
      max_cost: null,
      currency: null,
      usable_for_live_call: FALSE_VALUE,
    },
    rate_limit_placeholder: {
      kind: 'RATE_LIMIT_PLACEHOLDER',
      required: TRUE_VALUE,
      resolved: FALSE_VALUE,
      usable_for_live_call: FALSE_VALUE,
    },
    audit_trace_placeholder: {
      kind: 'AUDIT_TRACE_PLACEHOLDER',
      required: TRUE_VALUE,
      resolved: FALSE_VALUE,
      persisted: FALSE_VALUE,
      usable_for_live_call: FALSE_VALUE,
    },
    live_call_denial: denial,
    contract_only: TRUE_VALUE,
    boundary_only: TRUE_VALUE,
    adapter_enabled: FALSE_VALUE,
    live_call_ready: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    contains_secret: FALSE_VALUE,
    exposes_secret: FALSE_VALUE,
    persists_request: FALSE_VALUE,
    persists_response: FALSE_VALUE,
    executable: FALSE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    produces_proposal: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    enters_write_plan: FALSE_VALUE,
  };
}

export function validateModelProviderBoundaryContractRequest(
  request: unknown,
): ModelProviderBoundaryContractValidation {
  const source = asRecord(request);
  if (source?.kind !== 'MODEL_PROVIDER_BOUNDARY_CONTRACT_REQUEST') return blocked('invalid_request_kind');
  if (source.allow_live_call === true) return blocked('illegal_live_call_allowed');
  if (source.allow_network === true) return blocked('illegal_network_allowed');
  if (source.allow_env_read === true) return blocked('illegal_env_read_allowed');
  if (source.allow_secret_material === true) return blocked('illegal_secret_material_allowed');
  if (source.allow_db === true) return blocked('illegal_db_allowed');
  if (source.allow_runner === true) return blocked('illegal_runner_allowed');
  if (source.allow_execution === true) return blocked('illegal_execution_allowed');

  const placeholder = asRecord(source.provider_config_placeholder);
  if (placeholder?.resolved === true) return blocked('illegal_provider_config_resolved');
  if (placeholder?.has_api_key === true) return blocked('illegal_provider_config_has_api_key');
  if (placeholder?.reads_env === true) return blocked('illegal_provider_config_reads_env');
  if (placeholder?.reads_settings === true) return blocked('illegal_provider_config_reads_settings');
  if (placeholder?.contains_secret === true) return blocked('illegal_provider_config_contains_secret');
  if (placeholder?.usable_for_live_call === true) {
    return blocked('illegal_provider_config_usable_for_live_call');
  }

  const policy = asRecord(source.live_adapter_policy);
  if (policy?.allow_live_call === true) return blocked('illegal_policy_allows_live_call');
  if (policy?.allow_network === true) return blocked('illegal_policy_allows_network');
  if (policy?.allow_env_read === true) return blocked('illegal_policy_allows_env_read');

  const sandbox = asRecord(source.source_sandbox_result);
  if (sandbox?.calls_real_provider === true) return blocked('illegal_source_sandbox_called_real_provider');
  if (sandbox?.uses_network === true) return blocked('illegal_source_sandbox_used_network');

  return { ok: true, blocked_reason: null };
}

export function validateLiveProviderAdapterCandidate(
  candidate: unknown,
): ModelProviderBoundaryContractValidation {
  const record = asRecord(candidate);
  const status = typeof record?.adapter_status === 'string' ? record.adapter_status : '';
  if (!status.startsWith('blocked_')) return blocked('illegal_live_adapter_ready');
  if (DANGEROUS_ADAPTER_STATUS_VALUES.has(status)) return blocked('illegal_live_adapter_ready');
  if (record?.uses_network === true) return blocked('illegal_live_adapter_uses_network');
  if (record?.calls_real_provider === true) return blocked('illegal_live_adapter_calls_provider');
  if (record?.live_call_ready === true || record?.adapter_enabled === true || record?.executable === true) {
    return blocked('illegal_live_adapter_ready');
  }
  if (record?.contains_secret === true || record?.exposes_secret === true) {
    return blocked('illegal_output_contains_secret');
  }
  if (record?.persists_request === true || record?.persists_response === true) {
    return blocked('illegal_output_persisted');
  }
  if (record?.enters_review_queue === true) return blocked('illegal_output_enters_review_queue');
  if (record?.enters_write_plan === true) return blocked('illegal_output_enters_write_plan');
  return { ok: true, blocked_reason: null };
}

export function validateModelProviderBoundaryContractResult(
  result: unknown,
): ModelProviderBoundaryContractValidation {
  const record = asRecord(result);
  const answer = asRecord(record?.answer);
  const candidate = asRecord(answer?.live_adapter_candidate);
  if (record?.persisted === true || answer?.persists_request === true || answer?.persists_response === true) {
    return blocked('illegal_output_persisted');
  }
  if (record?.uses_network === true || answer?.uses_network === true) return blocked('illegal_live_adapter_uses_network');
  if (record?.calls_real_provider === true || answer?.calls_real_provider === true) {
    return blocked('illegal_live_adapter_calls_provider');
  }
  if (answer?.exposes_secret === true || candidate?.contains_secret === true || candidate?.exposes_secret === true) {
    return blocked('illegal_output_contains_secret');
  }
  if (answer?.enters_review_queue === true) return blocked('illegal_output_enters_review_queue');
  if (answer?.enters_write_plan === true) return blocked('illegal_output_enters_write_plan');
  if (candidate) return validateLiveProviderAdapterCandidate(candidate);
  return { ok: true, blocked_reason: null };
}

function buildBoundaryResult(
  plan: ModelProviderBoundaryContractPlan,
  candidate: LiveProviderAdapterCandidate | null,
  blockedReason: ModelProviderBoundaryBlockedReason | null,
): ModelProviderBoundaryContractResult {
  const boundaryBlocked = blockedReason !== null;
  const denial = candidate?.live_call_denial ?? buildLiveCallDenial('blocked_boundary_contract_only');

  return {
    kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_RESULT',
    version: MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION,
    plan,
    answer: {
      kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_ANSWER',
      version: MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION,
      boundary_blocked: boundaryBlocked,
      blocked_reason: blockedReason,
      generated_boundary_contract: !boundaryBlocked && candidate !== null,
      live_adapter_candidate: boundaryBlocked ? null : candidate,
      provider_config_assessment: {
        kind: 'PROVIDER_CONFIG_ASSESSMENT',
        placeholder_only: TRUE_VALUE,
        resolved: FALSE_VALUE,
        contains_secret: FALSE_VALUE,
        reads_env: FALSE_VALUE,
        reads_settings: FALSE_VALUE,
        has_api_key: FALSE_VALUE,
        usable_for_live_call: FALSE_VALUE,
      },
      live_call_denial: denial,
      safety_summary: {
        kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_SUMMARY',
        version: MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION,
        boundary_blocked: boundaryBlocked,
        generated_boundary_contract: !boundaryBlocked && candidate !== null,
        live_call_ready: FALSE_VALUE,
        contract_only: TRUE_VALUE,
      },
      trace_summary: {
        kind: 'MODEL_PROVIDER_BOUNDARY_CONTRACT_TRACE_SUMMARY',
        version: MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION,
        request_id: plan.request.request_id,
        validation_checked: TRUE_VALUE,
        candidate_checked: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      source_sandbox_result: plan.request.source_sandbox_result,
      contract_only: TRUE_VALUE,
      boundary_only: TRUE_VALUE,
      defines_live_adapter_boundary: TRUE_VALUE,
      live_call_ready: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      reads_env: FALSE_VALUE,
      exposes_secret: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      executes_action: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
      persists_request: FALSE_VALUE,
      persists_response: FALSE_VALUE,
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
    represents_executed_action: FALSE_VALUE,
  };
}

function buildLiveCallDenial(reason: LiveProviderAdapterStatus): LiveCallDenial {
  return {
    kind: 'LIVE_CALL_DENIAL',
    denial_only: TRUE_VALUE,
    reason,
    blocks_live_call: TRUE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    missing_requirements: [
      'future_network_approval',
      'credential_resolution',
      'redaction_satisfaction',
      'timeout_policy_resolution',
      'cost_limit_resolution',
      'rate_limit_resolution',
      'audit_trace_resolution',
      'user_approval_before_live_call',
    ],
  };
}

function normalizeRequest(
  request: ModelProviderBoundaryContractRequest,
): NormalizedModelProviderBoundaryContractRequest {
  if (request.version === MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION) {
    return request as NormalizedModelProviderBoundaryContractRequest;
  }
  return {
    ...request,
    version: MODEL_PROVIDER_BOUNDARY_CONTRACT_VERSION,
  };
}

function blocked(reason: ModelProviderBoundaryBlockedReason): ModelProviderBoundaryContractValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const DANGEROUS_ADAPTER_STATUS_VALUES = new Set([
  'ready',
  'enabled',
  'live',
  'connected',
  'authenticated',
  'callable',
  'executable',
  'success',
]);
