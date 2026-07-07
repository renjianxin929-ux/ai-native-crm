import {
  buildLiveProviderSandboxCallPlan,
  runLiveProviderSandboxCall,
  type LiveProviderSandboxCallRequest,
  type LiveProviderSandboxCallResult,
  type LiveProviderSandboxErrorEnvelope,
  type LiveProviderSandboxProviderKind,
  type LiveProviderSandboxTransport,
  type ProviderSecretResolver,
} from './liveProviderSandboxCallReadiness';

export const MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION = 'v1';
export const MANUAL_LIVE_PROVIDER_SMOKE_AUTHORIZATION_PHRASE = 'RUN_ONE_MANUAL_LIVE_PROVIDER_SMOKE';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ManualSmokeProviderKind = Exclude<LiveProviderSandboxProviderKind, 'local_fake'>;
export type ManualSmokeResolvedBy = 'injected_secret_resolver';

export type ManualLiveProviderSmokeBlockedReason =
  | 'invalid_request_kind'
  | 'manual_live_call_not_authorized'
  | 'manual_live_call_wrong_phrase'
  | 'manual_live_network_not_allowed'
  | 'manual_live_provider_not_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_db_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_review_queue_entry_allowed'
  | 'illegal_confirmed_action_allowed'
  | 'illegal_human_confirmation_allowed'
  | 'illegal_write_plan_entry_allowed'
  | 'illegal_provider_kind_local_fake'
  | 'provider_secret_unresolved'
  | 'provider_secret_resolver_missing'
  | 'illegal_provider_resolved_by'
  | 'illegal_provider_config_exposes_secret'
  | 'illegal_provider_config_prints_secret'
  | 'illegal_resolved_secret_exposes_secret'
  | 'illegal_resolved_secret_prints_secret'
  | 'illegal_prompt_contains_secret'
  | 'illegal_prompt_contains_pii'
  | 'illegal_prompt_from_database'
  | 'illegal_prompt_from_crm_customer'
  | 'illegal_prompt_trusted_for_action'
  | 'illegal_safety_policy_allows_persistence'
  | 'illegal_safety_policy_allows_action_generation'
  | 'illegal_safety_policy_allows_review_queue_entry'
  | 'illegal_safety_policy_allows_db_write'
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

export interface ManualSmokePromptInput {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_PROMPT_INPUT';
  text: string;
  contains_pii: BoolFalse;
  contains_secret: BoolFalse;
  from_database: BoolFalse;
  from_crm_customer: BoolFalse;
  trusted_for_action: BoolFalse;
}

export interface ManualSmokeProviderConfig {
  provider_kind: ManualSmokeProviderKind;
  endpoint_url_redacted: string;
  model_name: string;
  api_key_reference: string;
  api_key_resolved: boolean;
  resolved_by: ManualSmokeResolvedBy;
  exposes_secret: BoolFalse;
  prints_secret: BoolFalse;
}

export interface ManualSmokeSafetyPolicy {
  redact_prompt: BoolTrue;
  redact_response: BoolTrue;
  max_output_chars: number;
  timeout_ms: number;
  allow_persistence: BoolFalse;
  allow_action_generation: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_db_write: BoolFalse;
}

export interface ManualLiveProviderSmokeRequest {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_REQUEST';
  version: typeof MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION;
  request_id: string;
  user_explicitly_authorized_live_call: boolean;
  authorization_phrase: string;
  provider_config: ManualSmokeProviderConfig;
  prompt_input: ManualSmokePromptInput;
  safety_policy: ManualSmokeSafetyPolicy;
  allow_network: boolean;
  allow_live_provider: boolean;
  allow_env_read: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_confirmed_action: BoolFalse;
  allow_human_confirmation: BoolFalse;
  allow_write_plan_entry: BoolFalse;
  dry_run_default: BoolTrue;
}

export interface ManualLiveProviderSmokePlan {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_PLAN';
  version: typeof MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION;
  manual_only: BoolTrue;
  sandbox_only: BoolTrue;
  executable: BoolFalse;
  persisted: BoolFalse;
  request: ManualLiveProviderSmokeRequest;
  sandbox_request: LiveProviderSandboxCallRequest;
}

export interface ManualSmokeResponseEnvelope {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_RESPONSE_ENVELOPE';
  sandbox_only: BoolTrue;
  manual_smoke_only: BoolTrue;
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

export interface ManualSmokeErrorEnvelope {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_ERROR_ENVELOPE';
  error_code: ManualLiveProviderSmokeBlockedReason | 'sandbox_error';
  error_message_redacted: string;
  includes_secret: BoolFalse;
  includes_api_key: BoolFalse;
  retryable: boolean;
}

export interface ManualSmokeSafetySummary {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_SAFETY_SUMMARY';
  prompt_redacted: BoolTrue;
  response_redacted: BoolTrue;
  persistence_allowed: BoolFalse;
  action_generation_allowed: BoolFalse;
  review_queue_entry_allowed: BoolFalse;
  db_write_allowed: BoolFalse;
}

export interface ManualSmokeTraceSummary {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_TRACE_SUMMARY';
  request_id: string;
  provider_kind: ManualSmokeProviderKind;
  secret_resolved: boolean;
  secret_resolved_by: ManualSmokeResolvedBy | 'not_resolved';
  transport_mode: 'fake' | 'live_capable' | 'not_invoked';
  sandbox_only: BoolTrue;
  manual_only: BoolTrue;
  persisted: BoolFalse;
}

export interface ManualLiveProviderSmokeAnswer {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_ANSWER';
  smoke_gate_only: BoolTrue;
  manual_only: BoolTrue;
  sandbox_only: BoolTrue;
  authorization_accepted: boolean;
  provider_kind: ManualSmokeProviderKind;
  model_name: string;
  response_envelope: null | ManualSmokeResponseEnvelope;
  error_envelope: null | ManualSmokeErrorEnvelope;
  safety_summary: ManualSmokeSafetySummary;
  trace_summary: ManualSmokeTraceSummary;
  output_text_redacted: string | null;
  raw_output_available: BoolFalse;
  raw_output_stored: BoolFalse;
  persisted: BoolFalse;
  enters_review_queue: BoolFalse;
  produces_confirmed_action: BoolFalse;
  produces_executable_proposal: BoolFalse;
  writes_database: BoolFalse;
  calls_runner: BoolFalse;
}

export interface ManualLiveProviderSmokeResult {
  kind: 'MANUAL_LIVE_PROVIDER_SMOKE_RESULT';
  version: typeof MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION;
  plan: ManualLiveProviderSmokePlan;
  answer: ManualLiveProviderSmokeAnswer;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  reads_env: BoolFalse;
  uses_network: boolean;
  calls_real_provider: boolean;
  manual_live_smoke_attempted: boolean;
  manual_live_smoke_succeeded: boolean;
  represents_model_output: BoolTrue;
  represents_live_model_call: boolean;
  represents_executed_action: BoolFalse;
  represents_confirmed_action: BoolFalse;
  represents_review_queue_entry: BoolFalse;
  represents_human_confirmation: BoolFalse;
  represents_write_plan: BoolFalse;
}

export interface ManualLiveProviderSmokeOptions {
  secret_resolver?: ProviderSecretResolver;
  transport?: LiveProviderSandboxTransport;
}

interface ManualValidation {
  ok: boolean;
  blocked_reason: ManualLiveProviderSmokeBlockedReason | null;
}

export function buildManualLiveProviderSmokePlan(
  request: ManualLiveProviderSmokeRequest,
): ManualLiveProviderSmokePlan {
  return {
    kind: 'MANUAL_LIVE_PROVIDER_SMOKE_PLAN',
    version: MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION,
    manual_only: TRUE_VALUE,
    sandbox_only: TRUE_VALUE,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    request,
    sandbox_request: mapToSandboxRequest(request),
  };
}

export async function runManualLiveProviderSmokeGate(
  request: ManualLiveProviderSmokeRequest,
  options: ManualLiveProviderSmokeOptions = {},
): Promise<ManualLiveProviderSmokeResult> {
  const plan = buildManualLiveProviderSmokePlan(request);
  const requestValidation = validateManualLiveProviderSmokeRequest(request);
  if (!requestValidation.ok) return buildBlockedResult(plan, requestValidation.blocked_reason);
  if (options.transport === undefined) return buildBlockedResult(plan, 'manual_live_provider_not_allowed');
  if (options.secret_resolver === undefined) return buildBlockedResult(plan, 'provider_secret_resolver_missing');

  const sandboxResult = await runLiveProviderSandboxCall(
    buildLiveProviderSandboxCallPlan(plan.sandbox_request),
    {
      secret_resolver: options.secret_resolver,
      transport: options.transport,
    },
  );
  const sandboxValidation = validateSandboxResult(sandboxResult);
  if (!sandboxValidation.ok) return buildBlockedResult(plan, sandboxValidation.blocked_reason);
  return buildResultFromSandbox(plan, sandboxResult);
}

export function validateManualLiveProviderSmokeRequest(
  request: unknown,
): ManualValidation {
  const record = asRecord(request);
  if (record?.kind !== 'MANUAL_LIVE_PROVIDER_SMOKE_REQUEST') return blocked('invalid_request_kind');
  if (record.user_explicitly_authorized_live_call !== true) return blocked('manual_live_call_not_authorized');
  if (record.authorization_phrase !== MANUAL_LIVE_PROVIDER_SMOKE_AUTHORIZATION_PHRASE) {
    return blocked('manual_live_call_wrong_phrase');
  }
  if (record.allow_network !== true) return blocked('manual_live_network_not_allowed');
  if (record.allow_live_provider !== true) return blocked('manual_live_provider_not_allowed');
  if (record.allow_env_read === true) return blocked('illegal_env_read_allowed');
  if (record.allow_db === true) return blocked('illegal_db_allowed');
  if (record.allow_runner === true) return blocked('illegal_runner_allowed');
  if (record.allow_execution === true) return blocked('illegal_execution_allowed');
  if (record.allow_review_queue_entry === true) return blocked('illegal_review_queue_entry_allowed');
  if (record.allow_confirmed_action === true) return blocked('illegal_confirmed_action_allowed');
  if (record.allow_human_confirmation === true) return blocked('illegal_human_confirmation_allowed');
  if (record.allow_write_plan_entry === true) return blocked('illegal_write_plan_entry_allowed');

  const provider = asRecord(record.provider_config);
  if (provider?.provider_kind === 'local_fake') return blocked('illegal_provider_kind_local_fake');
  if (!isManualProviderKind(provider?.provider_kind)) return blocked('illegal_provider_kind_local_fake');
  if (provider?.api_key_resolved !== true) return blocked('provider_secret_unresolved');
  if (provider?.resolved_by !== 'injected_secret_resolver') return blocked('illegal_provider_resolved_by');
  if (provider?.exposes_secret === true) return blocked('illegal_provider_config_exposes_secret');
  if (provider?.prints_secret === true) return blocked('illegal_provider_config_prints_secret');
  if (
    containsUnsafePayload(provider?.endpoint_url_redacted)
    || containsUnsafePayload(provider?.model_name)
    || containsUnsafePayload(provider?.api_key_reference)
  ) {
    return blocked('provider_secret_unresolved');
  }

  const prompt = asRecord(record.prompt_input);
  if (prompt?.contains_secret === true || containsUnsafePayload(prompt?.text)) return blocked('illegal_prompt_contains_secret');
  if (prompt?.contains_pii === true) return blocked('illegal_prompt_contains_pii');
  if (prompt?.from_database === true) return blocked('illegal_prompt_from_database');
  if (prompt?.from_crm_customer === true) return blocked('illegal_prompt_from_crm_customer');
  if (prompt?.trusted_for_action === true) return blocked('illegal_prompt_trusted_for_action');

  const safetyPolicy = asRecord(record.safety_policy);
  if (safetyPolicy?.allow_persistence === true) return blocked('illegal_safety_policy_allows_persistence');
  if (safetyPolicy?.allow_action_generation === true) return blocked('illegal_safety_policy_allows_action_generation');
  if (safetyPolicy?.allow_review_queue_entry === true) return blocked('illegal_safety_policy_allows_review_queue_entry');
  if (safetyPolicy?.allow_db_write === true) return blocked('illegal_safety_policy_allows_db_write');

  return { ok: true, blocked_reason: null };
}

export function validateManualLiveProviderSmokeResult(
  result: unknown,
): ManualValidation {
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

function mapToSandboxRequest(request: ManualLiveProviderSmokeRequest): LiveProviderSandboxCallRequest {
  return {
    kind: 'LIVE_PROVIDER_SANDBOX_CALL_REQUEST',
    version: 'v1',
    request_id: request.request_id,
    prompt_input: {
      kind: 'LIVE_PROVIDER_SANDBOX_PROMPT_INPUT',
      text: request.prompt_input.text,
      contains_pii: request.prompt_input.contains_pii,
      contains_secret: request.prompt_input.contains_secret,
      from_database: request.prompt_input.from_database,
      from_crm_customer: request.prompt_input.from_crm_customer,
      trusted_for_action: request.prompt_input.trusted_for_action,
    },
    provider_config: {
      provider_kind: request.provider_config.provider_kind,
      endpoint_url_redacted: request.provider_config.endpoint_url_redacted,
      model_name: request.provider_config.model_name,
      api_key_reference: request.provider_config.api_key_reference,
      api_key_resolved: request.provider_config.api_key_resolved,
      exposes_secret: request.provider_config.exposes_secret,
      prints_secret: request.provider_config.prints_secret,
      resolved_by: request.provider_config.resolved_by,
    },
    safety_policy: request.safety_policy,
    allow_live_call: request.allow_live_provider,
    allow_network: request.allow_network,
    allow_env_read: request.allow_env_read,
    allow_db: request.allow_db,
    allow_runner: request.allow_runner,
    allow_execution: request.allow_execution,
    allow_review_queue_entry: request.allow_review_queue_entry,
    allow_confirmed_action: request.allow_confirmed_action,
    allow_human_confirmation: request.allow_human_confirmation,
    allow_write_plan_entry: request.allow_write_plan_entry,
  };
}

function validateSandboxResult(result: LiveProviderSandboxCallResult): ManualValidation {
  const sandboxError = result.answer.error_envelope;
  if (sandboxError !== null) return blocked(mapSandboxError(sandboxError));
  return validateManualLiveProviderSmokeResult(buildResultFromSandbox(buildManualLiveProviderSmokePlan({
    ...result.plan.request,
    kind: 'MANUAL_LIVE_PROVIDER_SMOKE_REQUEST',
    version: MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION,
    user_explicitly_authorized_live_call: TRUE_VALUE,
    authorization_phrase: MANUAL_LIVE_PROVIDER_SMOKE_AUTHORIZATION_PHRASE,
    provider_config: result.plan.request.provider_config as ManualSmokeProviderConfig,
    prompt_input: {
      ...result.plan.request.prompt_input,
      kind: 'MANUAL_LIVE_PROVIDER_SMOKE_PROMPT_INPUT',
    },
    allow_live_provider: result.plan.request.allow_live_call,
    dry_run_default: TRUE_VALUE,
  }), result));
}

function buildResultFromSandbox(
  plan: ManualLiveProviderSmokePlan,
  sandboxResult: LiveProviderSandboxCallResult,
): ManualLiveProviderSmokeResult {
  const responseEnvelope = sandboxResult.answer.response_envelope;
  const result: ManualLiveProviderSmokeResult = {
    kind: 'MANUAL_LIVE_PROVIDER_SMOKE_RESULT',
    version: MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION,
    plan,
    answer: {
      kind: 'MANUAL_LIVE_PROVIDER_SMOKE_ANSWER',
      smoke_gate_only: TRUE_VALUE,
      manual_only: TRUE_VALUE,
      sandbox_only: TRUE_VALUE,
      authorization_accepted: TRUE_VALUE,
      provider_kind: plan.request.provider_config.provider_kind,
      model_name: plan.request.provider_config.model_name,
      response_envelope: {
        kind: 'MANUAL_LIVE_PROVIDER_SMOKE_RESPONSE_ENVELOPE',
        sandbox_only: TRUE_VALUE,
        manual_smoke_only: TRUE_VALUE,
        live_provider_response: responseEnvelope.live_provider_response,
        output_text_redacted: responseEnvelope.output_text_redacted,
        raw_output_stored: FALSE_VALUE,
        contains_secret: FALSE_VALUE,
        contains_pii: FALSE_VALUE,
        trusted_for_action: FALSE_VALUE,
        executable: FALSE_VALUE,
        produces_proposal: FALSE_VALUE,
        enters_review_queue: FALSE_VALUE,
        persisted: FALSE_VALUE,
      },
      error_envelope: null,
      safety_summary: buildSafetySummary(),
      trace_summary: {
        kind: 'MANUAL_LIVE_PROVIDER_SMOKE_TRACE_SUMMARY',
        request_id: plan.request.request_id,
        provider_kind: plan.request.provider_config.provider_kind,
        secret_resolved: TRUE_VALUE,
        secret_resolved_by: plan.request.provider_config.resolved_by,
        transport_mode: sandboxResult.answer.trace_summary.transport_mode,
        sandbox_only: TRUE_VALUE,
        manual_only: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      output_text_redacted: responseEnvelope.output_text_redacted,
      raw_output_available: FALSE_VALUE,
      raw_output_stored: FALSE_VALUE,
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
    uses_network: sandboxResult.uses_network,
    calls_real_provider: sandboxResult.calls_real_provider,
    manual_live_smoke_attempted: sandboxResult.answer.live_call_attempted,
    manual_live_smoke_succeeded: sandboxResult.answer.live_call_succeeded,
    represents_model_output: TRUE_VALUE,
    represents_live_model_call: sandboxResult.represents_live_model_call,
    represents_executed_action: FALSE_VALUE,
    represents_confirmed_action: FALSE_VALUE,
    represents_review_queue_entry: FALSE_VALUE,
    represents_human_confirmation: FALSE_VALUE,
    represents_write_plan: FALSE_VALUE,
  };
  return result;
}

function buildBlockedResult(
  plan: ManualLiveProviderSmokePlan,
  reason: ManualLiveProviderSmokeBlockedReason | null,
): ManualLiveProviderSmokeResult {
  return {
    kind: 'MANUAL_LIVE_PROVIDER_SMOKE_RESULT',
    version: MANUAL_LIVE_PROVIDER_SMOKE_GATE_VERSION,
    plan,
    answer: {
      kind: 'MANUAL_LIVE_PROVIDER_SMOKE_ANSWER',
      smoke_gate_only: TRUE_VALUE,
      manual_only: TRUE_VALUE,
      sandbox_only: TRUE_VALUE,
      authorization_accepted: FALSE_VALUE,
      provider_kind: plan.request.provider_config.provider_kind,
      model_name: plan.request.provider_config.model_name,
      response_envelope: null,
      error_envelope: reason === null ? null : buildErrorEnvelope(reason),
      safety_summary: buildSafetySummary(),
      trace_summary: {
        kind: 'MANUAL_LIVE_PROVIDER_SMOKE_TRACE_SUMMARY',
        request_id: plan.request.request_id,
        provider_kind: plan.request.provider_config.provider_kind,
        secret_resolved: FALSE_VALUE,
        secret_resolved_by: 'not_resolved',
        transport_mode: 'not_invoked',
        sandbox_only: TRUE_VALUE,
        manual_only: TRUE_VALUE,
        persisted: FALSE_VALUE,
      },
      output_text_redacted: null,
      raw_output_available: FALSE_VALUE,
      raw_output_stored: FALSE_VALUE,
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
    manual_live_smoke_attempted: FALSE_VALUE,
    manual_live_smoke_succeeded: FALSE_VALUE,
    represents_model_output: TRUE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_confirmed_action: FALSE_VALUE,
    represents_review_queue_entry: FALSE_VALUE,
    represents_human_confirmation: FALSE_VALUE,
    represents_write_plan: FALSE_VALUE,
  };
}

function buildErrorEnvelope(reason: ManualLiveProviderSmokeBlockedReason): ManualSmokeErrorEnvelope {
  return {
    kind: 'MANUAL_LIVE_PROVIDER_SMOKE_ERROR_ENVELOPE',
    error_code: reason,
    error_message_redacted: `Manual smoke blocked: ${reason}`,
    includes_secret: FALSE_VALUE,
    includes_api_key: FALSE_VALUE,
    retryable: FALSE_VALUE,
  };
}

function buildSafetySummary(): ManualSmokeSafetySummary {
  return {
    kind: 'MANUAL_LIVE_PROVIDER_SMOKE_SAFETY_SUMMARY',
    prompt_redacted: TRUE_VALUE,
    response_redacted: TRUE_VALUE,
    persistence_allowed: FALSE_VALUE,
    action_generation_allowed: FALSE_VALUE,
    review_queue_entry_allowed: FALSE_VALUE,
    db_write_allowed: FALSE_VALUE,
  };
}

function mapSandboxError(error: LiveProviderSandboxErrorEnvelope): ManualLiveProviderSmokeBlockedReason {
  if (error.error_code === 'transport_error') return 'illegal_transport_output_contains_secret';
  return error.error_code;
}

function isManualProviderKind(value: unknown): value is ManualSmokeProviderKind {
  return value === 'openai_compatible' || value === 'deepseek_compatible' || value === 'qwen_compatible';
}

function containsUnsafePayload(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return normalized.includes('raw_secret')
    || normalized.includes('secret_value')
    || normalized.includes('credential leak')
    || normalized.includes('token leak');
}

function blocked(reason: ManualLiveProviderSmokeBlockedReason): ManualValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
