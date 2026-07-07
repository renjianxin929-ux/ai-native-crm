export const LIVE_PROVIDER_SANDBOX_CALL_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type LiveProviderSandboxProviderKind =
  | 'openai_compatible'
  | 'deepseek_compatible'
  | 'qwen_compatible'
  | 'local_fake';

export type LiveProviderSandboxResolvedBy = 'injected_secret_resolver' | 'test_fake';

export type LiveProviderSandboxCallBlockedReason =
  | 'invalid_request_kind'
  | 'illegal_db_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_review_queue_entry_allowed'
  | 'illegal_confirmed_action_allowed'
  | 'illegal_human_confirmation_allowed'
  | 'illegal_write_plan_entry_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_prompt_contains_secret'
  | 'illegal_prompt_contains_pii'
  | 'illegal_prompt_from_database'
  | 'illegal_prompt_from_crm_customer'
  | 'illegal_prompt_trusted_for_action'
  | 'illegal_provider_config_exposes_secret'
  | 'illegal_provider_config_prints_secret'
  | 'provider_secret_unresolved'
  | 'provider_secret_resolver_missing'
  | 'illegal_resolved_secret_exposes_secret'
  | 'illegal_resolved_secret_prints_secret'
  | 'illegal_transport_output_contains_secret'
  | 'illegal_transport_output_contains_pii'
  | 'illegal_response_trusted_for_action'
  | 'illegal_response_executable'
  | 'illegal_response_produces_proposal'
  | 'illegal_response_enters_review_queue'
  | 'illegal_response_persisted'
  | 'illegal_result_writes_database'
  | 'illegal_result_represents_confirmed_action'
  | 'illegal_result_represents_review_queue_entry';

export interface LiveProviderSandboxPromptInput {
  kind: 'LIVE_PROVIDER_SANDBOX_PROMPT_INPUT';
  text: string;
  contains_pii: BoolFalse;
  contains_secret: BoolFalse;
  from_database: BoolFalse;
  from_crm_customer: BoolFalse;
  trusted_for_action: BoolFalse;
}

export interface LiveProviderSandboxProviderConfig {
  provider_kind: LiveProviderSandboxProviderKind;
  endpoint_url_redacted: string;
  model_name: string;
  api_key_reference: string;
  api_key_resolved: boolean;
  exposes_secret: BoolFalse;
  prints_secret: BoolFalse;
  resolved_by: LiveProviderSandboxResolvedBy;
}

export interface LiveProviderSandboxSafetyPolicy {
  redact_prompt: BoolTrue;
  redact_response: BoolTrue;
  max_output_chars: number;
  timeout_ms: number;
  allow_persistence: BoolFalse;
  allow_action_generation: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_db_write: BoolFalse;
}

export interface LiveProviderSandboxCallRequest {
  kind: 'LIVE_PROVIDER_SANDBOX_CALL_REQUEST';
  version: typeof LIVE_PROVIDER_SANDBOX_CALL_VERSION;
  request_id: string;
  prompt_input: LiveProviderSandboxPromptInput;
  provider_config: LiveProviderSandboxProviderConfig;
  safety_policy: LiveProviderSandboxSafetyPolicy;
  allow_live_call: boolean;
  allow_network: boolean;
  allow_env_read: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_confirmed_action: BoolFalse;
  allow_human_confirmation: BoolFalse;
  allow_write_plan_entry: BoolFalse;
}

export interface ResolvedProviderSecret {
  resolved: boolean;
  secret_value_redacted: '[REDACTED_SECRET]';
  getSecretValue(): string;
  exposes_secret: BoolFalse;
  prints_secret: BoolFalse;
}

export type ProviderSecretResolver = (
  api_key_reference: string,
) => Promise<ResolvedProviderSecret> | ResolvedProviderSecret;

export interface LiveProviderSandboxCallPlan {
  kind: 'LIVE_PROVIDER_SANDBOX_CALL_PLAN';
  version: typeof LIVE_PROVIDER_SANDBOX_CALL_VERSION;
  sandbox_only: BoolTrue;
  executable: BoolFalse;
  persisted: BoolFalse;
  request: LiveProviderSandboxCallRequest;
  allowed_operations: readonly [
    'validate_caller_provided_sandbox_request',
    'resolve_secret_through_caller_seam',
    'invoke_caller_provided_transport',
    'build_sandbox_response_envelope',
  ];
  forbidden_operations: readonly string[];
}

export interface LiveProviderSandboxResponseEnvelope {
  kind: 'LIVE_PROVIDER_SANDBOX_RESPONSE_ENVELOPE';
  sandbox_only: BoolTrue;
  live_provider_response: boolean;
  output_text_redacted: string;
  raw_output_stored: BoolFalse;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
  produces_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  persisted: BoolFalse;
}

export interface LiveProviderSandboxErrorEnvelope {
  kind: 'LIVE_PROVIDER_SANDBOX_ERROR_ENVELOPE';
  error_code: LiveProviderSandboxCallBlockedReason | 'transport_error';
  error_message_redacted: string;
  includes_secret: BoolFalse;
  includes_api_key: BoolFalse;
  retryable: boolean;
}

export interface LiveProviderSandboxSafetySummary {
  kind: 'LIVE_PROVIDER_SANDBOX_SAFETY_SUMMARY';
  prompt_redacted: BoolTrue;
  response_redacted: BoolTrue;
  persistence_allowed: BoolFalse;
  action_generation_allowed: BoolFalse;
  review_queue_entry_allowed: BoolFalse;
  db_write_allowed: BoolFalse;
}

export interface LiveProviderSandboxTraceSummary {
  kind: 'LIVE_PROVIDER_SANDBOX_TRACE_SUMMARY';
  request_id: string;
  provider_kind: LiveProviderSandboxProviderKind;
  transport_mode: 'fake' | 'live_capable' | 'not_invoked';
  validation_checked: BoolTrue;
  secret_resolved_by: LiveProviderSandboxResolvedBy | 'not_resolved';
  sandbox_only: BoolTrue;
  persisted: BoolFalse;
}

export interface LiveProviderSandboxCallAnswer {
  kind: 'LIVE_PROVIDER_SANDBOX_CALL_ANSWER';
  sandbox_only: BoolTrue;
  live_call_attempted: boolean;
  live_call_succeeded: boolean;
  provider_kind: LiveProviderSandboxProviderKind;
  model_name: string;
  response_envelope: LiveProviderSandboxResponseEnvelope;
  error_envelope: null | LiveProviderSandboxErrorEnvelope;
  safety_summary: LiveProviderSandboxSafetySummary;
  trace_summary: LiveProviderSandboxTraceSummary;
  output_text_redacted: string;
  raw_output_available: BoolFalse;
  persisted: BoolFalse;
  enters_review_queue: BoolFalse;
  produces_confirmed_action: BoolFalse;
  produces_executable_proposal: BoolFalse;
  writes_database: BoolFalse;
  calls_runner: BoolFalse;
}

export interface LiveProviderSandboxCallResult {
  kind: 'LIVE_PROVIDER_SANDBOX_CALL_RESULT';
  version: typeof LIVE_PROVIDER_SANDBOX_CALL_VERSION;
  plan: LiveProviderSandboxCallPlan;
  answer: LiveProviderSandboxCallAnswer;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  reads_env: BoolFalse;
  uses_network: boolean;
  calls_real_provider: boolean;
  represents_model_output: BoolTrue;
  represents_live_model_call: boolean;
  represents_executed_action: BoolFalse;
  represents_confirmed_action: BoolFalse;
  represents_review_queue_entry: BoolFalse;
  represents_human_confirmation: BoolFalse;
  represents_write_plan: BoolFalse;
}

export interface LiveProviderSandboxTransportResult {
  kind: 'LIVE_PROVIDER_SANDBOX_TRANSPORT_RESULT';
  transport_mode: 'fake' | 'live_capable';
  live_provider_response: boolean;
  live_call_attempted: boolean;
  live_call_succeeded: boolean;
  uses_network: boolean;
  calls_real_provider: boolean;
  output_text_redacted: string;
  error_envelope: null | LiveProviderSandboxErrorEnvelope;
  raw_output_stored: BoolFalse;
  contains_secret: BoolFalse;
  contains_pii: BoolFalse;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
  produces_proposal: BoolFalse;
  enters_review_queue: BoolFalse;
  persisted: BoolFalse;
}

export interface LiveProviderSandboxTransport {
  kind: 'LIVE_PROVIDER_SANDBOX_TRANSPORT';
  transport_mode: 'fake' | 'live_capable';
  invokeSandboxCall(
    request: LiveProviderSandboxCallRequest,
    resolvedSecret: ResolvedProviderSecret,
  ): Promise<LiveProviderSandboxTransportResult> | LiveProviderSandboxTransportResult;
}

export interface LiveProviderSandboxCallOptions {
  secret_resolver?: ProviderSecretResolver;
  transport: LiveProviderSandboxTransport;
}

export interface LiveProviderSandboxValidation {
  ok: boolean;
  blocked_reason: LiveProviderSandboxCallBlockedReason | null;
}

export function buildLiveProviderSandboxCallPlan(
  request: LiveProviderSandboxCallRequest,
): LiveProviderSandboxCallPlan {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_CALL_PLAN',
    version: LIVE_PROVIDER_SANDBOX_CALL_VERSION,
    sandbox_only: TRUE_VALUE,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    request,
    allowed_operations: [
      'validate_caller_provided_sandbox_request',
      'resolve_secret_through_caller_seam',
      'invoke_caller_provided_transport',
      'build_sandbox_response_envelope',
    ],
    forbidden_operations: [
      'read_database',
      'write_database',
      'read_runtime_configuration',
      'read_local_secret',
      'persist_response_payload',
      'trust_response_for_action',
      'create_review_entry',
      'create_confirmation_flow',
      'create_write_plan',
      'execute_action',
      'call_runtime_runner',
    ],
  };
}

export async function runLiveProviderSandboxCall(
  plan: LiveProviderSandboxCallPlan,
  options: LiveProviderSandboxCallOptions,
): Promise<LiveProviderSandboxCallResult> {
  const requestValidation = validateLiveProviderSandboxCallRequest(plan.request);
  if (!requestValidation.ok) return buildBlockedResult(plan, options.transport, requestValidation.blocked_reason);

  if (plan.request.allow_live_call && options.secret_resolver === undefined) {
    return buildBlockedResult(plan, options.transport, 'provider_secret_resolver_missing');
  }

  const resolvedSecret = plan.request.allow_live_call && options.secret_resolver
    ? await options.secret_resolver(plan.request.provider_config.api_key_reference)
    : buildUnresolvedSecret();
  const secretValidation = validateResolvedProviderSecret(resolvedSecret, plan.request.allow_live_call);
  if (!secretValidation.ok) return buildBlockedResult(plan, options.transport, secretValidation.blocked_reason);

  const transportResult = await options.transport.invokeSandboxCall(plan.request, resolvedSecret);
  const transportValidation = validateLiveProviderSandboxTransportResult(transportResult);
  if (!transportValidation.ok) return buildBlockedResult(plan, options.transport, transportValidation.blocked_reason);

  const result = buildResultFromTransport(plan, options.transport, transportResult);
  const resultValidation = validateLiveProviderSandboxCallResult(result);
  if (!resultValidation.ok) return buildBlockedResult(plan, options.transport, resultValidation.blocked_reason);
  return result;
}

export function validateLiveProviderSandboxCallRequest(
  request: unknown,
): LiveProviderSandboxValidation {
  const record = asRecord(request);
  if (record?.kind !== 'LIVE_PROVIDER_SANDBOX_CALL_REQUEST') return blocked('invalid_request_kind');
  if (record.allow_db === true) return blocked('illegal_db_allowed');
  if (record.allow_runner === true) return blocked('illegal_runner_allowed');
  if (record.allow_execution === true) return blocked('illegal_execution_allowed');
  if (record.allow_review_queue_entry === true) return blocked('illegal_review_queue_entry_allowed');
  if (record.allow_confirmed_action === true) return blocked('illegal_confirmed_action_allowed');
  if (record.allow_human_confirmation === true) return blocked('illegal_human_confirmation_allowed');
  if (record.allow_write_plan_entry === true) return blocked('illegal_write_plan_entry_allowed');
  if (record.allow_env_read === true) return blocked('illegal_env_read_allowed');

  const prompt = asRecord(record.prompt_input);
  if (prompt?.contains_secret === true) return blocked('illegal_prompt_contains_secret');
  if (prompt?.contains_pii === true) return blocked('illegal_prompt_contains_pii');
  if (prompt?.from_database === true) return blocked('illegal_prompt_from_database');
  if (prompt?.from_crm_customer === true) return blocked('illegal_prompt_from_crm_customer');
  if (prompt?.trusted_for_action === true) return blocked('illegal_prompt_trusted_for_action');

  const providerConfig = asRecord(record.provider_config);
  if (providerConfig?.exposes_secret === true) return blocked('illegal_provider_config_exposes_secret');
  if (providerConfig?.prints_secret === true) return blocked('illegal_provider_config_prints_secret');
  if (
    containsUnsafePayload(providerConfig?.endpoint_url_redacted)
    || containsUnsafePayload(providerConfig?.model_name)
    || containsUnsafePayload(providerConfig?.api_key_reference)
  ) {
    return blocked('provider_secret_unresolved');
  }
  if (record.allow_live_call === true && providerConfig?.api_key_resolved === false) {
    return blocked('provider_secret_unresolved');
  }
  if (!isLiveProviderSandboxResolvedBy(providerConfig?.resolved_by)) {
    return blocked('provider_secret_unresolved');
  }

  return { ok: true, blocked_reason: null };
}

export function validateResolvedProviderSecret(
  secret: unknown,
  required: boolean,
): LiveProviderSandboxValidation {
  const record = asRecord(secret);
  if (required && record?.resolved !== true) return blocked('provider_secret_unresolved');
  if (record?.exposes_secret === true) return blocked('illegal_resolved_secret_exposes_secret');
  if (record?.prints_secret === true) return blocked('illegal_resolved_secret_prints_secret');
  return { ok: true, blocked_reason: null };
}

export function validateLiveProviderSandboxTransportResult(
  result: unknown,
): LiveProviderSandboxValidation {
  const record = asRecord(result);
  if (record?.contains_secret === true || containsUnsafePayload(record?.output_text_redacted)) {
    return blocked('illegal_transport_output_contains_secret');
  }
  if (record?.contains_pii === true) return blocked('illegal_transport_output_contains_pii');
  if (record?.trusted_for_action === true) return blocked('illegal_response_trusted_for_action');
  if (record?.executable === true) return blocked('illegal_response_executable');
  if (record?.produces_proposal === true) return blocked('illegal_response_produces_proposal');
  if (record?.enters_review_queue === true) return blocked('illegal_response_enters_review_queue');
  if (record?.persisted === true) return blocked('illegal_response_persisted');
  return { ok: true, blocked_reason: null };
}

export function validateLiveProviderSandboxCallResult(
  result: unknown,
): LiveProviderSandboxValidation {
  const record = asRecord(result);
  const answer = asRecord(record?.answer);
  const response = asRecord(answer?.response_envelope);

  if (record?.writes_database === true || answer?.writes_database === true) {
    return blocked('illegal_result_writes_database');
  }
  if (record?.represents_confirmed_action === true || answer?.produces_confirmed_action === true) {
    return blocked('illegal_result_represents_confirmed_action');
  }
  if (record?.represents_review_queue_entry === true || answer?.enters_review_queue === true) {
    return blocked('illegal_result_represents_review_queue_entry');
  }
  if (response?.contains_secret === true || containsUnsafePayload(response?.output_text_redacted)) {
    return blocked('illegal_transport_output_contains_secret');
  }
  if (response?.contains_pii === true) return blocked('illegal_transport_output_contains_pii');
  if (response?.trusted_for_action === true) return blocked('illegal_response_trusted_for_action');
  if (response?.executable === true) return blocked('illegal_response_executable');
  if (response?.produces_proposal === true) return blocked('illegal_response_produces_proposal');
  if (response?.enters_review_queue === true) return blocked('illegal_response_enters_review_queue');
  if (response?.persisted === true) return blocked('illegal_response_persisted');
  return { ok: true, blocked_reason: null };
}

function buildResultFromTransport(
  plan: LiveProviderSandboxCallPlan,
  transport: LiveProviderSandboxTransport,
  transportResult: LiveProviderSandboxTransportResult,
): LiveProviderSandboxCallResult {
  const outputText = limitOutputText(
    transportResult.output_text_redacted,
    plan.request.safety_policy.max_output_chars,
  );
  const responseEnvelope = buildResponseEnvelope(transportResult, outputText);
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_CALL_RESULT',
    version: LIVE_PROVIDER_SANDBOX_CALL_VERSION,
    plan,
    answer: {
      kind: 'LIVE_PROVIDER_SANDBOX_CALL_ANSWER',
      sandbox_only: TRUE_VALUE,
      live_call_attempted: transportResult.live_call_attempted,
      live_call_succeeded: transportResult.live_call_succeeded,
      provider_kind: plan.request.provider_config.provider_kind,
      model_name: plan.request.provider_config.model_name,
      response_envelope: responseEnvelope,
      error_envelope: transportResult.error_envelope,
      safety_summary: buildSafetySummary(plan.request.safety_policy),
      trace_summary: buildTraceSummary(plan, transport, transportResult.live_call_attempted),
      output_text_redacted: outputText,
      raw_output_available: FALSE_VALUE,
      persisted: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      produces_confirmed_action: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
    },
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    uses_network: transportResult.uses_network,
    calls_real_provider: transportResult.calls_real_provider,
    represents_model_output: TRUE_VALUE,
    represents_live_model_call: transportResult.live_provider_response,
    represents_executed_action: FALSE_VALUE,
    represents_confirmed_action: FALSE_VALUE,
    represents_review_queue_entry: FALSE_VALUE,
    represents_human_confirmation: FALSE_VALUE,
    represents_write_plan: FALSE_VALUE,
  };
}

function buildBlockedResult(
  plan: LiveProviderSandboxCallPlan,
  transport: LiveProviderSandboxTransport,
  blockedReason: LiveProviderSandboxCallBlockedReason | null,
): LiveProviderSandboxCallResult {
  const errorEnvelope = blockedReason === null ? null : buildErrorEnvelope(blockedReason);
  const responseEnvelope = buildSafeEmptyResponseEnvelope();
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_CALL_RESULT',
    version: LIVE_PROVIDER_SANDBOX_CALL_VERSION,
    plan,
    answer: {
      kind: 'LIVE_PROVIDER_SANDBOX_CALL_ANSWER',
      sandbox_only: TRUE_VALUE,
      live_call_attempted: FALSE_VALUE,
      live_call_succeeded: FALSE_VALUE,
      provider_kind: plan.request.provider_config.provider_kind,
      model_name: plan.request.provider_config.model_name,
      response_envelope: responseEnvelope,
      error_envelope: errorEnvelope,
      safety_summary: buildSafetySummary(plan.request.safety_policy),
      trace_summary: buildTraceSummary(plan, transport, FALSE_VALUE),
      output_text_redacted: '',
      raw_output_available: FALSE_VALUE,
      persisted: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      produces_confirmed_action: FALSE_VALUE,
      produces_executable_proposal: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      calls_runner: FALSE_VALUE,
    },
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    represents_model_output: TRUE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_confirmed_action: FALSE_VALUE,
    represents_review_queue_entry: FALSE_VALUE,
    represents_human_confirmation: FALSE_VALUE,
    represents_write_plan: FALSE_VALUE,
  };
}

function buildResponseEnvelope(
  transportResult: LiveProviderSandboxTransportResult,
  outputText: string,
): LiveProviderSandboxResponseEnvelope {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_RESPONSE_ENVELOPE',
    sandbox_only: TRUE_VALUE,
    live_provider_response: transportResult.live_provider_response,
    output_text_redacted: outputText,
    raw_output_stored: FALSE_VALUE,
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
    produces_proposal: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function buildSafeEmptyResponseEnvelope(): LiveProviderSandboxResponseEnvelope {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_RESPONSE_ENVELOPE',
    sandbox_only: TRUE_VALUE,
    live_provider_response: FALSE_VALUE,
    output_text_redacted: '',
    raw_output_stored: FALSE_VALUE,
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
    produces_proposal: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function buildErrorEnvelope(reason: LiveProviderSandboxCallBlockedReason): LiveProviderSandboxErrorEnvelope {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_ERROR_ENVELOPE',
    error_code: reason,
    error_message_redacted: `Sandbox call blocked: ${reason}`,
    includes_secret: FALSE_VALUE,
    includes_api_key: FALSE_VALUE,
    retryable: FALSE_VALUE,
  };
}

function buildSafetySummary(
  safetyPolicy: LiveProviderSandboxSafetyPolicy,
): LiveProviderSandboxSafetySummary {
  void safetyPolicy;
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_SAFETY_SUMMARY',
    prompt_redacted: TRUE_VALUE,
    response_redacted: TRUE_VALUE,
    persistence_allowed: FALSE_VALUE,
    action_generation_allowed: FALSE_VALUE,
    review_queue_entry_allowed: FALSE_VALUE,
    db_write_allowed: FALSE_VALUE,
  };
}

function buildTraceSummary(
  plan: LiveProviderSandboxCallPlan,
  transport: LiveProviderSandboxTransport,
  liveCallAttempted: boolean,
): LiveProviderSandboxTraceSummary {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_TRACE_SUMMARY',
    request_id: plan.request.request_id,
    provider_kind: plan.request.provider_config.provider_kind,
    transport_mode: liveCallAttempted ? transport.transport_mode : 'not_invoked',
    validation_checked: TRUE_VALUE,
    secret_resolved_by: liveCallAttempted ? plan.request.provider_config.resolved_by : 'not_resolved',
    sandbox_only: TRUE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function limitOutputText(value: string, maxChars: number): string {
  if (maxChars < 1) return '';
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function buildUnresolvedSecret(): ResolvedProviderSecret {
  return {
    resolved: FALSE_VALUE,
    secret_value_redacted: '[REDACTED_SECRET]',
    getSecretValue: () => '',
    exposes_secret: FALSE_VALUE,
    prints_secret: FALSE_VALUE,
  };
}

function containsUnsafePayload(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return normalized.includes('raw_secret')
    || normalized.includes('secret_value')
    || normalized.includes('credential leak')
    || normalized.includes('token leak');
}

function blocked(reason: LiveProviderSandboxCallBlockedReason): LiveProviderSandboxValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function isLiveProviderSandboxResolvedBy(value: unknown): value is LiveProviderSandboxResolvedBy {
  return value === 'injected_secret_resolver' || value === 'test_fake';
}
