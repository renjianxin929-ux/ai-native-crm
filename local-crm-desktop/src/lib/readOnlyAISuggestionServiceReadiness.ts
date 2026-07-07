import type { LiveSandboxToSuggestOnlyBridgeResult } from './liveSandboxToSuggestOnlyBridgeReadiness';
import type {
  ModelSuggestOnlyCandidate,
  ModelSuggestOnlyStatus,
} from './modelSuggestOnlyOutputGateReadiness';

export const READ_ONLY_AI_SUGGESTION_SERVICE_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ReadOnlyAISuggestionServiceBlockedReason =
  | 'invalid_request_kind'
  | 'missing_source_bridge_result'
  | 'invalid_source_bridge_result_kind'
  | 'source_bridge_answer_missing'
  | 'source_bridge_blocked'
  | 'source_suggest_only_result_missing'
  | 'source_suggest_only_answer_missing'
  | 'source_suggest_only_gate_blocked'
  | 'source_suggest_only_candidates_missing'
  | 'source_suggest_only_candidates_empty'
  | 'source_candidate_executable'
  | 'source_candidate_confirmed_action'
  | 'source_candidate_human_confirmed'
  | 'source_candidate_enters_review_queue'
  | 'source_candidate_writes_database'
  | 'source_candidate_persisted'
  | 'source_candidate_trusted_for_action'
  | 'source_bridge_missing_provenance'
  | 'source_bridge_writes_database'
  | 'source_bridge_enters_review_queue'
  | 'source_bridge_trusted_for_action'
  | 'source_bridge_persisted'
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
  | 'illegal_database_write_allowed'
  | 'illegal_task_create_allowed'
  | 'illegal_followup_create_allowed'
  | 'illegal_customer_status_change_allowed'
  | 'illegal_ui_allowed'
  | 'disallowed_source_field'
  | 'source_candidate_raw_payload';

export interface ReadOnlyAISuggestionServiceRequest {
  kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_REQUEST';
  version: typeof READ_ONLY_AI_SUGGESTION_SERVICE_VERSION;
  request_id: string;
  source_bridge_result: LiveSandboxToSuggestOnlyBridgeResult;
  service_read_only: BoolTrue;
  caller_provided_only: BoolTrue;
  bridge_reference_only: BoolTrue;
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
  allow_database_write: BoolFalse;
  allow_task_create: BoolFalse;
  allow_followup_create: BoolFalse;
  allow_customer_status_change: BoolFalse;
  allow_ui: BoolFalse;
}

export interface ReadOnlyAISuggestionCard {
  kind: 'READ_ONLY_AI_SUGGESTION_CARD';
  version: typeof READ_ONLY_AI_SUGGESTION_SERVICE_VERSION;
  card_id: string;
  title: string;
  summary: string;
  suggestion_status: ModelSuggestOnlyStatus;
  requires_human_review: BoolTrue;
  source_output_id: string;
  source_candidate_id: string;
  source_kind: string;
  source_request_id: string;
  source_provider_kind: string;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
  confirmed_action: BoolFalse;
  human_confirmed: BoolFalse;
  enters_review_queue: BoolFalse;
  writes_database: BoolFalse;
  persisted: BoolFalse;
}

export interface ReadOnlyAISuggestionServiceSummary {
  kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_SUMMARY';
  version: typeof READ_ONLY_AI_SUGGESTION_SERVICE_VERSION;
  cards_built: number;
  required_human_review: BoolTrue;
  suggest_only: BoolTrue;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
}

export interface ReadOnlyAISuggestionSafetySummary {
  kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_SAFETY_SUMMARY';
  version: typeof READ_ONLY_AI_SUGGESTION_SERVICE_VERSION;
  source_bridge_checked: BoolTrue;
  source_candidates_checked: BoolTrue;
  service_read_only: BoolTrue;
  bridge_reference_only: BoolTrue;
  requires_human_review: BoolTrue;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
  writes_database: BoolFalse;
  persisted: BoolFalse;
}

export interface ReadOnlyAISuggestionTraceSummary {
  kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_TRACE_SUMMARY';
  version: typeof READ_ONLY_AI_SUGGESTION_SERVICE_VERSION;
  request_id: string;
  source_bridge_request_id: string | null;
  source_request_id: string | null;
  validation_checked: BoolTrue;
  projection_only: BoolTrue;
  persisted: BoolFalse;
}

export interface ReadOnlyAISuggestionServiceAnswer {
  kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_ANSWER';
  service_blocked: boolean;
  blocked_reason: ReadOnlyAISuggestionServiceBlockedReason | null;
  service_read_only: BoolTrue;
  bridge_reference_only: BoolTrue;
  source_bridge_request_id: string | null;
  source_kind: string | null;
  source_request_id: string | null;
  source_provider_kind: string | null;
  source_model_name: string | null;
  source_was_live_sandbox: boolean | null;
  generated_suggestion_cards: boolean;
  suggestion_cards: readonly ReadOnlyAISuggestionCard[];
  cards_count: number;
  suggest_only_summary: ReadOnlyAISuggestionServiceSummary;
  safety_summary: ReadOnlyAISuggestionSafetySummary;
  trace_summary: ReadOnlyAISuggestionTraceSummary;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
  enters_review_queue: BoolFalse;
  writes_database: BoolFalse;
  persisted: BoolFalse;
}

export interface ReadOnlyAISuggestionServiceResponse {
  kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_RESPONSE';
  version: typeof READ_ONLY_AI_SUGGESTION_SERVICE_VERSION;
  request_id: string;
  service_read_only: BoolTrue;
  caller_provided_only: BoolTrue;
  bridge_reference_only: BoolTrue;
  suggest_only: BoolTrue;
  requires_human_review: BoolTrue;
  trusted_for_action: BoolFalse;
  executable: BoolFalse;
  uses_network: BoolFalse;
  calls_real_provider: BoolFalse;
  reads_env: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  persisted: BoolFalse;
  enters_review_queue: BoolFalse;
  represents_review_queue_entry: BoolFalse;
  represents_confirmed_action: BoolFalse;
  represents_human_confirmation: BoolFalse;
  represents_executed_action: BoolFalse;
  represents_write_plan: BoolFalse;
  touches_action_runner: BoolFalse;
  touches_write_runner: BoolFalse;
  answer: ReadOnlyAISuggestionServiceAnswer;
}

interface BridgeProjectionMetadata {
  source_bridge_request_id: string | null;
  source_kind: string;
  source_request_id: string;
  source_provider_kind: string;
  source_model_name: string;
  source_was_live_sandbox: boolean;
  candidates: readonly ModelSuggestOnlyCandidate[];
}

interface ServiceValidation {
  ok: boolean;
  blocked_reason: ReadOnlyAISuggestionServiceBlockedReason | null;
  metadata: BridgeProjectionMetadata | null;
}

export function runReadOnlyAISuggestionService(
  request: ReadOnlyAISuggestionServiceRequest,
): ReadOnlyAISuggestionServiceResponse {
  const validation = validateReadOnlyAISuggestionServiceRequest(request);
  if (!validation.ok || validation.metadata === null) {
    return buildResponse(request, validation.blocked_reason, null, []);
  }

  const cards = validation.metadata.candidates.map((candidate, index) => (
    projectSuggestionCard(candidate, validation.metadata as BridgeProjectionMetadata, index)
  ));
  return buildResponse(request, null, validation.metadata, cards);
}

export function validateReadOnlyAISuggestionServiceRequest(
  request: unknown,
): ServiceValidation {
  const record = asRecord(request);
  if (record?.kind !== 'READ_ONLY_AI_SUGGESTION_SERVICE_REQUEST') {
    return blocked('invalid_request_kind');
  }

  for (const [key, reason] of PERMISSION_FLAG_BLOCKERS) {
    if (record[key] === true) return blocked(reason);
  }
  for (const field of DISALLOWED_SOURCE_FIELDS) {
    if (field in record) return blocked('disallowed_source_field');
  }

  return validateBridgeResult(record.source_bridge_result);
}

function validateBridgeResult(value: unknown): ServiceValidation {
  const bridge = asRecord(value);
  if (bridge === null) return blocked('missing_source_bridge_result');
  if (bridge.kind !== 'LIVE_SANDBOX_TO_SUGGEST_ONLY_BRIDGE_RESULT') {
    return blocked('invalid_source_bridge_result_kind');
  }

  const answer = asRecord(bridge.answer);
  if (answer === null) return blocked('source_bridge_answer_missing');
  if (answer.bridge_blocked === true) return blocked('source_bridge_blocked');
  if (answer.writes_database === true || bridge.writes_database === true) return blocked('source_bridge_writes_database');
  if (answer.enters_review_queue === true || bridge.enters_review_queue === true) {
    return blocked('source_bridge_enters_review_queue');
  }
  if (answer.trusted_for_action === true || bridge.trusted_for_action === true) {
    return blocked('source_bridge_trusted_for_action');
  }
  if (answer.persisted === true || bridge.persisted === true) return blocked('source_bridge_persisted');

  const sourceKind = readRequiredString(answer.source_kind);
  const sourceRequestId = readRequiredString(answer.source_request_id);
  const sourceProviderKind = readRequiredString(answer.source_provider_kind);
  const sourceModelName = readRequiredString(answer.source_model_name);
  if (
    sourceKind === null
    || sourceRequestId === null
    || sourceProviderKind === null
    || sourceModelName === null
  ) {
    return blocked('source_bridge_missing_provenance');
  }

  const suggestOnlyResult = asRecord(answer.suggest_only_result);
  if (suggestOnlyResult === null) return blocked('source_suggest_only_result_missing');
  const suggestOnlyAnswer = asRecord(suggestOnlyResult.answer);
  if (suggestOnlyAnswer === null) return blocked('source_suggest_only_answer_missing');
  if (suggestOnlyAnswer.suggestion_gate_blocked === true) return blocked('source_suggest_only_gate_blocked');
  if (!Array.isArray(suggestOnlyAnswer.suggestion_candidates)) {
    return blocked('source_suggest_only_candidates_missing');
  }
  if (suggestOnlyAnswer.suggestion_candidates.length === 0) {
    return blocked('source_suggest_only_candidates_empty');
  }

  for (const candidate of suggestOnlyAnswer.suggestion_candidates) {
    const validation = validateCandidate(candidate);
    if (!validation.ok) return validation;
  }

  const bridgePlan = asRecord(bridge.plan);
  const bridgeRequest = asRecord(bridgePlan?.request);
  const sourceBridgeRequestId = typeof bridgeRequest?.request_id === 'string'
    ? bridgeRequest.request_id
    : null;

  return {
    ok: true,
    blocked_reason: null,
    metadata: {
      source_bridge_request_id: sourceBridgeRequestId,
      source_kind: sourceKind,
      source_request_id: sourceRequestId,
      source_provider_kind: sourceProviderKind,
      source_model_name: sourceModelName,
      source_was_live_sandbox: answer.source_was_live_sandbox === true,
      candidates: suggestOnlyAnswer.suggestion_candidates as readonly ModelSuggestOnlyCandidate[],
    },
  };
}

function validateCandidate(candidate: unknown): ServiceValidation {
  const record = asRecord(candidate);
  if (record === null) return blocked('source_suggest_only_candidates_missing');
  for (const field of DISALLOWED_CARD_PAYLOAD_FIELDS) {
    if (field in record) return blocked('source_candidate_raw_payload');
  }
  if (record.executable === true) return blocked('source_candidate_executable');
  if (record.confirmed_action === true) return blocked('source_candidate_confirmed_action');
  if (record.human_confirmed === true) return blocked('source_candidate_human_confirmed');
  if (record.enters_review_queue === true) return blocked('source_candidate_enters_review_queue');
  if (record.writes_database === true) return blocked('source_candidate_writes_database');
  if (record.persisted === true) return blocked('source_candidate_persisted');
  if (record.trusted_for_action === true) return blocked('source_candidate_trusted_for_action');
  return { ok: true, blocked_reason: null, metadata: null };
}

function projectSuggestionCard(
  candidate: ModelSuggestOnlyCandidate,
  metadata: BridgeProjectionMetadata,
  index: number,
): ReadOnlyAISuggestionCard {
  return {
    kind: 'READ_ONLY_AI_SUGGESTION_CARD',
    version: READ_ONLY_AI_SUGGESTION_SERVICE_VERSION,
    card_id: `READ_ONLY_AI_SUGGESTION_CARD_${String(index + 1).padStart(3, '0')}`,
    title: candidate.title,
    summary: candidate.summary,
    suggestion_status: candidate.suggestion_status,
    requires_human_review: TRUE_VALUE,
    source_output_id: candidate.source_output_id,
    source_candidate_id: candidate.suggestion_candidate_id,
    source_kind: metadata.source_kind,
    source_request_id: metadata.source_request_id,
    source_provider_kind: metadata.source_provider_kind,
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
    confirmed_action: FALSE_VALUE,
    human_confirmed: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function buildResponse(
  request: ReadOnlyAISuggestionServiceRequest,
  blockedReason: ReadOnlyAISuggestionServiceBlockedReason | null,
  metadata: BridgeProjectionMetadata | null,
  cards: readonly ReadOnlyAISuggestionCard[],
): ReadOnlyAISuggestionServiceResponse {
  const serviceBlocked = blockedReason !== null;
  const visibleCards = serviceBlocked ? [] : cards;
  return {
    kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_RESPONSE',
    version: READ_ONLY_AI_SUGGESTION_SERVICE_VERSION,
    request_id: request.request_id,
    service_read_only: TRUE_VALUE,
    caller_provided_only: TRUE_VALUE,
    bridge_reference_only: TRUE_VALUE,
    suggest_only: TRUE_VALUE,
    requires_human_review: TRUE_VALUE,
    ...inactiveResponseFlags(),
    answer: {
      kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_ANSWER',
      service_blocked: serviceBlocked,
      blocked_reason: blockedReason,
      service_read_only: TRUE_VALUE,
      bridge_reference_only: TRUE_VALUE,
      source_bridge_request_id: metadata?.source_bridge_request_id ?? null,
      source_kind: metadata?.source_kind ?? null,
      source_request_id: metadata?.source_request_id ?? null,
      source_provider_kind: metadata?.source_provider_kind ?? null,
      source_model_name: metadata?.source_model_name ?? null,
      source_was_live_sandbox: metadata?.source_was_live_sandbox ?? null,
      generated_suggestion_cards: !serviceBlocked && visibleCards.length > 0,
      suggestion_cards: visibleCards,
      cards_count: visibleCards.length,
      suggest_only_summary: buildServiceSummary(visibleCards.length),
      safety_summary: buildSafetySummary(),
      trace_summary: buildTraceSummary(request.request_id, metadata),
      trusted_for_action: FALSE_VALUE,
      executable: FALSE_VALUE,
      enters_review_queue: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      persisted: FALSE_VALUE,
    },
  };
}

function inactiveResponseFlags(): Omit<
  ReadOnlyAISuggestionServiceResponse,
  | 'kind'
  | 'version'
  | 'request_id'
  | 'service_read_only'
  | 'caller_provided_only'
  | 'bridge_reference_only'
  | 'suggest_only'
  | 'requires_human_review'
  | 'answer'
> {
  return {
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
    uses_network: FALSE_VALUE,
    calls_real_provider: FALSE_VALUE,
    reads_env: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    persisted: FALSE_VALUE,
    enters_review_queue: FALSE_VALUE,
    represents_review_queue_entry: FALSE_VALUE,
    represents_confirmed_action: FALSE_VALUE,
    represents_human_confirmation: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_write_plan: FALSE_VALUE,
    touches_action_runner: FALSE_VALUE,
    touches_write_runner: FALSE_VALUE,
  };
}

function buildServiceSummary(cardsBuilt: number): ReadOnlyAISuggestionServiceSummary {
  return {
    kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_SUMMARY',
    version: READ_ONLY_AI_SUGGESTION_SERVICE_VERSION,
    cards_built: cardsBuilt,
    required_human_review: TRUE_VALUE,
    suggest_only: TRUE_VALUE,
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
  };
}

function buildSafetySummary(): ReadOnlyAISuggestionSafetySummary {
  return {
    kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_SAFETY_SUMMARY',
    version: READ_ONLY_AI_SUGGESTION_SERVICE_VERSION,
    source_bridge_checked: TRUE_VALUE,
    source_candidates_checked: TRUE_VALUE,
    service_read_only: TRUE_VALUE,
    bridge_reference_only: TRUE_VALUE,
    requires_human_review: TRUE_VALUE,
    trusted_for_action: FALSE_VALUE,
    executable: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function buildTraceSummary(
  requestId: string,
  metadata: BridgeProjectionMetadata | null,
): ReadOnlyAISuggestionTraceSummary {
  return {
    kind: 'READ_ONLY_AI_SUGGESTION_SERVICE_TRACE_SUMMARY',
    version: READ_ONLY_AI_SUGGESTION_SERVICE_VERSION,
    request_id: requestId,
    source_bridge_request_id: metadata?.source_bridge_request_id ?? null,
    source_request_id: metadata?.source_request_id ?? null,
    validation_checked: TRUE_VALUE,
    projection_only: TRUE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function blocked(reason: ReadOnlyAISuggestionServiceBlockedReason): ServiceValidation {
  return { ok: false, blocked_reason: reason, metadata: null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

const PERMISSION_FLAG_BLOCKERS: readonly [
  keyof ReadOnlyAISuggestionServiceRequest,
  ReadOnlyAISuggestionServiceBlockedReason,
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
  ['allow_database_write', 'illegal_database_write_allowed'],
  ['allow_task_create', 'illegal_task_create_allowed'],
  ['allow_followup_create', 'illegal_followup_create_allowed'],
  ['allow_customer_status_change', 'illegal_customer_status_change_allowed'],
  ['allow_ui', 'illegal_ui_allowed'],
];

const DISALLOWED_SOURCE_FIELDS = [
  'source_manual_smoke_result',
  'source_sandbox_call_result',
  'bridge_request',
  'provider_request',
  'model_request',
  'crm_record_id',
  'db_query',
  'review_queue_request',
  'confirmed_action_request',
  'write_plan_request',
];

const DISALLOWED_CARD_PAYLOAD_FIELDS = [
  'output_text',
  'output_text_redacted',
  'raw_output',
  'provider_output',
  'model_output',
  'action_payload',
  'write_payload',
  'review_payload',
  'confirmed_action_payload',
  'db_payload',
  'task_payload',
  'followup_payload',
  'customer_status_payload',
];
