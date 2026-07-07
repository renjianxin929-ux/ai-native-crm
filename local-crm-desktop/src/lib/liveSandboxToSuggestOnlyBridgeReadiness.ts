import {
  buildModelSuggestOnlyOutputGatePlan,
  runModelSuggestOnlyOutputGate,
  type CallerProvidedModelOutputEnvelope,
  type ModelSuggestionPolicy,
  type ModelSuggestOnlyOutputGateResult,
} from './modelSuggestOnlyOutputGateReadiness';
import type { LiveProviderSandboxCallResult } from './liveProviderSandboxCallReadiness';
import type { ManualLiveProviderSmokeResult } from './manualLiveProviderSmokeGateReadiness';

export const LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type LiveSandboxToSuggestOnlyBridgeSourceKind =
  | 'manual_live_provider_smoke'
  | 'live_provider_sandbox_call';

export type LiveSandboxToSuggestOnlyBridgeBlockedReason =
  | 'invalid_request_kind'
  | 'invalid_source_selection'
  | 'illegal_network_allowed'
  | 'illegal_model_call_allowed'
  | 'illegal_env_read_allowed'
  | 'illegal_db_allowed'
  | 'illegal_runner_allowed'
  | 'illegal_execution_allowed'
  | 'illegal_review_queue_entry_allowed'
  | 'illegal_confirmed_action_allowed'
  | 'illegal_human_confirmation_allowed'
  | 'illegal_write_plan_entry_allowed'
  | 'source_kind_mismatch'
  | 'source_missing_answer'
  | 'source_missing_response_envelope'
  | 'source_missing_output_text_redacted'
  | 'source_empty_output_text_redacted'
  | 'source_raw_output_available'
  | 'source_raw_output_stored'
  | 'source_trusted_for_action'
  | 'source_enters_review_queue'
  | 'source_writes_database'
  | 'source_persisted'
  | 'source_contains_secret'
  | 'source_contains_pii'
  | 'source_represents_executed_action'
  | 'source_represents_confirmed_action'
  | 'source_represents_review_queue_entry'
  | 'source_error_without_response'
  | 'source_unsafe_output_marker'
  | 'suggest_only_gate_blocked';

export interface LiveSandboxToSuggestOnlyBridgeRequest {
  kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_REQUEST';
  version: typeof LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION;
  request_id: string;
  source_kind: LiveSandboxToSuggestOnlyBridgeSourceKind;
  bridge_only: BoolTrue;
  caller_provided_only: BoolTrue;
  source_manual_smoke_result?: ManualLiveProviderSmokeResult;
  source_sandbox_call_result?: LiveProviderSandboxCallResult;
  allow_network: BoolFalse;
  allow_model_call: BoolFalse;
  allow_env_read: BoolFalse;
  allow_db: BoolFalse;
  allow_runner: BoolFalse;
  allow_execution: BoolFalse;
  allow_review_queue_entry: BoolFalse;
  allow_confirmed_action: BoolFalse;
  allow_human_confirmation: BoolFalse;
  allow_write_plan_entry: BoolFalse;
}

export interface LiveSandboxToSuggestOnlyBridgeAnswer {
  kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_ANSWER';
  version: typeof LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION;
  bridge_blocked: boolean;
  blocked_reason: LiveSandboxToSuggestOnlyBridgeBlockedReason | null;
  bridge_only: BoolTrue;
  suggest_only: BoolTrue;
  caller_provided_only: BoolTrue;
  source_kind: LiveSandboxToSuggestOnlyBridgeSourceKind;
  source_request_id: string | null;
  source_provider_kind: string | null;
  source_model_name: string | null;
  source_was_live_sandbox: BoolTrue;
  generated_model_output_envelope: boolean;
  model_output_envelope: CallerProvidedModelOutputEnvelope | null;
  suggest_only_result: ModelSuggestOnlyOutputGateResult | null;
  output_text_redacted: string | null;
  trusted_for_action: BoolFalse;
  enters_review_queue: BoolFalse;
  writes_database: BoolFalse;
  persisted: BoolFalse;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  represents_live_model_call: BoolFalse;
  enters_human_confirmation: BoolFalse;
  writes_database_plan: BoolFalse;
}

export interface LiveSandboxToSuggestOnlyBridgeResult {
  kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_RESULT';
  version: typeof LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION;
  answer: LiveSandboxToSuggestOnlyBridgeAnswer;
  bridge_only: BoolTrue;
  suggest_only: BoolTrue;
  caller_provided_only: BoolTrue;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  reads_env: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  trusted_for_action: BoolFalse;
  persisted: BoolFalse;
  enters_review_queue: BoolFalse;
  represents_live_model_call: BoolFalse;
  represents_executed_action: BoolFalse;
  represents_confirmed_action: BoolFalse;
  represents_review_queue_entry: BoolFalse;
}

interface SourceMetadata {
  source_request_id: string;
  source_provider_kind: string;
  source_model_name: string;
  output_text: string;
}

interface BridgeValidation {
  ok: boolean;
  blocked_reason: LiveSandboxToSuggestOnlyBridgeBlockedReason | null;
  source_metadata: SourceMetadata | null;
}

export function runLiveSandboxToSuggestOnlyBridge(
  request: LiveSandboxToSuggestOnlyBridgeRequest,
): LiveSandboxToSuggestOnlyBridgeResult {
  const validation = validateLiveSandboxToSuggestOnlyBridgeRequest(request);
  if (!validation.ok || validation.source_metadata === null) {
    return buildBlockedResult(request, validation.blocked_reason);
  }

  const envelope = buildCallerProvidedEnvelope(request, validation.source_metadata);
  const suggestOnlyResult = runModelSuggestOnlyOutputGate(buildModelSuggestOnlyOutputGatePlan({
    kind: 'MODEL_SUGGEST_ONLY_OUTPUT_GATE_REQUEST',
    version: 'v1',
    request_id: `${request.request_id}:suggest-only`,
    model_output_envelope: envelope,
    suggestion_policy: buildSuggestionPolicy(),
    caller_provided_only: TRUE_VALUE,
    fixture_output_only: TRUE_VALUE,
    suggestion_gate_only: TRUE_VALUE,
    allow_model_call: FALSE_VALUE,
    allow_network: FALSE_VALUE,
    allow_env_read: FALSE_VALUE,
    allow_secret_material: FALSE_VALUE,
    allow_db: FALSE_VALUE,
    allow_runner: FALSE_VALUE,
    allow_execution: FALSE_VALUE,
    allow_review_queue_entry: FALSE_VALUE,
    allow_confirmed_action: FALSE_VALUE,
    allow_human_confirmation: FALSE_VALUE,
    allow_write_plan_entry: FALSE_VALUE,
  }));

  if (suggestOnlyResult.answer.suggestion_gate_blocked) {
    return buildBlockedResult(request, 'suggest_only_gate_blocked', validation.source_metadata, envelope, suggestOnlyResult);
  }

  return {
    kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_RESULT',
    version: LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION,
    answer: {
      kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_ANSWER',
      version: LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION,
      bridge_blocked: FALSE_VALUE,
      blocked_reason: null,
      bridge_only: TRUE_VALUE,
      suggest_only: TRUE_VALUE,
      caller_provided_only: TRUE_VALUE,
      source_kind: request.source_kind,
      source_request_id: validation.source_metadata.source_request_id,
      source_provider_kind: validation.source_metadata.source_provider_kind,
      source_model_name: validation.source_metadata.source_model_name,
      source_was_live_sandbox: TRUE_VALUE,
      generated_model_output_envelope: TRUE_VALUE,
      model_output_envelope: envelope,
      suggest_only_result: suggestOnlyResult,
      output_text_redacted: validation.source_metadata.output_text,
      trusted_for_action: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      persisted: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      represents_live_model_call: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      writes_database_plan: FALSE_VALUE,
    },
    ...nonActionableResultFlags(),
  };
}

export function validateLiveSandboxToSuggestOnlyBridgeRequest(
  request: unknown,
): BridgeValidation {
  const record = asRecord(request);
  if (record?.kind !== 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_REQUEST') {
    return blocked('invalid_request_kind');
  }

  for (const [key, reason] of PERMISSION_FLAG_BLOCKERS) {
    if (record[key] === true) return blocked(reason);
  }

  const hasManual = record.source_manual_smoke_result !== undefined;
  const hasSandbox = record.source_sandbox_call_result !== undefined;
  if (hasManual === hasSandbox) return blocked('invalid_source_selection');

  if (record.source_kind === 'manual_live_provider_smoke' && !hasManual) return blocked('source_kind_mismatch');
  if (record.source_kind === 'live_provider_sandbox_call' && !hasSandbox) return blocked('source_kind_mismatch');
  if (record.source_kind !== 'manual_live_provider_smoke' && record.source_kind !== 'live_provider_sandbox_call') {
    return blocked('source_kind_mismatch');
  }

  return validateSourceResult(
    record.source_kind,
    hasManual ? record.source_manual_smoke_result : record.source_sandbox_call_result,
  );
}

function validateSourceResult(
  sourceKind: LiveSandboxToSuggestOnlyBridgeSourceKind,
  value: unknown,
): BridgeValidation {
  const source = asRecord(value);
  const answer = asRecord(source?.answer);
  if (answer === null) return blocked('source_missing_answer');

  const response = asRecord(answer.response_envelope);
  if (response === null) {
    if (answer.error_envelope !== null && answer.error_envelope !== undefined) {
      return blocked('source_error_without_response');
    }
    return blocked('source_missing_response_envelope');
  }

  if (!('output_text_redacted' in response)) return blocked('source_missing_output_text_redacted');
  if (typeof response.output_text_redacted !== 'string') return blocked('source_missing_output_text_redacted');
  if (response.output_text_redacted.trim().length === 0) return blocked('source_empty_output_text_redacted');
  if (answer.error_envelope !== null && answer.error_envelope !== undefined) return blocked('source_error_without_response');
  if (answer.raw_output_available !== false) return blocked('source_raw_output_available');
  if (answer.raw_output_stored !== undefined && answer.raw_output_stored !== false) return blocked('source_raw_output_stored');
  if (response.raw_output_stored !== false) return blocked('source_raw_output_stored');
  if (response.trusted_for_action !== false) return blocked('source_trusted_for_action');
  if (answer.enters_review_queue !== false || response.enters_review_queue !== false) {
    return blocked('source_enters_review_queue');
  }
  if (source?.writes_database !== false || answer.writes_database !== false) return blocked('source_writes_database');
  if (source?.persisted !== false || answer.persisted !== false || response.persisted !== false) {
    return blocked('source_persisted');
  }
  if (response.contains_secret !== false) return blocked('source_contains_secret');
  if (response.contains_pii !== false) return blocked('source_contains_pii');
  if (source?.represents_executed_action === true) return blocked('source_represents_executed_action');
  if (source?.represents_confirmed_action === true || answer.produces_confirmed_action === true) {
    return blocked('source_represents_confirmed_action');
  }
  if (source?.represents_review_queue_entry === true) return blocked('source_represents_review_queue_entry');
  if (containsUnsafeSourceOutput(response.output_text_redacted)) return blocked('source_unsafe_output_marker');

  const metadata = buildSourceMetadata(sourceKind, source, answer, response.output_text_redacted);
  return { ok: true, blocked_reason: null, source_metadata: metadata };
}

function buildSourceMetadata(
  sourceKind: LiveSandboxToSuggestOnlyBridgeSourceKind,
  source: Record<string, unknown>,
  answer: Record<string, unknown>,
  outputText: string,
): SourceMetadata {
  const plan = asRecord(source.plan);
  const planRequest = asRecord(plan?.request);
  const requestId = typeof planRequest?.request_id === 'string' ? planRequest.request_id : 'unknown-source-request';
  return {
    source_request_id: requestId,
    source_provider_kind: typeof answer.provider_kind === 'string' ? answer.provider_kind : sourceKind,
    source_model_name: typeof answer.model_name === 'string' ? answer.model_name : 'unknown-model',
    output_text: outputText,
  };
}

function buildCallerProvidedEnvelope(
  request: LiveSandboxToSuggestOnlyBridgeRequest,
  metadata: SourceMetadata,
): CallerProvidedModelOutputEnvelope {
  return {
    kind: 'CALLER_PROVIDED_MODEL_OUTPUT_ENVELOPE',
    version: 'v1',
    output_id: `${request.request_id}:loop51-caller-provided-output`,
    source: 'caller_provided',
    output_text: metadata.output_text,
    output_text_redacted: TRUE_VALUE,
    contains_secret: FALSE_VALUE,
    contains_pii: FALSE_VALUE,
    from_live_provider: FALSE_VALUE,
    from_network: FALSE_VALUE,
    from_database: FALSE_VALUE,
    persisted: FALSE_VALUE,
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
    produces_proposal: FALSE_VALUE,
    represents_model_call: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    uses_network: FALSE_VALUE,
  };
}

function buildSuggestionPolicy(): ModelSuggestionPolicy {
  return {
    kind: 'MODEL_SUGGESTION_POLICY',
    policy_only: TRUE_VALUE,
    allow_suggestion_candidate: TRUE_VALUE,
    allow_confirmed_action: FALSE_VALUE,
    allow_execution: FALSE_VALUE,
    allow_review_queue_entry: FALSE_VALUE,
    allow_write_plan_entry: FALSE_VALUE,
    require_human_review_before_any_action: TRUE_VALUE,
    require_evidence_refs: TRUE_VALUE,
    require_risk_flags: TRUE_VALUE,
    require_no_secret: TRUE_VALUE,
    require_no_pii: TRUE_VALUE,
    require_trace: TRUE_VALUE,
  };
}

function buildBlockedResult(
  request: LiveSandboxToSuggestOnlyBridgeRequest,
  reason: LiveSandboxToSuggestOnlyBridgeBlockedReason | null,
  metadata: SourceMetadata | null = null,
  envelope: CallerProvidedModelOutputEnvelope | null = null,
  suggestOnlyResult: ModelSuggestOnlyOutputGateResult | null = null,
): LiveSandboxToSuggestOnlyBridgeResult {
  return {
    kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_RESULT',
    version: LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION,
    answer: {
      kind: 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_ANSWER',
      version: LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_VERSION,
      bridge_blocked: TRUE_VALUE,
      blocked_reason: reason,
      bridge_only: TRUE_VALUE,
      suggest_only: TRUE_VALUE,
      caller_provided_only: TRUE_VALUE,
      source_kind: request.source_kind,
      source_request_id: metadata?.source_request_id ?? null,
      source_provider_kind: metadata?.source_provider_kind ?? null,
      source_model_name: metadata?.source_model_name ?? null,
      source_was_live_sandbox: TRUE_VALUE,
      generated_model_output_envelope: envelope !== null,
      model_output_envelope: envelope,
      suggest_only_result: suggestOnlyResult,
      output_text_redacted: metadata?.output_text ?? null,
      trusted_for_action: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      persisted: FALSE_VALUE,
      uses_network: FALSE_VALUE,
      calls_real_provider: FALSE_VALUE,
      represents_live_model_call: FALSE_VALUE,
      enters_human_confirmation: FALSE_VALUE,
      writes_database_plan: FALSE_VALUE,
    },
    ...nonActionableResultFlags(),
  };
}

function nonActionableResultFlags(): Omit<LiveSandboxToSuggestOnlyBridgeResult, 'kind' | 'version' | 'answer'> {
  return {
    bridge_only: TRUE_VALUE,
    suggest_only: TRUE_VALUE,
    caller_provided_only: TRUE_VALUE,
    uses_network: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    trusted_for_action: FALSE_VALUE,
    persisted: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    represents_live_model_call: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_confirmed_action: FALSE_VALUE,
    represents_review_queue_entry: FALSE_VALUE,
  };
}

function containsUnsafeSourceOutput(value: string): boolean {
  return UNSAFE_OUTPUT_MARKERS.some(marker => marker.test(value));
}

function blocked(reason: LiveSandboxToSuggestOnlyBridgeBlockedReason): BridgeValidation {
  return { ok: false, blocked_reason: reason, source_metadata: null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const PERMISSION_FLAG_BLOCKERS: readonly [
  keyof LiveSandboxToSuggestOnlyBridgeRequest,
  LiveSandboxToSuggestOnlyBridgeBlockedReason,
][] = [
  ['allow_network', 'illegal_network_allowed'],
  ['allow_model_call', 'illegal_model_call_allowed'],
  ['allow_env_read', 'illegal_env_read_allowed'],
  ['allow_db', 'illegal_db_allowed'],
  ['allow_runner', 'illegal_runner_allowed'],
  ['allow_execution', 'illegal_execution_allowed'],
  ['allow_review_queue_entry', 'illegal_review_queue_entry_allowed'],
  ['allow_confirmed_action', 'illegal_confirmed_action_allowed'],
  ['allow_human_confirmation', 'illegal_human_confirmation_allowed'],
  ['allow_write_plan_entry', 'illegal_write_plan_entry_allowed'],
];

const UNSAFE_OUTPUT_MARKERS = [
  /Authorization/i,
  /Bearer/i,
  /API_KEY/i,
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /unredacted provider/i,
  /raw provider/i,
];
