export const MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ModelSandboxRole = 'system' | 'user' | 'assistant';
export type ModelSandboxMessageSource = 'fixture' | 'caller_provided';
export type ModelProviderReadOnlySandboxBlockedReason =
  | 'invalid_request_kind'
  | 'request_messages_missing'
  | 'illegal_network_allowed'
  | 'illegal_db_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_tool_calls_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_secret_in_input'
  | 'illegal_pii_in_input'
  | 'illegal_live_provider_config_resolved'
  | 'illegal_live_provider_config_reads_env'
  | 'illegal_live_provider_config_contains_secret'
  | 'illegal_live_provider_config_usable_for_live_call'
  | 'illegal_transport_uses_network'
  | 'illegal_real_provider_call'
  | 'illegal_output_executable'
  | 'illegal_output_enters_review_queue'
  | 'illegal_output_enters_write_plan'
  | 'illegal_output_persisted'
  | 'illegal_output_contains_secret'
  | 'illegal_output_contains_pii';

export interface ModelSandboxMessage {
  role: ModelSandboxRole;
  content: string;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  source: ModelSandboxMessageSource;
  persisted: BoolFalse;
}

export interface ModelSandboxContext {
  kind: 'MODEL_SANDBOX_CONTEXT';
  context_only: BoolTrue;
  source: 'fixture_or_caller_provided';
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  from_live_customer_data: BoolFalse;
  from_secret: BoolFalse;
  persisted: BoolFalse;
}

export interface ModelProviderSandboxSafetyPolicy {
  kind: 'MODEL_PROVIDER_SANDBOX_SAFETY_POLICY';
  read_only: BoolTrue;
  allow_network: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_tool_calls: BoolFalse;
  allow_file_write: BoolFalse;
  allow_env_read: BoolFalse;
  redact_secrets: BoolTrue;
  require_fixture_transport: BoolTrue;
}

export interface ProviderConfigPlaceholder {
  kind: 'MODEL_PROVIDER_CONFIG_PLACEHOLDER';
  placeholder_only: BoolTrue;
  resolved: BoolFalse;
  contains_secret: BoolFalse;
  reads_env: BoolFalse;
  persisted: BoolFalse;
  usable_for_live_call: BoolFalse;
}

export interface ModelProviderReadOnlySandboxRequest {
  kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_REQUEST';
  version?: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  request_id: string;
  provider_kind: 'fixture_provider_v1';
  model_id: 'fixture-model-v1';
  input_messages: readonly ModelSandboxMessage[];
  sandbox_context: ModelSandboxContext;
  safety_policy: ModelProviderSandboxSafetyPolicy;
  provider_config_placeholder?: ProviderConfigPlaceholder;
  caller_provided_only: BoolTrue;
  read_only: BoolTrue;
  allow_network: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
}

export interface NormalizedModelProviderReadOnlySandboxRequest
  extends ModelProviderReadOnlySandboxRequest {
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
}

export interface ModelProviderReadOnlySandboxSafety {
  read_only: BoolTrue;
  fixture_transport_only: BoolTrue;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executes_action: BoolFalse;
  calls_runner: BoolFalse;
  exposes_secret: BoolFalse;
  persists_output: BoolFalse;
}

export interface ModelProviderReadOnlySandboxPlan {
  kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_PLAN';
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'model_provider_read_only_sandbox_readiness_only';
  request: NormalizedModelProviderReadOnlySandboxRequest;
  allowed_operations: readonly [
    'validate_caller_provided_sandbox_request',
    'invoke_fixture_model_provider_transport',
    'build_provider_sandbox_result',
  ];
  forbidden_operations: readonly string[];
  safety: ModelProviderReadOnlySandboxSafety;
}

export interface ModelProviderSandboxTokenUsagePlaceholder {
  kind: 'MODEL_PROVIDER_SANDBOX_TOKEN_USAGE_PLACEHOLDER';
  prompt_tokens_estimate: number;
  completion_tokens_estimate: number;
  total_tokens_estimate: number;
  estimated_only: BoolTrue;
  persisted: BoolFalse;
}

export interface ModelProviderSandboxCostEstimatePlaceholder {
  kind: 'MODEL_PROVIDER_SANDBOX_COST_ESTIMATE_PLACEHOLDER';
  estimated_only: BoolTrue;
  amount: 0;
  currency: 'USD';
  billable: BoolFalse;
  persisted: BoolFalse;
}

export interface ModelProviderSandboxLatencyPlaceholder {
  kind: 'MODEL_PROVIDER_SANDBOX_LATENCY_PLACEHOLDER';
  estimated_only: BoolTrue;
  duration_ms_estimate: 0;
  measured_real_latency: BoolFalse;
  persisted: BoolFalse;
}

export interface ModelProviderSandboxResponseEnvelope {
  kind: 'MODEL_PROVIDER_SANDBOX_RESPONSE_ENVELOPE';
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  response_id: string;
  provider_kind: ModelProviderReadOnlySandboxRequest['provider_kind'];
  model_id: ModelProviderReadOnlySandboxRequest['model_id'];
  output_text: string;
  finish_reason: 'stop';
  token_usage_placeholder: ModelProviderSandboxTokenUsagePlaceholder;
  cost_estimate_placeholder: ModelProviderSandboxCostEstimatePlaceholder;
  latency_placeholder: ModelProviderSandboxLatencyPlaceholder;
  safety_annotations: readonly string[];
  source_transport: 'fixture';
  sandbox_fixture_only: BoolTrue;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  persisted: BoolFalse;
  executable: BoolFalse;
  represents_executed_action: BoolFalse;
  produces_proposal: BoolFalse;
}

export interface ModelProviderSandboxErrorEnvelope {
  kind: 'MODEL_PROVIDER_SANDBOX_ERROR_ENVELOPE';
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  error_type: ModelProviderReadOnlySandboxBlockedReason;
  error_message: string;
  retryable: BoolFalse;
  source_transport: 'fixture';
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  persisted: BoolFalse;
}

export type ModelProviderSandboxTransportOutput =
  | ModelProviderSandboxResponseEnvelope
  | ModelProviderSandboxErrorEnvelope;

export interface FixtureModelProviderTransport {
  kind: 'FIXTURE_MODEL_PROVIDER_TRANSPORT';
  transport_kind: 'fixture';
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  invoke(request: NormalizedModelProviderReadOnlySandboxRequest): ModelProviderSandboxTransportOutput;
}

export interface ModelProviderReadOnlySandboxSummary {
  kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_SUMMARY';
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  message_count: number;
  generated_provider_envelope: boolean;
  sandbox_blocked: boolean;
  blocked_reason: ModelProviderReadOnlySandboxBlockedReason | null;
  fixture_transport_only: BoolTrue;
  read_only: BoolTrue;
}

export interface ModelProviderReadOnlySandboxTraceSummary {
  kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_TRACE_SUMMARY';
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  request_id: string;
  transport_kind: 'fixture';
  validation_checked: BoolTrue;
  result_checked: BoolTrue;
  persisted: BoolFalse;
}

export interface ModelProviderReadOnlySandboxAnswer {
  kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_ANSWER';
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  sandbox_blocked: boolean;
  blocked_reason: ModelProviderReadOnlySandboxBlockedReason | null;
  generated_provider_envelope: boolean;
  provider_response: ModelProviderSandboxResponseEnvelope | null;
  provider_error: ModelProviderSandboxErrorEnvelope | null;
  safety_summary: ModelProviderReadOnlySandboxSummary;
  trace_summary: ModelProviderReadOnlySandboxTraceSummary;
  source_request: NormalizedModelProviderReadOnlySandboxRequest;
  contract_only: BoolTrue;
  sandbox_only: BoolTrue;
  read_only: BoolTrue;
  fixture_transport_only: BoolTrue;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executes_action: BoolFalse;
  calls_runner: BoolFalse;
  exposes_secret: BoolFalse;
  persists_output: BoolFalse;
  produces_executable_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  enters_human_confirmation: BoolFalse;
  enters_write_plan: BoolFalse;
}

export interface ModelProviderReadOnlySandboxResult {
  kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_RESULT';
  version: typeof MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION;
  plan: ModelProviderReadOnlySandboxPlan;
  answer: ModelProviderReadOnlySandboxAnswer;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  calls_real_provider: BoolFalse;
  uses_network: BoolFalse;
  represents_live_model_call: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ModelProviderReadOnlySandboxTrace {
  kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_TRACE';
  plan: ModelProviderReadOnlySandboxPlan;
  result: ModelProviderReadOnlySandboxResult;
  persisted: BoolFalse;
  writes_database: BoolFalse;
}

export interface ModelProviderReadOnlySandboxValidation {
  ok: boolean;
  blocked_reason: ModelProviderReadOnlySandboxBlockedReason | null;
}

export function validateModelProviderReadOnlySandboxRequest(
  request: unknown,
): ModelProviderReadOnlySandboxValidation {
  const source = asRecord(request);
  if (source?.kind !== 'MODEL_PROVIDER_READ_ONLY_SANDBOX_REQUEST') return blocked('invalid_request_kind');

  const messages = Array.isArray(source.input_messages) ? source.input_messages : [];
  if (messages.length === 0) return blocked('request_messages_missing');
  if (source.allow_network === true) return blocked('illegal_network_allowed');
  if (source.allow_db === true) return blocked('illegal_db_allowed');
  if (source.allow_runner === true) return blocked('illegal_runner_allowed');
  if (source.allow_execution === true) return blocked('illegal_execution_allowed');

  const safetyPolicy = asRecord(source.safety_policy);
  if (safetyPolicy?.allow_network === true) return blocked('illegal_network_allowed');
  if (safetyPolicy?.allow_db === true) return blocked('illegal_db_allowed');
  if (safetyPolicy?.allow_runner === true) return blocked('illegal_runner_allowed');
  if (safetyPolicy?.allow_execution === true) return blocked('illegal_execution_allowed');
  if (safetyPolicy?.allow_tool_calls === true) return blocked('illegal_tool_calls_allowed');
  if (safetyPolicy?.allow_env_read === true) return blocked('illegal_env_read_allowed');

  for (const message of messages) {
    const record = asRecord(message);
    if (record?.contains_secret === true) return blocked('illegal_secret_in_input');
    if (record?.contains_pii === true) return blocked('illegal_pii_in_input');
  }

  const placeholder = asRecord(source.provider_config_placeholder);
  if (placeholder?.resolved === true) return blocked('illegal_live_provider_config_resolved');
  if (placeholder?.reads_env === true) return blocked('illegal_live_provider_config_reads_env');
  if (placeholder?.contains_secret === true) return blocked('illegal_live_provider_config_contains_secret');
  if (placeholder?.usable_for_live_call === true) {
    return blocked('illegal_live_provider_config_usable_for_live_call');
  }

  return { ok: true, blocked_reason: null };
}

export function validateModelProviderReadOnlySandboxTransport(
  transport: unknown,
): ModelProviderReadOnlySandboxValidation {
  const record = asRecord(transport);
  if (record?.uses_network === true) return blocked('illegal_transport_uses_network');
  if (record?.calls_real_provider === true) return blocked('illegal_real_provider_call');
  return { ok: true, blocked_reason: null };
}

export function validateModelProviderSandboxTransportOutput(
  output: unknown,
): ModelProviderReadOnlySandboxValidation {
  const record = asRecord(output);
  if (record?.kind === 'MODEL_PROVIDER_SANDBOX_ERROR_ENVELOPE') return { ok: true, blocked_reason: null };
  if (record?.calls_real_provider === true) return blocked('illegal_real_provider_call');
  if (record?.uses_network === true) return blocked('illegal_transport_uses_network');
  if (record?.executable === true) return blocked('illegal_output_executable');
  if (record?.produces_proposal === true) return blocked('illegal_output_executable');
  if (record?.represents_executed_action === true) return blocked('illegal_output_executable');
  if (record?.persisted === true) return blocked('illegal_output_persisted');
  if (record?.contains_secret === true) return blocked('illegal_output_contains_secret');
  if (record?.contains_pii === true) return blocked('illegal_output_contains_pii');
  return { ok: true, blocked_reason: null };
}

export function validateModelProviderReadOnlySandboxResult(
  result: unknown,
): ModelProviderReadOnlySandboxValidation {
  const record = asRecord(result);
  const answer = asRecord(record?.answer);
  if (record?.calls_real_provider === true) return blocked('illegal_real_provider_call');
  if (record?.uses_network === true) return blocked('illegal_transport_uses_network');
  if (record?.persisted === true || answer?.persists_output === true) return blocked('illegal_output_persisted');
  if (answer?.produces_executable_proposal === true) return blocked('illegal_output_executable');
  if (answer?.enters_review_queue === true) return blocked('illegal_output_enters_review_queue');
  if (answer?.enters_write_plan === true) return blocked('illegal_output_enters_write_plan');
  if (answer?.exposes_secret === true) return blocked('illegal_output_contains_secret');
  if (answer?.provider_response) {
    return validateModelProviderSandboxTransportOutput(answer.provider_response);
  }
  return { ok: true, blocked_reason: null };
}

export function buildModelProviderReadOnlySandboxPlan(
  request: ModelProviderReadOnlySandboxRequest,
): ModelProviderReadOnlySandboxPlan {
  return {
    kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_PLAN',
    version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'model_provider_read_only_sandbox_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_caller_provided_sandbox_request',
      'invoke_fixture_model_provider_transport',
      'build_provider_sandbox_result',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'read_env_values',
      'open_network_channel',
      'call_live_model_service',
      'load_live_model_config',
      'persist_provider_output',
      'enter_review_queue',
      'enter_human_confirmation',
      'enter_write_plan',
      'execute_model_output',
      'call_runner',
    ],
    safety: buildSafety(),
  };
}

export function runModelProviderReadOnlySandbox(
  plan: ModelProviderReadOnlySandboxPlan,
  transport: FixtureModelProviderTransport,
): ModelProviderReadOnlySandboxResult {
  const requestValidation = validateModelProviderReadOnlySandboxRequest(plan.request);
  if (!requestValidation.ok) return buildBlockedResult(plan, requestValidation.blocked_reason);

  const transportValidation = validateModelProviderReadOnlySandboxTransport(transport);
  if (!transportValidation.ok) return buildBlockedResult(plan, transportValidation.blocked_reason);

  const output = transport.invoke(plan.request);
  const outputValidation = validateModelProviderSandboxTransportOutput(output);
  if (!outputValidation.ok) return buildBlockedResult(plan, outputValidation.blocked_reason);
  if (output.kind === 'MODEL_PROVIDER_SANDBOX_ERROR_ENVELOPE') {
    return buildBlockedResult(plan, output.error_type, output);
  }

  return buildResult(plan, output, null, null);
}

export function buildModelProviderReadOnlySandboxTrace(
  plan: ModelProviderReadOnlySandboxPlan,
  transport: FixtureModelProviderTransport,
): ModelProviderReadOnlySandboxTrace {
  return {
    kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_TRACE',
    plan,
    result: runModelProviderReadOnlySandbox(plan, transport),
    persisted: FALSE_VALUE,
    writes_database: FALSE_VALUE,
  };
}

export function buildModelProviderSandboxResponseEnvelope(
  request: NormalizedModelProviderReadOnlySandboxRequest,
  index: number,
  outputText: string,
): ModelProviderSandboxResponseEnvelope {
  return {
    kind: 'MODEL_PROVIDER_SANDBOX_RESPONSE_ENVELOPE',
    version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
    response_id: `MODEL_SANDBOX_FIXTURE_RESPONSE_${String(index + 1).padStart(3, '0')}`,
    provider_kind: request.provider_kind,
    model_id: request.model_id,
    output_text: outputText,
    finish_reason: 'stop',
    token_usage_placeholder: {
      kind: 'MODEL_PROVIDER_SANDBOX_TOKEN_USAGE_PLACEHOLDER',
      prompt_tokens_estimate: request.input_messages.length * 8,
      completion_tokens_estimate: 16,
      total_tokens_estimate: request.input_messages.length * 8 + 16,
      estimated_only: TRUE_VALUE,
      persisted: FALSE_VALUE,
    },
    cost_estimate_placeholder: {
      kind: 'MODEL_PROVIDER_SANDBOX_COST_ESTIMATE_PLACEHOLDER',
      estimated_only: TRUE_VALUE,
      amount: 0,
      currency: 'USD',
      billable: FALSE_VALUE,
      persisted: FALSE_VALUE,
    },
    latency_placeholder: {
      kind: 'MODEL_PROVIDER_SANDBOX_LATENCY_PLACEHOLDER',
      estimated_only: TRUE_VALUE,
      duration_ms_estimate: 0,
      measured_real_latency: FALSE_VALUE,
      persisted: FALSE_VALUE,
    },
    safety_annotations: [
      'fixture_transport_only',
      'read_only_contract',
      'no_state_change',
    ],
    source_transport: 'fixture',
    sandbox_fixture_only: TRUE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    persisted: FALSE_VALUE,
    executable: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    produces_proposal: FALSE_VALUE,
  };
}

export function buildModelProviderSandboxErrorEnvelope(
  reason: ModelProviderReadOnlySandboxBlockedReason,
): ModelProviderSandboxErrorEnvelope {
  return {
    kind: 'MODEL_PROVIDER_SANDBOX_ERROR_ENVELOPE',
    version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
    error_type: reason,
    error_message: `Sandbox blocked by read only contract: ${reason}.`,
    retryable: FALSE_VALUE,
    source_transport: 'fixture',
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function buildBlockedResult(
  plan: ModelProviderReadOnlySandboxPlan,
  reason: ModelProviderReadOnlySandboxBlockedReason | null,
  error: ModelProviderSandboxErrorEnvelope | null = null,
): ModelProviderReadOnlySandboxResult {
  return buildResult(plan, null, reason, error ?? buildModelProviderSandboxErrorEnvelope(reason ?? 'invalid_request_kind'));
}

function buildResult(
  plan: ModelProviderReadOnlySandboxPlan,
  response: ModelProviderSandboxResponseEnvelope | null,
  blockedReason: ModelProviderReadOnlySandboxBlockedReason | null,
  error: ModelProviderSandboxErrorEnvelope | null,
): ModelProviderReadOnlySandboxResult {
  const sandboxBlocked = blockedReason !== null;
  const generated = !sandboxBlocked && response !== null;

  return {
    kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_RESULT',
    version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
    plan,
    answer: {
      kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_ANSWER',
      version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
      sandbox_blocked: sandboxBlocked,
      blocked_reason: blockedReason,
      generated_provider_envelope: generated,
      provider_response: generated ? response : null,
      provider_error: sandboxBlocked ? error : null,
      safety_summary: {
        kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_SUMMARY',
        version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
        message_count: plan.request.input_messages.length,
        generated_provider_envelope: generated,
        sandbox_blocked: sandboxBlocked,
        blocked_reason: blockedReason,
        fixture_transport_only: TRUE_VALUE,
        read_only: TRUE_VALUE,
      },
      trace_summary: {
        kind: 'MODEL_PROVIDER_READ_ONLY_SANDBOX_TRACE_SUMMARY',
        version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
        request_id: plan.request.request_id,
        transport_kind: 'fixture',
        validation_checked: TRUE_VALUE,
        result_checked: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      source_request: plan.request,
      contract_only: TRUE_VALUE,
      sandbox_only: TRUE_VALUE,
      read_only: TRUE_VALUE,
      fixture_transport_only: TRUE_VALUE,
      calls_real_provider: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      executes_action: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
      exposes_secret: FALSE_VALUE,
      persists_output: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      enters_write_plan: FALSE_VALUE,
    },
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: ModelProviderReadOnlySandboxRequest,
): NormalizedModelProviderReadOnlySandboxRequest {
  if (request.version === MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION) {
    return request as NormalizedModelProviderReadOnlySandboxRequest;
  }
  return {
    ...request,
    version: MODEL_PROVIDER_READ_ONLY_SANDBOX_VERSION,
  };
}

function buildSafety(): ModelProviderReadOnlySandboxSafety {
  return {
    read_only: TRUE_VALUE,
    fixture_transport_only: TRUE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executes_action: FALSE_VALUE,
    calls_runner: FALSE_VALUE,
    exposes_secret: FALSE_VALUE,
    persists_output: FALSE_VALUE,
  };
}

function blocked(
  reason: ModelProviderReadOnlySandboxBlockedReason,
): ModelProviderReadOnlySandboxValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
