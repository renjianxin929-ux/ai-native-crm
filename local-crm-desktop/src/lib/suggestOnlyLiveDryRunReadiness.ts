import type {
  ReadOnlyAgentAnswer,
  ReadOnlyAgentIntent,
} from './readOnlyAgentReadiness';
import type {
  ReadOnlyAgentLiveDryRunAnswer,
  ReadOnlyAgentLiveDryRunResult,
} from './readOnlyAgentLiveDryRunReadiness';
import {
  proposeFromReadOnlyAnswer,
  SUGGEST_ONLY_AGENT_VERSION,
  type SuggestOnlyAgentAnswer,
  type SuggestOnlyAgentProposal,
} from './suggestOnlyAgentReadiness';

export const SUGGEST_ONLY_LIVE_DRY_RUN_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type SuggestOnlyLiveDryRunBlockedReason =
  | 'read_only_dry_run_blocked'
  | 'read_only_answer_missing'
  | 'illegal_source_generated_proposals'
  | 'illegal_source_generated_envelopes'
  | 'illegal_source_executed_action'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'illegal_source_not_loaded_snapshot'
  | 'adapter_adaptation_blocked'
  | 'adapter_pii_check_failed';

export interface SuggestOnlyLiveDryRunRequest {
  kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_REQUEST';
  version?: typeof SUGGEST_ONLY_LIVE_DRY_RUN_VERSION;
  request_id: string;
  source_live_dry_run_result: ReadOnlyAgentLiveDryRunResult;
}

export interface NormalizedSuggestOnlyLiveDryRunRequest extends SuggestOnlyLiveDryRunRequest {
  version: typeof SUGGEST_ONLY_LIVE_DRY_RUN_VERSION;
}

export interface SuggestOnlyLiveDryRunSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  no_side_effects: BoolTrue;
  no_provider_calls: BoolTrue;
  no_network: BoolTrue;
  executable: BoolFalse;
  persisted: BoolFalse;
  dry_run_only: BoolTrue;
  represents_executed_action: BoolFalse;
  represents_confirmed_action_agent: BoolFalse;
  generated_envelopes: BoolFalse;
  invokes_suggest_only_agent: boolean;
  generated_proposals: boolean;
}

export interface SuggestOnlyLiveDryRunPlan {
  kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_PLAN';
  version: typeof SUGGEST_ONLY_LIVE_DRY_RUN_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'suggest_only_live_dry_run_readiness_only';
  request: NormalizedSuggestOnlyLiveDryRunRequest;
  allowed_operations: readonly ['validate_live_dry_run_input', 'emit_review_proposals'];
  forbidden_operations: readonly string[];
  safety: SuggestOnlyLiveDryRunSafety;
}

export interface ReadOnlyAnswerMetadata {
  intent: ReadOnlyAgentIntent;
  version: ReadOnlyAgentAnswer['version'];
  findings_count: number;
}

export interface SuggestOnlyLiveDryRunAnswer {
  kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_ANSWER';
  version: typeof SUGGEST_ONLY_LIVE_DRY_RUN_VERSION;
  dry_run_only: BoolTrue;
  source_live_dry_run_result: ReadOnlyAgentLiveDryRunResult;
  source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT';
  source_snapshot_id: string;
  source_is_loaded_snapshot: BoolTrue;
  load_source: 'sqlite_read_only';
  read_only_answer_metadata: ReadOnlyAnswerMetadata | null;
  suggest_only_answer: SuggestOnlyAgentAnswer | null;
  proposals_count: number;
  dry_run_blocked: boolean;
  blocked_reason: SuggestOnlyLiveDryRunBlockedReason | null;
  invokes_suggest_only_agent: boolean;
  generated_proposals: boolean;
  generated_envelopes: BoolFalse;
  safety: SuggestOnlyLiveDryRunSafety;
  represents_executed_action: BoolFalse;
}

export interface SuggestOnlyLiveDryRunResult {
  kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_RESULT';
  version: typeof SUGGEST_ONLY_LIVE_DRY_RUN_VERSION;
  plan: SuggestOnlyLiveDryRunPlan;
  answer: SuggestOnlyLiveDryRunAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface SuggestOnlyLiveDryRunTrace {
  kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_TRACE';
  plan: SuggestOnlyLiveDryRunPlan;
  result: SuggestOnlyLiveDryRunResult;
  persisted: BoolFalse;
}

export interface SuggestOnlyLiveDryRunValidation {
  ok: boolean;
  blocked_reason: SuggestOnlyLiveDryRunBlockedReason | null;
}

export function validateLiveDryRunInput(
  result: ReadOnlyAgentLiveDryRunResult,
): SuggestOnlyLiveDryRunValidation {
  const answer = result.answer;
  if (result.kind !== 'READ_ONLY_AGENT_LIVE_DRY_RUN_RESULT') return blocked('read_only_dry_run_blocked');
  if (answer.dry_run_blocked) return blocked('read_only_dry_run_blocked');
  if (answer.read_only_answer === null) return blocked('read_only_answer_missing');
  if (answer.generated_proposals) return blocked('illegal_source_generated_proposals');
  if (answer.generated_envelopes) return blocked('illegal_source_generated_envelopes');
  if (answer.represents_executed_action) return blocked('illegal_source_executed_action');
  if (answer.safety.reads_database) return blocked('illegal_source_reads_database');
  if (answer.safety.writes_database) return blocked('illegal_source_writes_database');
  if (!answer.source_is_loaded_snapshot) return blocked('illegal_source_not_loaded_snapshot');
  if (answer.adapter_result.adaptation_blocked) return blocked('adapter_adaptation_blocked');
  if (!answer.adapter_result.pii_check.passed) return blocked('adapter_pii_check_failed');

  return { ok: true, blocked_reason: null };
}

export function buildSuggestOnlyLiveDryRunPlan(
  request: SuggestOnlyLiveDryRunRequest,
): SuggestOnlyLiveDryRunPlan {
  return {
    kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_PLAN',
    version: SUGGEST_ONLY_LIVE_DRY_RUN_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'suggest_only_live_dry_run_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: ['validate_live_dry_run_input', 'emit_review_proposals'],
    forbidden_operations: [
      'read_db',
      'write_db',
      'rerun_read_only_agent',
      'load_snapshot',
      'generate_envelopes',
      'execute_proposal',
      'call_provider',
      'persist_proposal',
    ],
    safety: buildSafety(FALSE_VALUE, FALSE_VALUE),
  };
}

export function runSuggestOnlyLiveDryRun(
  plan: SuggestOnlyLiveDryRunPlan,
): SuggestOnlyLiveDryRunResult {
  const source = plan.request.source_live_dry_run_result;
  const validation = validateLiveDryRunInput(source);
  const sourceAnswer = source.answer;
  const readOnlyAnswer = sourceAnswer.read_only_answer;

  if (!validation.ok || readOnlyAnswer === null) {
    return buildResult(plan, sourceAnswer, null, validation.blocked_reason ?? 'read_only_answer_missing');
  }

  const proposals = rewriteProposalIds(proposeFromReadOnlyAnswer(readOnlyAnswer));
  const suggestOnlyAnswer: SuggestOnlyAgentAnswer = {
    kind: 'SUGGEST_ONLY_AGENT_ANSWER',
    version: SUGGEST_ONLY_AGENT_VERSION,
    suggest_only_summary: `Suggest-only live dry-run prepared ${proposals.length} review proposal(s); confirmation is required before any separate action path.`,
    proposals,
    safety: {
      writes_database: FALSE_VALUE,
      no_side_effects: TRUE_VALUE,
      no_provider_calls: TRUE_VALUE,
      no_network: TRUE_VALUE,
      requires_confirmation_for_all_proposals: TRUE_VALUE,
      represents_true_agent: FALSE_VALUE,
      represents_confirmed_action_agent: FALSE_VALUE,
      represents_executed_action: FALSE_VALUE,
      forbidden_proposal_phrases: [],
    },
    represents_executed_action: FALSE_VALUE,
  };

  return buildResult(plan, sourceAnswer, suggestOnlyAnswer, null);
}

export function buildSuggestOnlyLiveDryRunTrace(
  plan: SuggestOnlyLiveDryRunPlan,
): SuggestOnlyLiveDryRunTrace {
  return {
    kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_TRACE',
    plan,
    result: runSuggestOnlyLiveDryRun(plan),
    persisted: FALSE_VALUE,
  };
}

function buildResult(
  plan: SuggestOnlyLiveDryRunPlan,
  sourceAnswer: ReadOnlyAgentLiveDryRunAnswer,
  suggestOnlyAnswer: SuggestOnlyAgentAnswer | null,
  blockedReason: SuggestOnlyLiveDryRunBlockedReason | null,
): SuggestOnlyLiveDryRunResult {
  const proposalsCount = suggestOnlyAnswer?.proposals.length ?? 0;
  const invokesSuggestOnlyAgent = suggestOnlyAnswer !== null;
  const generatedProposals = proposalsCount > 0;
  const safety = buildSafety(invokesSuggestOnlyAgent, generatedProposals);

  return {
    kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_RESULT',
    version: SUGGEST_ONLY_LIVE_DRY_RUN_VERSION,
    plan,
    answer: {
      kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_ANSWER',
      version: SUGGEST_ONLY_LIVE_DRY_RUN_VERSION,
      dry_run_only: TRUE_VALUE,
      source_live_dry_run_result: plan.request.source_live_dry_run_result,
      source_snapshot_kind: sourceAnswer.source_snapshot_kind,
      source_snapshot_id: sourceAnswer.source_snapshot_id,
      source_is_loaded_snapshot: sourceAnswer.source_is_loaded_snapshot,
      load_source: sourceAnswer.load_source,
      read_only_answer_metadata: metadataFor(sourceAnswer.read_only_answer),
      suggest_only_answer: suggestOnlyAnswer,
      proposals_count: proposalsCount,
      dry_run_blocked: blockedReason !== null,
      blocked_reason: blockedReason,
      invokes_suggest_only_agent: invokesSuggestOnlyAgent,
      generated_proposals: generatedProposals,
      generated_envelopes: FALSE_VALUE,
      safety,
      represents_executed_action: FALSE_VALUE,
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function rewriteProposalIds(
  proposals: readonly SuggestOnlyAgentProposal[],
): SuggestOnlyAgentProposal[] {
  return proposals.map((proposal, index) => ({
    ...proposal,
    proposal_id: `SUGGEST_LIVE_${String(index + 1).padStart(3, '0')}`,
  }));
}

function metadataFor(answer: ReadOnlyAgentAnswer | null): ReadOnlyAnswerMetadata | null {
  if (answer === null) return null;

  return {
    intent: answer.intent,
    version: answer.version,
    findings_count: answer.findings.length,
  };
}

function normalizeRequest(
  request: SuggestOnlyLiveDryRunRequest,
): NormalizedSuggestOnlyLiveDryRunRequest {
  return {
    ...request,
    version: SUGGEST_ONLY_LIVE_DRY_RUN_VERSION,
  };
}

function buildSafety(
  invokesSuggestOnlyAgent: boolean,
  generatedProposals: boolean,
): SuggestOnlyLiveDryRunSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    no_side_effects: TRUE_VALUE,
    no_provider_calls: TRUE_VALUE,
    no_network: TRUE_VALUE,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    dry_run_only: TRUE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_confirmed_action_agent: FALSE_VALUE,
    generated_envelopes: FALSE_VALUE,
    invokes_suggest_only_agent: invokesSuggestOnlyAgent,
    generated_proposals: generatedProposals,
  };
}

function blocked(reason: SuggestOnlyLiveDryRunBlockedReason): SuggestOnlyLiveDryRunValidation {
  return { ok: false, blocked_reason: reason };
}
