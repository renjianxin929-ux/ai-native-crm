import {
  envelopeFromSuggestOnlyAnswer,
  type ConfirmedActionEnvelope,
} from './confirmedActionContractReadiness';
import type {
  SuggestOnlyLiveDryRunResult,
} from './suggestOnlyLiveDryRunReadiness';

export const CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type ConfirmedActionLiveDryRunBlockedReason =
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_dry_run_blocked'
  | 'suggest_only_answer_missing'
  | 'illegal_source_generated_envelopes'
  | 'illegal_source_executed_action'
  | 'illegal_source_not_loaded_snapshot'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'source_live_dry_run_result_missing'
  | 'nested_source_live_dry_run_blocked'
  | 'illegal_source_action_state';

export interface ConfirmedActionLiveDryRunRequest {
  kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_REQUEST';
  version?: typeof CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION;
  request_id: string;
  source_live_dry_run_result: SuggestOnlyLiveDryRunResult;
}

export interface NormalizedConfirmedActionLiveDryRunRequest extends ConfirmedActionLiveDryRunRequest {
  version: typeof CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION;
}

export interface ConfirmedActionLiveDryRunSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executable: BoolFalse;
}

export interface ConfirmedActionLiveDryRunPlan {
  kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_PLAN';
  version: typeof CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'confirmed_action_live_dry_run_readiness_only';
  request: NormalizedConfirmedActionLiveDryRunRequest;
  allowed_operations: readonly ['validate_source_live_dry_run_result', 'emit_dry_run_envelopes'];
  forbidden_operations: readonly string[];
  safety: ConfirmedActionLiveDryRunSafety;
}

export interface ConfirmedActionLiveDryRunAnswer {
  kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_ANSWER';
  version: typeof CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION;
  dry_run_only: BoolTrue;
  executable: BoolFalse;
  human_confirmed: BoolFalse;
  confirmation_required: BoolTrue;
  pending_human_confirmation: BoolTrue;
  represents_executed_action: BoolFalse;
  generated_confirmed_action_envelopes: boolean;
  emits_dry_run_envelopes: boolean;
  executes_generated_envelopes: BoolFalse;
  envelopes: readonly ConfirmedActionEnvelope[];
  envelopes_count: number;
  source_live_dry_run_result: SuggestOnlyLiveDryRunResult;
  source_is_loaded_snapshot: boolean;
  dry_run_blocked: boolean;
  blocked_reason: ConfirmedActionLiveDryRunBlockedReason | null;
  safety: ConfirmedActionLiveDryRunSafety;
}

export interface ConfirmedActionLiveDryRunResult {
  kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_RESULT';
  version: typeof CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION;
  plan: ConfirmedActionLiveDryRunPlan;
  answer: ConfirmedActionLiveDryRunAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ConfirmedActionLiveDryRunTrace {
  kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_TRACE';
  plan: ConfirmedActionLiveDryRunPlan;
  result: ConfirmedActionLiveDryRunResult;
  persisted: BoolFalse;
}

export interface ConfirmedActionLiveDryRunValidation {
  ok: boolean;
  blocked_reason: ConfirmedActionLiveDryRunBlockedReason | null;
}

export function validateConfirmedActionLiveDryRunInput(
  result: unknown,
): ConfirmedActionLiveDryRunValidation {
  const source = asRecord(result);
  if (source?.kind !== 'SUGGEST_ONLY_LIVE_DRY_RUN_RESULT') return blocked('invalid_source_result_kind');

  const answer = asRecord(source.answer);
  if (!answer) return blocked('source_answer_missing');
  if (answer.dry_run_blocked === true) return blocked('source_dry_run_blocked');
  if (answer.suggest_only_answer === null || answer.suggest_only_answer === undefined) {
    return blocked('suggest_only_answer_missing');
  }
  if (answer.generated_envelopes !== false) return blocked('illegal_source_generated_envelopes');
  if (answer.represents_executed_action === true) return blocked('illegal_source_executed_action');
  if (answer.source_is_loaded_snapshot !== true) return blocked('illegal_source_not_loaded_snapshot');

  const safety = asRecord(answer.safety);
  if (safety?.reads_database === true) return blocked('illegal_source_reads_database');
  if (safety?.writes_database === true) return blocked('illegal_source_writes_database');
  if (!Object.hasOwn(answer, 'source_live_dry_run_result')) return blocked('source_live_dry_run_result_missing');

  const nestedSource = asRecord(answer.source_live_dry_run_result);
  const nestedAnswer = asRecord(nestedSource?.answer);
  if (nestedAnswer?.dry_run_blocked === true) return blocked('nested_source_live_dry_run_blocked');
  if (containsActiveActionState(safety) || containsActiveActionState(answer.suggest_only_answer)) {
    return blocked('illegal_source_action_state');
  }

  return { ok: true, blocked_reason: null };
}

export function buildConfirmedActionLiveDryRunPlan(
  request: ConfirmedActionLiveDryRunRequest,
): ConfirmedActionLiveDryRunPlan {
  return {
    kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_PLAN',
    version: CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'confirmed_action_live_dry_run_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: ['validate_source_live_dry_run_result', 'emit_dry_run_envelopes'],
    forbidden_operations: [
      'read_db',
      'write_db',
      'call_external_runtime',
      'send_message',
      'change_state',
      'persist_envelope',
      'confirm_action',
    ],
    safety: buildSafety(),
  };
}

export function runConfirmedActionLiveDryRun(
  plan: ConfirmedActionLiveDryRunPlan,
): ConfirmedActionLiveDryRunResult {
  const source = plan.request.source_live_dry_run_result;
  const validation = validateConfirmedActionLiveDryRunInput(source);

  if (!validation.ok || source.answer.suggest_only_answer === null) {
    return buildResult(plan, [], validation.blocked_reason ?? 'suggest_only_answer_missing');
  }

  const envelopes = envelopeFromSuggestOnlyAnswer(source.answer.suggest_only_answer, {
    actionIdPrefix: 'CONFIRM_LIVE_',
  });

  return buildResult(plan, envelopes, null);
}

export function buildConfirmedActionLiveDryRunTrace(
  plan: ConfirmedActionLiveDryRunPlan,
): ConfirmedActionLiveDryRunTrace {
  return {
    kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_TRACE',
    plan,
    result: runConfirmedActionLiveDryRun(plan),
    persisted: FALSE_VALUE,
  };
}

function buildResult(
  plan: ConfirmedActionLiveDryRunPlan,
  envelopes: readonly ConfirmedActionEnvelope[],
  blockedReason: ConfirmedActionLiveDryRunBlockedReason | null,
): ConfirmedActionLiveDryRunResult {
  const isBlocked = blockedReason !== null;

  return {
    kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_RESULT',
    version: CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION,
    plan,
    answer: {
      kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_ANSWER',
      version: CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION,
      dry_run_only: TRUE_VALUE,
      executable: FALSE_VALUE,
      human_confirmed: FALSE_VALUE,
      confirmation_required: TRUE_VALUE,
      pending_human_confirmation: TRUE_VALUE,
      represents_executed_action: FALSE_VALUE,
      generated_confirmed_action_envelopes: !isBlocked && envelopes.length > 0,
      emits_dry_run_envelopes: !isBlocked && envelopes.length > 0,
      executes_generated_envelopes: FALSE_VALUE,
      envelopes,
      envelopes_count: envelopes.length,
      source_live_dry_run_result: plan.request.source_live_dry_run_result,
      source_is_loaded_snapshot: plan.request.source_live_dry_run_result.answer?.source_is_loaded_snapshot === true,
      dry_run_blocked: isBlocked,
      blocked_reason: blockedReason,
      safety: buildSafety(),
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: ConfirmedActionLiveDryRunRequest,
): NormalizedConfirmedActionLiveDryRunRequest {
  return {
    ...request,
    version: CONFIRMED_ACTION_LIVE_DRY_RUN_VERSION,
  };
}

function buildSafety(): ConfirmedActionLiveDryRunSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executable: FALSE_VALUE,
  };
}

function blocked(
  reason: ConfirmedActionLiveDryRunBlockedReason,
): ConfirmedActionLiveDryRunValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function containsActiveActionState(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(item => containsActiveActionState(item));

  const record = asRecord(value);
  if (!record) return false;

  for (const [key, item] of Object.entries(record)) {
    if (
      item === true
      && (
        key === 'executable'
        || key === 'human_confirmed'
        || key === 'executed'
        || key === 'represents_executed_action'
      )
    ) {
      return true;
    }
    if (containsActiveActionState(item)) return true;
  }

  return false;
}
