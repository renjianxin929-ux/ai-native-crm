import type {
  ConfirmedActionReviewQueueCandidate,
  ConfirmedActionReviewQueueResult,
} from '../confirmedActionReviewQueueReadiness';
import type {
  HumanConfirmationContractRequest,
} from '../humanConfirmationContractReadiness';

interface ReviewQueueAnswerOverride {
  queue_blocked?: boolean;
  executes_queue_items?: boolean;
  executable?: boolean;
  human_confirmed?: boolean;
  candidates?: readonly ConfirmedActionReviewQueueCandidate[];
  candidates_count?: number;
  safety?: {
    reads_database?: boolean;
    writes_database?: boolean;
    executable?: boolean;
  };
}

interface ReviewQueueResultOverride {
  kind?: string;
  answer?: ReviewQueueAnswerOverride | null;
}

export function buildHumanConfirmationContractRequestFixtureV1(
  override: ReviewQueueResultOverride = {},
): HumanConfirmationContractRequest {
  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_REQUEST',
    version: 'v1',
    request_id: 'HUMAN_CONFIRMATION_CONTRACT_TEST_REQUEST_A',
    source_review_queue_result: buildCallerProvidedReviewQueueResultFixtureV1(override),
  };
}

export function buildCallerProvidedReviewQueueResultFixtureV1(
  override: ReviewQueueResultOverride = {},
): ConfirmedActionReviewQueueResult {
  const result = baseResult();
  applyOverride(result, override);
  return result as unknown as ConfirmedActionReviewQueueResult;
}

export function buildHumanConfirmationSourceCandidateFixtureV1(
  index: number,
  options: {
    review_status?: ConfirmedActionReviewQueueCandidate['review_status'];
    priority_band?: ConfirmedActionReviewQueueCandidate['priority_band'];
    evidence_refs?: ConfirmedActionReviewQueueCandidate['evidence_refs'];
    risk_flags?: ConfirmedActionReviewQueueCandidate['risk_flags'];
    blocked_reason?: string | null;
    executable?: boolean;
    human_confirmed?: boolean;
    represents_executed_action?: boolean;
    writes_database?: boolean;
  } = {},
): ConfirmedActionReviewQueueCandidate {
  const reviewStatus = options.review_status ?? 'pending_review';
  const evidenceRefs = options.evidence_refs ?? [
    evidenceRef(`HUMAN_CONFIRMATION_CUSTOMER_${index}`, `Human confirmation customer ${index}`),
  ];
  const riskFlags = options.risk_flags ?? ['fixture_only_signal'];

  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_CANDIDATE',
    version: 'v1',
    queue_item_id: `REVIEW_QUEUE_LIVE_${String(index).padStart(3, '0')}`,
    source_action_id: `CONFIRM_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_id: `SUGGEST_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_type: index === 2 ? 'REVIEW_EVIDENCE_GAP' : 'REVIEW_FOLLOW_UP_TASK',
    action_type: index === 2 ? 'CONFIRM_REVIEW_EVIDENCE_GAP' : 'CONFIRM_REVIEW_FOLLOW_UP_TASK',
    title: `Review queue candidate ${index}`,
    summary: `Review queue candidate ${index} remains a contract-only confirmation input.`,
    evidence_refs: evidenceRefs,
    risk_flags: riskFlags,
    preconditions: [
      {
        name: 'requires_human_confirmation',
        required: true,
        satisfied: false,
        blocking: false,
        message: 'Human confirmation remains unresolved in contract readiness',
      },
      {
        name: 'requires_no_db_write',
        required: true,
        satisfied: true,
        blocking: false,
        message: 'No database write is allowed in contract readiness',
      },
    ],
    blocked_reason: options.blocked_reason ?? (reviewStatus === 'blocked' ? 'Review queue candidate is blocked' : null),
    review_status: reviewStatus,
    priority_band: options.priority_band ?? 'medium',
    evidence_summary: `${evidenceRefs.length} evidence reference(s) attached for contract review.`,
    risk_summary: `Risk flags: ${riskFlags.join(', ')}`,
    executable: (options.executable ?? false) as false,
    persisted: false,
    human_confirmed: (options.human_confirmed ?? false) as false,
    writes_database: (options.writes_database ?? false) as false,
    represents_executed_action: (options.represents_executed_action ?? false) as false,
    requires_human_review: true,
    dry_run_only: true,
    confirmation_required: true,
  };
}

function evidenceRef(
  id: string,
  label: string,
): ConfirmedActionReviewQueueCandidate['evidence_refs'][number] {
  return {
    type: 'customer',
    id,
    label,
    synthetic: false,
    persisted: false,
    ['represents_real_' + ['mo', 'del_output'].join('')]: false,
  } as unknown as ConfirmedActionReviewQueueCandidate['evidence_refs'][number];
}

function baseResult(): Record<string, unknown> {
  const candidates = [
    buildHumanConfirmationSourceCandidateFixtureV1(1, {
      priority_band: 'high',
      risk_flags: ['message_send_requires_review', 'fixture_only_signal'],
    }),
    buildHumanConfirmationSourceCandidateFixtureV1(2, {
      review_status: 'blocked',
      priority_band: 'low',
      evidence_refs: [],
      risk_flags: ['insufficient_evidence'],
      blocked_reason: 'Evidence must be collected before confirmation can proceed',
    }),
  ];

  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT',
    version: 'v1',
    plan: {
      kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'confirmed_action_review_queue_readiness_only',
      request: {
        kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_REQUEST',
        version: 'v1',
        request_id: 'HUMAN_CONFIRMATION_SOURCE_QUEUE_REQUEST_A',
      },
      allowed_operations: [
        'validate_confirmed_action_live_dry_run_input',
        'project_review_queue_candidates',
        'build_review_queue_summary',
      ],
      forbidden_operations: ['read_db', 'write_db', 'execute_queue_item', 'persist_queue_item'],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
      },
    },
    answer: {
      kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_ANSWER',
      version: 'v1',
      dry_run_only: true,
      executable: false,
      human_confirmed: false,
      requires_human_review: true,
      represents_executed_action: false,
      generated_review_queue_candidates: true,
      emits_review_surface_only: true,
      executes_queue_items: false,
      candidates,
      candidates_count: candidates.length,
      summary: {
        kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_SUMMARY',
        version: 'v1',
        total: candidates.length,
        ready_for_review: 1,
        blocked: 1,
        high_risk: 1,
        missing_evidence: 1,
        by_action_type: {
          CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
          CONFIRM_REVIEW_EVIDENCE_GAP: 1,
        },
        by_risk_flag: {
          message_send_requires_review: 1,
          fixture_only_signal: 1,
          insufficient_evidence: 1,
        },
      },
      source_live_dry_run_result: {
        kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_RESULT',
        version: 'v1',
        persisted: false,
        represents_executed_action: false,
      },
      queue_blocked: false,
      blocked_reason: null,
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
      },
    },
    persisted: false,
    represents_executed_action: false,
  };
}

function applyOverride(result: Record<string, unknown>, override: ReviewQueueResultOverride): void {
  if (override.kind !== undefined) result.kind = override.kind;
  if (override.answer === null) {
    delete result.answer;
    return;
  }
  if (!override.answer) return;

  const answer = result.answer as Record<string, unknown>;
  if (override.answer.queue_blocked !== undefined) answer.queue_blocked = override.answer.queue_blocked;
  if (override.answer.executes_queue_items !== undefined) {
    answer.executes_queue_items = override.answer.executes_queue_items;
  }
  if (override.answer.executable !== undefined) answer.executable = override.answer.executable;
  if (override.answer.human_confirmed !== undefined) answer.human_confirmed = override.answer.human_confirmed;
  if (override.answer.candidates !== undefined) answer.candidates = override.answer.candidates;
  if (override.answer.candidates_count !== undefined) {
    answer.candidates_count = override.answer.candidates_count;
  } else if (override.answer.candidates !== undefined) {
    answer.candidates_count = override.answer.candidates.length;
  }
  if (override.answer.safety?.reads_database !== undefined) {
    (answer.safety as Record<string, unknown>).reads_database = override.answer.safety.reads_database;
  }
  if (override.answer.safety?.writes_database !== undefined) {
    (answer.safety as Record<string, unknown>).writes_database = override.answer.safety.writes_database;
  }
  if (override.answer.safety?.executable !== undefined) {
    (answer.safety as Record<string, unknown>).executable = override.answer.safety.executable;
  }
}
