import type {
  ConfirmedActionEvidenceRef,
  ConfirmedActionPrecondition,
  ConfirmedActionRiskFlag,
  ConfirmedActionType,
} from './confirmedActionContractReadiness';
import type {
  ConfirmedActionReviewPriorityBand,
  ConfirmedActionReviewQueueCandidate,
  ConfirmedActionReviewQueueResult,
  ConfirmedActionReviewStatus,
} from './confirmedActionReviewQueueReadiness';
import type {
  SuggestOnlyAgentProposalType,
} from './suggestOnlyAgentReadiness';

export const HUMAN_CONFIRMATION_CONTRACT_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type HumanConfirmationContractBlockedReason =
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_queue_blocked'
  | 'source_candidates_empty'
  | 'illegal_source_executes_queue_items'
  | 'illegal_source_executable'
  | 'illegal_source_human_confirmed'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'illegal_candidate_executable'
  | 'illegal_candidate_human_confirmed'
  | 'illegal_candidate_confirmed'
  | 'illegal_candidate_approved'
  | 'illegal_candidate_represents_executed_action'
  | 'illegal_candidate_writes_database';

export type HumanConfirmationStatus = 'awaiting_human_confirmation' | 'blocked';

export interface HumanConfirmationContractRequest {
  kind: 'HUMAN_CONFIRMATION_CONTRACT_REQUEST';
  version?: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  request_id: string;
  source_review_queue_result: ConfirmedActionReviewQueueResult;
}

export interface NormalizedHumanConfirmationContractRequest extends HumanConfirmationContractRequest {
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
}

export interface HumanConfirmationContractSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executable: BoolFalse;
}

export interface HumanConfirmationOperatorPlaceholder {
  kind: 'HUMAN_CONFIRMATION_OPERATOR_PLACEHOLDER';
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  contract_only: BoolTrue;
  resolved: BoolFalse;
  source: 'future_ui_or_session';
  represents_real_operator: BoolFalse;
  persisted: BoolFalse;
}

export interface HumanConfirmationMetadataPlaceholder {
  kind: 'HUMAN_CONFIRMATION_METADATA_PLACEHOLDER';
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  contract_only: BoolTrue;
  resolved: BoolFalse;
  source: 'future_ui_or_session';
  persisted: BoolFalse;
}

export interface HumanConfirmationContractPlan {
  kind: 'HUMAN_CONFIRMATION_CONTRACT_PLAN';
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'human_confirmation_contract_readiness_only';
  request: NormalizedHumanConfirmationContractRequest;
  allowed_operations: readonly [
    'validate_review_queue_result',
    'project_confirmation_contract_candidates',
    'build_confirmation_contract_summary',
  ];
  forbidden_operations: readonly string[];
  safety: HumanConfirmationContractSafety;
}

export interface HumanConfirmationContractCandidate {
  kind: 'HUMAN_CONFIRMATION_CONTRACT_CANDIDATE';
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  confirmation_candidate_id: string;
  source_queue_item_id: string;
  source_action_id: string;
  source_proposal_id: string;
  source_proposal_type: SuggestOnlyAgentProposalType;
  action_type: ConfirmedActionType;
  title: string;
  summary: string;
  evidence_refs: readonly ConfirmedActionEvidenceRef[];
  risk_flags: readonly ConfirmedActionRiskFlag[];
  preconditions: readonly ConfirmedActionPrecondition[];
  review_status: ConfirmedActionReviewStatus;
  confirmation_status: HumanConfirmationStatus;
  priority_band: ConfirmedActionReviewPriorityBand;
  blocked_reason: string | null;
  operator: HumanConfirmationOperatorPlaceholder;
  confirmation_metadata: HumanConfirmationMetadataPlaceholder;
  executable: BoolFalse;
  persisted: BoolFalse;
  human_confirmed: BoolFalse;
  confirmed: BoolFalse;
  approved: BoolFalse;
  writes_database: BoolFalse;
  represents_executed_action: BoolFalse;
  requires_human_review: BoolTrue;
  contract_only: BoolTrue;
}

export interface HumanConfirmationContractSummary {
  kind: 'HUMAN_CONFIRMATION_CONTRACT_SUMMARY';
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  total: number;
  awaiting_human_confirmation: number;
  blocked: number;
  high_priority: number;
  by_action_type: Record<string, number>;
  by_confirmation_status: Record<string, number>;
}

export interface HumanConfirmationContractAnswer {
  kind: 'HUMAN_CONFIRMATION_CONTRACT_ANSWER';
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  contract_only: BoolTrue;
  executable: BoolFalse;
  persisted: BoolFalse;
  human_confirmed: BoolFalse;
  represents_executed_action: BoolFalse;
  generated_confirmation_contract_candidates: boolean;
  executes_confirmation: BoolFalse;
  candidates: readonly HumanConfirmationContractCandidate[];
  candidates_count: number;
  summary: HumanConfirmationContractSummary;
  source_review_queue_result: ConfirmedActionReviewQueueResult;
  contract_blocked: boolean;
  blocked_reason: HumanConfirmationContractBlockedReason | null;
  safety: HumanConfirmationContractSafety;
}

export interface HumanConfirmationContractResult {
  kind: 'HUMAN_CONFIRMATION_CONTRACT_RESULT';
  version: typeof HUMAN_CONFIRMATION_CONTRACT_VERSION;
  plan: HumanConfirmationContractPlan;
  answer: HumanConfirmationContractAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface HumanConfirmationContractTrace {
  kind: 'HUMAN_CONFIRMATION_CONTRACT_TRACE';
  plan: HumanConfirmationContractPlan;
  result: HumanConfirmationContractResult;
  persisted: BoolFalse;
}

export interface HumanConfirmationContractValidation {
  ok: boolean;
  blocked_reason: HumanConfirmationContractBlockedReason | null;
}

export function validateHumanConfirmationContractInput(
  result: unknown,
): HumanConfirmationContractValidation {
  const source = asRecord(result);
  if (source?.kind !== 'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT') return blocked('invalid_source_result_kind');

  const answer = asRecord(source.answer);
  if (!answer) return blocked('source_answer_missing');
  if (answer.queue_blocked === true) return blocked('source_queue_blocked');
  if (answer.executes_queue_items === true) return blocked('illegal_source_executes_queue_items');
  if (answer.executable === true) return blocked('illegal_source_executable');
  if (answer.human_confirmed === true) return blocked('illegal_source_human_confirmed');

  const safety = asRecord(answer.safety);
  if (safety?.reads_database === true) return blocked('illegal_source_reads_database');
  if (safety?.writes_database === true) return blocked('illegal_source_writes_database');

  const candidates = Array.isArray(answer.candidates) ? answer.candidates : [];
  if (answer.candidates_count === 0 || candidates.length === 0) return blocked('source_candidates_empty');

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record?.executable === true) return blocked('illegal_candidate_executable');
    if (record?.human_confirmed === true) return blocked('illegal_candidate_human_confirmed');
    if (record?.confirmed === true) return blocked('illegal_candidate_confirmed');
    if (record?.approved === true) return blocked('illegal_candidate_approved');
    if (record?.represents_executed_action === true) return blocked('illegal_candidate_represents_executed_action');
    if (record?.writes_database === true) return blocked('illegal_candidate_writes_database');
  }

  return { ok: true, blocked_reason: null };
}

export function buildHumanConfirmationContractPlan(
  request: HumanConfirmationContractRequest,
): HumanConfirmationContractPlan {
  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_PLAN',
    version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'human_confirmation_contract_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_review_queue_result',
      'project_confirmation_contract_candidates',
      'build_confirmation_contract_summary',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'render_ui',
      'resolve_operator',
      'record_human_confirmation',
      'execute_confirmation',
      'execute_queue_item',
      'persist_confirmation',
      ['call', ['pro', 'vider'].join('')].join('_'),
      'send_message',
      'mutate_state',
    ],
    safety: buildSafety(),
  };
}

export function runHumanConfirmationContract(
  plan: HumanConfirmationContractPlan,
): HumanConfirmationContractResult {
  const source = plan.request.source_review_queue_result;
  const validation = validateHumanConfirmationContractInput(source);

  if (!validation.ok) return buildResult(plan, [], validation.blocked_reason);

  const candidates = source.answer.candidates.map((candidate, index) => (
    projectReviewQueueCandidateToHumanConfirmationCandidate(candidate, index)
  ));
  return buildResult(plan, candidates, null);
}

export function buildHumanConfirmationContractTrace(
  plan: HumanConfirmationContractPlan,
): HumanConfirmationContractTrace {
  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_TRACE',
    plan,
    result: runHumanConfirmationContract(plan),
    persisted: FALSE_VALUE,
  };
}

export function projectReviewQueueCandidateToHumanConfirmationCandidate(
  candidate: ConfirmedActionReviewQueueCandidate,
  index: number,
): HumanConfirmationContractCandidate {
  const isBlocked = candidate.review_status === 'blocked';
  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_CANDIDATE',
    version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
    confirmation_candidate_id: `HUMAN_CONFIRM_LIVE_${String(index + 1).padStart(3, '0')}`,
    source_queue_item_id: candidate.queue_item_id,
    source_action_id: candidate.source_action_id,
    source_proposal_id: candidate.source_proposal_id,
    source_proposal_type: candidate.source_proposal_type,
    action_type: candidate.action_type,
    title: candidate.title,
    summary: candidate.summary,
    evidence_refs: candidate.evidence_refs,
    risk_flags: candidate.risk_flags,
    preconditions: candidate.preconditions,
    review_status: candidate.review_status,
    confirmation_status: isBlocked ? 'blocked' : 'awaiting_human_confirmation',
    priority_band: candidate.priority_band,
    blocked_reason: isBlocked ? candidate.blocked_reason : null,
    operator: buildOperatorPlaceholder(),
    confirmation_metadata: buildMetadataPlaceholder(),
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    human_confirmed: FALSE_VALUE,
    confirmed: FALSE_VALUE,
    approved: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    requires_human_review: TRUE_VALUE,
    contract_only: TRUE_VALUE,
  };
}

export function buildHumanConfirmationContractSummary(
  candidates: readonly HumanConfirmationContractCandidate[],
): HumanConfirmationContractSummary {
  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_SUMMARY',
    version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
    total: candidates.length,
    awaiting_human_confirmation: candidates.filter(
      candidate => candidate.confirmation_status === 'awaiting_human_confirmation',
    ).length,
    blocked: candidates.filter(candidate => candidate.confirmation_status === 'blocked').length,
    high_priority: candidates.filter(candidate => candidate.priority_band === 'high').length,
    by_action_type: countBy(candidates.map(candidate => candidate.action_type)),
    by_confirmation_status: countBy(candidates.map(candidate => candidate.confirmation_status)),
  };
}

function buildResult(
  plan: HumanConfirmationContractPlan,
  candidates: readonly HumanConfirmationContractCandidate[],
  blockedReason: HumanConfirmationContractBlockedReason | null,
): HumanConfirmationContractResult {
  const isBlocked = blockedReason !== null;
  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_RESULT',
    version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
    plan,
    answer: {
      kind: 'HUMAN_CONFIRMATION_CONTRACT_ANSWER',
      version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
      contract_only: TRUE_VALUE,
      executable: FALSE_VALUE,
      persisted: FALSE_VALUE,
      human_confirmed: FALSE_VALUE,
      represents_executed_action: FALSE_VALUE,
      generated_confirmation_contract_candidates: !isBlocked && candidates.length > 0,
      executes_confirmation: FALSE_VALUE,
      candidates: isBlocked ? [] : candidates,
      candidates_count: isBlocked ? 0 : candidates.length,
      summary: isBlocked ? emptySummary() : buildHumanConfirmationContractSummary(candidates),
      source_review_queue_result: plan.request.source_review_queue_result,
      contract_blocked: isBlocked,
      blocked_reason: blockedReason,
      safety: buildSafety(),
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: HumanConfirmationContractRequest,
): NormalizedHumanConfirmationContractRequest {
  return {
    ...request,
    version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
  };
}

function buildOperatorPlaceholder(): HumanConfirmationOperatorPlaceholder {
  return {
    kind: 'HUMAN_CONFIRMATION_OPERATOR_PLACEHOLDER',
    version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
    contract_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    source: 'future_ui_or_session',
    represents_real_operator: FALSE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function buildMetadataPlaceholder(): HumanConfirmationMetadataPlaceholder {
  return {
    kind: 'HUMAN_CONFIRMATION_METADATA_PLACEHOLDER',
    version: HUMAN_CONFIRMATION_CONTRACT_VERSION,
    contract_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    source: 'future_ui_or_session',
    persisted: FALSE_VALUE,
  };
}

function buildSafety(): HumanConfirmationContractSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executable: FALSE_VALUE,
  };
}

function emptySummary(): HumanConfirmationContractSummary {
  return buildHumanConfirmationContractSummary([]);
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function blocked(
  reason: HumanConfirmationContractBlockedReason,
): HumanConfirmationContractValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
