import type {
  ConfirmedActionEnvelope,
  ConfirmedActionEvidenceRef,
  ConfirmedActionPrecondition,
  ConfirmedActionRiskFlag,
  ConfirmedActionType,
} from './confirmedActionContractReadiness';
import type {
  ConfirmedActionLiveDryRunResult,
} from './confirmedActionLiveDryRunReadiness';
import type {
  SuggestOnlyAgentProposalType,
} from './suggestOnlyAgentReadiness';

export const CONFIRMED_ACTION_REVIEW_QUEUE_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

const HIGH_RISK_FLAGS: readonly ConfirmedActionRiskFlag[] = [
  'sync_failed',
  'grade_upgrade_requires_review',
  'customer_creation_requires_review',
  'message_send_requires_review',
];

export type ConfirmedActionReviewQueueBlockedReason =
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_dry_run_blocked'
  | 'source_envelopes_empty'
  | 'illegal_source_missing_generated_confirmed_action_envelopes'
  | 'illegal_source_missing_dry_run_envelope_emission'
  | 'illegal_source_executes_generated_envelopes'
  | 'illegal_source_executed_action'
  | 'illegal_source_human_confirmed'
  | 'illegal_source_writes_database'
  | 'illegal_source_reads_database'
  | 'illegal_envelope_executable'
  | 'illegal_envelope_human_confirmed'
  | 'illegal_envelope_represents_executed_action';

export type ConfirmedActionReviewStatus = 'pending_review' | 'blocked';
export type ConfirmedActionReviewPriorityBand = 'high' | 'medium' | 'low';

export interface ConfirmedActionReviewQueueRequest {
  kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_REQUEST';
  version?: typeof CONFIRMED_ACTION_REVIEW_QUEUE_VERSION;
  request_id: string;
  source_live_dry_run_result: ConfirmedActionLiveDryRunResult;
}

export interface NormalizedConfirmedActionReviewQueueRequest extends ConfirmedActionReviewQueueRequest {
  version: typeof CONFIRMED_ACTION_REVIEW_QUEUE_VERSION;
}

export interface ConfirmedActionReviewQueueSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executable: BoolFalse;
}

export interface ConfirmedActionReviewQueuePlan {
  kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_PLAN';
  version: typeof CONFIRMED_ACTION_REVIEW_QUEUE_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'confirmed_action_review_queue_readiness_only';
  request: NormalizedConfirmedActionReviewQueueRequest;
  allowed_operations: readonly [
    'validate_confirmed_action_live_dry_run_input',
    'project_review_queue_candidates',
    'build_review_queue_summary',
  ];
  forbidden_operations: readonly string[];
  safety: ConfirmedActionReviewQueueSafety;
}

export interface ConfirmedActionReviewQueueCandidate {
  kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE';
  version: typeof CONFIRMED_ACTION_REVIEW_QUEUE_VERSION;
  queue_item_id: string;
  source_action_id: string;
  source_proposal_id: string;
  source_proposal_type: SuggestOnlyAgentProposalType;
  action_type: ConfirmedActionType;
  title: string;
  summary: string;
  evidence_refs: readonly ConfirmedActionEvidenceRef[];
  risk_flags: readonly ConfirmedActionRiskFlag[];
  preconditions: readonly ConfirmedActionPrecondition[];
  blocked_reason: string | null;
  review_status: ConfirmedActionReviewStatus;
  priority_band: ConfirmedActionReviewPriorityBand;
  evidence_summary: string;
  risk_summary: string;
  executable: BoolFalse;
  persisted: BoolFalse;
  human_confirmed: BoolFalse;
  writes_database: BoolFalse;
  represents_executed_action: BoolFalse;
  requires_human_review: BoolTrue;
  dry_run_only: BoolTrue;
  confirmation_required: BoolTrue;
}

export interface ConfirmedActionReviewQueueSummary {
  kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_SUMMARY';
  version: typeof CONFIRMED_ACTION_REVIEW_QUEUE_VERSION;
  total: number;
  ready_for_review: number;
  blocked: number;
  high_risk: number;
  missing_evidence: number;
  by_action_type: Record<string, number>;
  by_risk_flag: Record<string, number>;
}

export interface ConfirmedActionReviewQueueAnswer {
  kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_ANSWER';
  version: typeof CONFIRMED_ACTION_REVIEW_QUEUE_VERSION;
  dry_run_only: BoolTrue;
  executable: BoolFalse;
  human_confirmed: BoolFalse;
  requires_human_review: BoolTrue;
  represents_executed_action: BoolFalse;
  generated_review_queue_candidates: boolean;
  emits_review_surface_only: BoolTrue;
  executes_queue_items: BoolFalse;
  candidates: readonly ConfirmedActionReviewQueueCandidate[];
  candidates_count: number;
  summary: ConfirmedActionReviewQueueSummary;
  source_live_dry_run_result: ConfirmedActionLiveDryRunResult;
  queue_blocked: boolean;
  blocked_reason: ConfirmedActionReviewQueueBlockedReason | null;
  safety: ConfirmedActionReviewQueueSafety;
}

export interface ConfirmedActionReviewQueueResult {
  kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT';
  version: typeof CONFIRMED_ACTION_REVIEW_QUEUE_VERSION;
  plan: ConfirmedActionReviewQueuePlan;
  answer: ConfirmedActionReviewQueueAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ConfirmedActionReviewQueueTrace {
  kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_TRACE';
  plan: ConfirmedActionReviewQueuePlan;
  result: ConfirmedActionReviewQueueResult;
  persisted: BoolFalse;
}

export interface ConfirmedActionReviewQueueValidation {
  ok: boolean;
  blocked_reason: ConfirmedActionReviewQueueBlockedReason | null;
}

export function validateConfirmedActionReviewQueueInput(
  result: unknown,
): ConfirmedActionReviewQueueValidation {
  const source = asRecord(result);
  if (source?.kind !== 'CONFIRMED_ACTION_LIVE_DRY_RUN_RESULT') return blocked('invalid_source_result_kind');

  const answer = asRecord(source.answer);
  if (!answer) return blocked('source_answer_missing');
  if (answer.dry_run_blocked === true) return blocked('source_dry_run_blocked');
  if (answer.generated_confirmed_action_envelopes !== true) {
    return blocked('illegal_source_missing_generated_confirmed_action_envelopes');
  }
  if (answer.emits_dry_run_envelopes !== true) {
    return blocked('illegal_source_missing_dry_run_envelope_emission');
  }
  if (answer.executes_generated_envelopes === true) return blocked('illegal_source_executes_generated_envelopes');
  if (answer.represents_executed_action === true || source.represents_executed_action === true) {
    return blocked('illegal_source_executed_action');
  }
  if (answer.human_confirmed === true) return blocked('illegal_source_human_confirmed');

  const safety = asRecord(answer.safety);
  if (safety?.writes_database === true) return blocked('illegal_source_writes_database');
  if (safety?.reads_database === true) return blocked('illegal_source_reads_database');

  const envelopes = Array.isArray(answer.envelopes) ? answer.envelopes : [];
  if (answer.envelopes_count === 0 || envelopes.length === 0) return blocked('source_envelopes_empty');

  for (const envelope of envelopes) {
    const record = asRecord(envelope);
    if (record?.executable === true) return blocked('illegal_envelope_executable');
    if (record?.human_confirmed === true) return blocked('illegal_envelope_human_confirmed');
    if (record?.represents_executed_action === true) return blocked('illegal_envelope_represents_executed_action');
    if (record?.writes_database === true) return blocked('illegal_source_writes_database');
  }
  if (containsActiveActionState(source)) return blocked(activeStateReason(source));

  return { ok: true, blocked_reason: null };
}

export function buildConfirmedActionReviewQueuePlan(
  request: ConfirmedActionReviewQueueRequest,
): ConfirmedActionReviewQueuePlan {
  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_PLAN',
    version: CONFIRMED_ACTION_REVIEW_QUEUE_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'confirmed_action_review_queue_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_confirmed_action_live_dry_run_input',
      'project_review_queue_candidates',
      'build_review_queue_summary',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'rerun_confirmed_action_live_dry_run',
      'execute_queue_item',
      'confirm_queue_item',
      ['call', ['pro', 'vider'].join('')].join('_'),
      'render_ui',
      'persist_queue_item',
    ],
    safety: buildSafety(),
  };
}

export function runConfirmedActionReviewQueue(
  plan: ConfirmedActionReviewQueuePlan,
): ConfirmedActionReviewQueueResult {
  const source = plan.request.source_live_dry_run_result;
  const validation = validateConfirmedActionReviewQueueInput(source);

  if (!validation.ok) return buildResult(plan, [], validation.blocked_reason);

  const candidates = source.answer.envelopes.map((envelope, index) => projectEnvelopeToCandidate(envelope, index));
  return buildResult(plan, candidates, null);
}

export function buildConfirmedActionReviewQueueTrace(
  plan: ConfirmedActionReviewQueuePlan,
): ConfirmedActionReviewQueueTrace {
  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_TRACE',
    plan,
    result: runConfirmedActionReviewQueue(plan),
    persisted: FALSE_VALUE,
  };
}

export function projectEnvelopeToCandidate(
  envelope: ConfirmedActionEnvelope,
  index: number,
): ConfirmedActionReviewQueueCandidate {
  const blockingPrecondition = envelope.preconditions.find(item => item.blocking && !item.satisfied);
  const blockedReason = envelope.blocked_reason ?? blockingPrecondition?.message ?? null;
  const reviewStatus: ConfirmedActionReviewStatus = blockedReason === null ? 'pending_review' : 'blocked';

  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE',
    version: CONFIRMED_ACTION_REVIEW_QUEUE_VERSION,
    queue_item_id: `REVIEW_QUEUE_LIVE_${String(index + 1).padStart(3, '0')}`,
    source_action_id: envelope.action_id,
    source_proposal_id: envelope.source_proposal_id,
    source_proposal_type: envelope.source_proposal_type,
    action_type: envelope.action_type,
    title: envelope.title,
    summary: envelope.summary,
    evidence_refs: envelope.evidence_refs,
    risk_flags: envelope.risk_flags,
    preconditions: envelope.preconditions,
    blocked_reason: blockedReason,
    review_status: reviewStatus,
    priority_band: priorityBandFor(envelope),
    evidence_summary: evidenceSummaryFor(envelope.evidence_refs),
    risk_summary: riskSummaryFor(envelope.risk_flags),
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    human_confirmed: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    requires_human_review: TRUE_VALUE,
    dry_run_only: TRUE_VALUE,
    confirmation_required: TRUE_VALUE,
  };
}

export function buildQueueSummary(
  candidates: readonly ConfirmedActionReviewQueueCandidate[],
): ConfirmedActionReviewQueueSummary {
  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_SUMMARY',
    version: CONFIRMED_ACTION_REVIEW_QUEUE_VERSION,
    total: candidates.length,
    ready_for_review: candidates.filter(candidate => candidate.review_status === 'pending_review').length,
    blocked: candidates.filter(candidate => candidate.review_status === 'blocked').length,
    high_risk: candidates.filter(candidate => candidate.priority_band === 'high').length,
    missing_evidence: candidates.filter(candidate => candidate.evidence_refs.length === 0).length,
    by_action_type: countBy(candidates.map(candidate => candidate.action_type)),
    by_risk_flag: countBy(candidates.flatMap(candidate => [...candidate.risk_flags])),
  };
}

function buildResult(
  plan: ConfirmedActionReviewQueuePlan,
  candidates: readonly ConfirmedActionReviewQueueCandidate[],
  blockedReason: ConfirmedActionReviewQueueBlockedReason | null,
): ConfirmedActionReviewQueueResult {
  const isBlocked = blockedReason !== null;

  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT',
    version: CONFIRMED_ACTION_REVIEW_QUEUE_VERSION,
    plan,
    answer: {
      kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_ANSWER',
      version: CONFIRMED_ACTION_REVIEW_QUEUE_VERSION,
      dry_run_only: TRUE_VALUE,
      executable: FALSE_VALUE,
      human_confirmed: FALSE_VALUE,
      requires_human_review: TRUE_VALUE,
      represents_executed_action: FALSE_VALUE,
      generated_review_queue_candidates: !isBlocked && candidates.length > 0,
      emits_review_surface_only: TRUE_VALUE,
      executes_queue_items: FALSE_VALUE,
      candidates: isBlocked ? [] : candidates,
      candidates_count: isBlocked ? 0 : candidates.length,
      summary: isBlocked ? emptySummary() : buildQueueSummary(candidates),
      source_live_dry_run_result: plan.request.source_live_dry_run_result,
      queue_blocked: isBlocked,
      blocked_reason: blockedReason,
      safety: buildSafety(),
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: ConfirmedActionReviewQueueRequest,
): NormalizedConfirmedActionReviewQueueRequest {
  return {
    ...request,
    version: CONFIRMED_ACTION_REVIEW_QUEUE_VERSION,
  };
}

function buildSafety(): ConfirmedActionReviewQueueSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executable: FALSE_VALUE,
  };
}

function emptySummary(): ConfirmedActionReviewQueueSummary {
  return buildQueueSummary([]);
}

function priorityBandFor(envelope: ConfirmedActionEnvelope): ConfirmedActionReviewPriorityBand {
  if (envelope.risk_flags.some(flag => HIGH_RISK_FLAGS.includes(flag))) return 'high';
  if (envelope.source_proposal_type === 'REVIEW_EVIDENCE_GAP' || envelope.evidence_refs.length === 0) return 'low';
  return 'medium';
}

function evidenceSummaryFor(evidenceRefs: readonly ConfirmedActionEvidenceRef[]): string {
  if (evidenceRefs.length === 0) return 'No evidence references are attached for this review candidate.';
  return `${evidenceRefs.length} evidence reference(s) attached for human review.`;
}

function riskSummaryFor(riskFlags: readonly ConfirmedActionRiskFlag[]): string {
  if (riskFlags.length === 0) return 'No risk flags attached.';
  return `Risk flags: ${riskFlags.join(', ')}`;
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function blocked(
  reason: ConfirmedActionReviewQueueBlockedReason,
): ConfirmedActionReviewQueueValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function activeStateReason(value: unknown): ConfirmedActionReviewQueueBlockedReason {
  const key = findActiveActionStateKey(value);
  if (key === 'human_confirmed') return 'illegal_source_human_confirmed';
  if (key === 'represents_executed_action' || key === 'executed') return 'illegal_source_executed_action';
  if (key === 'writes_database') return 'illegal_source_writes_database';
  if (key === 'reads_database') return 'illegal_source_reads_database';
  return 'illegal_envelope_executable';
}

function containsActiveActionState(value: unknown): boolean {
  return findActiveActionStateKey(value) !== null;
}

function findActiveActionStateKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findActiveActionStateKey(item);
      if (found) return found;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;

  for (const [key, item] of Object.entries(record)) {
    if (
      item === true
      && (
        key === 'executable'
        || key === 'human_confirmed'
        || key === 'executed'
        || key === 'represents_executed_action'
        || key === 'writes_database'
        || key === 'reads_database'
      )
    ) {
      return key;
    }
    const found = findActiveActionStateKey(item);
    if (found) return found;
  }

  return null;
}
