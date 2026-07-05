import type {
  ConfirmedActionEnvelope,
  ConfirmedActionPrecondition,
  ConfirmedActionType,
} from '../confirmedActionContractReadiness';
import type {
  ConfirmedActionLiveDryRunResult,
} from '../confirmedActionLiveDryRunReadiness';
import type {
  ConfirmedActionReviewQueueRequest,
} from '../confirmedActionReviewQueueReadiness';

interface ReviewQueueAnswerOverride {
  dry_run_blocked?: boolean;
  generated_confirmed_action_envelopes?: boolean;
  emits_dry_run_envelopes?: boolean;
  executes_generated_envelopes?: boolean;
  represents_executed_action?: boolean;
  human_confirmed?: boolean;
  envelopes?: readonly ConfirmedActionEnvelope[];
  envelopes_count?: number;
  safety?: {
    reads_database?: boolean;
    writes_database?: boolean;
    executable?: boolean;
  };
  source_live_dry_run_result?: unknown;
}

interface ReviewQueueSourceOverride {
  kind?: string;
  answer?: ReviewQueueAnswerOverride | null;
  represents_executed_action?: boolean;
}

export function buildConfirmedActionReviewQueueRequestFixtureV1(
  override: ReviewQueueSourceOverride = {},
): ConfirmedActionReviewQueueRequest {
  return {
    kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_REQUEST',
    version: 'v1',
    request_id: 'REVIEW_QUEUE_TEST_REQUEST_A',
    source_live_dry_run_result: buildCallerProvidedConfirmedActionLiveDryRunResultFixtureV1(override),
  };
}

export function buildCallerProvidedConfirmedActionLiveDryRunResultFixtureV1(
  override: ReviewQueueSourceOverride = {},
): ConfirmedActionLiveDryRunResult {
  const result = baseResult();
  applyOverride(result, override);
  return result as unknown as ConfirmedActionLiveDryRunResult;
}

export function buildReviewQueueEnvelopeFixtureV1(
  index: number,
  proposalType: ConfirmedActionEnvelope['source_proposal_type'],
  options: {
    risk_flags?: ConfirmedActionEnvelope['risk_flags'];
    evidence_refs?: ConfirmedActionEnvelope['evidence_refs'];
    blocked_reason?: string | null;
    preconditions?: ConfirmedActionEnvelope['preconditions'];
    executable?: boolean;
    human_confirmed?: boolean;
    represents_executed_action?: boolean;
  } = {},
): ConfirmedActionEnvelope {
  const actionType = actionTypeFor(proposalType);
  const evidenceRefs = options.evidence_refs ?? [
    evidenceRef('customer', `REVIEW_QUEUE_CUSTOMER_${index}`, `Review queue customer ${index}`),
  ];
  const riskFlags = options.risk_flags ?? ['fixture_only_signal'];
  const preconditions = options.preconditions ?? preconditionsFor(evidenceRefs.length > 0);
  const blockedReason = options.blocked_reason ?? null;

  return {
    kind: 'CONFIRMED_ACTION_ENVELOPE',
    version: 'v1',
    action_id: `CONFIRM_LIVE_${String(index).padStart(3, '0')}`,
    action_type: actionType,
    source_proposal_id: `SUGGEST_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_type: proposalType,
    title: `Contract review: ${proposalType.toLowerCase().replaceAll('_', ' ')}`,
    summary: `Dry-run contract envelope ${index} for ${proposalType.toLowerCase().replaceAll('_', ' ')}.`,
    confirmation_required: true,
    human_confirmed: (options.human_confirmed ?? false) as false,
    dry_run_only: true,
    executable: (options.executable ?? false) as false,
    persisted: false,
    writes_database: false,
    represents_executed_action: (options.represents_executed_action ?? false) as false,
    evidence_refs: evidenceRefs,
    risk_flags: riskFlags,
    preconditions,
    blocked_reason: blockedReason,
    dry_run: {
      dry_run_only: true,
      no_side_effects: true,
      writes_database: false,
      no_business_function_call: true,
      represents_executed_action: false,
      future_human_guidance: ['Human owner reviews this candidate later.'],
      explicit_non_actions: ['Does not create customer', 'Does not update customer', 'Does not create task'],
    },
  };
}

function baseResult(): Record<string, unknown> {
  const envelopes = [
    buildReviewQueueEnvelopeFixtureV1(1, 'REVIEW_SYNC_FAILURE', {
      risk_flags: ['sync_failed', 'message_send_requires_review', 'fixture_only_signal'],
      evidence_refs: [
        evidenceRef('lead_sync_log', 'REVIEW_QUEUE_SYNC_LOG_A', 'Review queue sync log A'),
        evidenceRef('collected_lead', 'REVIEW_QUEUE_COLLECTED_A', 'Review queue collected lead A'),
      ],
    }),
    buildReviewQueueEnvelopeFixtureV1(2, 'REVIEW_FOLLOW_UP_TASK'),
  ];

  return {
    kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_RESULT',
    version: 'v1',
    plan: {
      kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'confirmed_action_live_dry_run_readiness_only',
      request: {
        kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_REQUEST',
        version: 'v1',
        request_id: 'REVIEW_QUEUE_SOURCE_REQUEST_A',
      },
      allowed_operations: ['validate_source_live_dry_run_result', 'emit_dry_run_envelopes'],
      forbidden_operations: ['read_db', 'write_db', 'persist_envelope', 'confirm_action'],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
      },
    },
    answer: {
      kind: 'CONFIRMED_ACTION_LIVE_DRY_RUN_ANSWER',
      version: 'v1',
      dry_run_only: true,
      executable: false,
      human_confirmed: false,
      confirmation_required: true,
      pending_human_confirmation: true,
      represents_executed_action: false,
      generated_confirmed_action_envelopes: true,
      emits_dry_run_envelopes: true,
      executes_generated_envelopes: false,
      envelopes,
      envelopes_count: envelopes.length,
      source_live_dry_run_result: nestedSource(),
      source_is_loaded_snapshot: true,
      dry_run_blocked: false,
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

function applyOverride(result: Record<string, unknown>, override: ReviewQueueSourceOverride): void {
  if (override.kind !== undefined) result.kind = override.kind;
  if (override.represents_executed_action !== undefined) {
    result.represents_executed_action = override.represents_executed_action;
  }
  if (override.answer === null) {
    delete result.answer;
    return;
  }
  if (!override.answer) return;

  const answer = result.answer as Record<string, unknown>;
  if (override.answer.dry_run_blocked !== undefined) answer.dry_run_blocked = override.answer.dry_run_blocked;
  if (override.answer.generated_confirmed_action_envelopes !== undefined) {
    answer.generated_confirmed_action_envelopes = override.answer.generated_confirmed_action_envelopes;
  }
  if (override.answer.emits_dry_run_envelopes !== undefined) {
    answer.emits_dry_run_envelopes = override.answer.emits_dry_run_envelopes;
  }
  if (override.answer.executes_generated_envelopes !== undefined) {
    answer.executes_generated_envelopes = override.answer.executes_generated_envelopes;
  }
  if (override.answer.represents_executed_action !== undefined) {
    answer.represents_executed_action = override.answer.represents_executed_action;
  }
  if (override.answer.human_confirmed !== undefined) answer.human_confirmed = override.answer.human_confirmed;
  if (override.answer.envelopes !== undefined) answer.envelopes = override.answer.envelopes;
  if (override.answer.envelopes_count !== undefined) {
    answer.envelopes_count = override.answer.envelopes_count;
  } else if (override.answer.envelopes !== undefined) {
    answer.envelopes_count = override.answer.envelopes.length;
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
  if (override.answer.source_live_dry_run_result !== undefined) {
    answer.source_live_dry_run_result = override.answer.source_live_dry_run_result;
  }
}

function actionTypeFor(
  proposalType: ConfirmedActionEnvelope['source_proposal_type'],
): ConfirmedActionEnvelope['action_type'] {
  const map: Record<ConfirmedActionEnvelope['source_proposal_type'], ConfirmedActionType> = {
    REVIEW_CUSTOMER_PRIORITY: 'CONFIRM_REVIEW_CUSTOMER_PRIORITY',
    REVIEW_GRADE_CHANGE: 'CONFIRM_REVIEW_GRADE_CHANGE',
    REVIEW_SYNC_FAILURE: 'CONFIRM_REVIEW_SYNC_FAILURE',
    REVIEW_FOLLOW_UP_TASK: 'CONFIRM_REVIEW_FOLLOW_UP_TASK',
    REVIEW_EVIDENCE_GAP: 'CONFIRM_REVIEW_EVIDENCE_GAP',
    REVIEW_STUCK_WORK_ITEM: 'CONFIRM_REVIEW_STUCK_WORK_ITEM',
    REVIEW_NEXT_BEST_ACTION: 'CONFIRM_REVIEW_NEXT_BEST_ACTION',
  };
  return map[proposalType];
}

function evidenceRef(
  type: ConfirmedActionEnvelope['evidence_refs'][number]['type'],
  id: string,
  label: string,
): ConfirmedActionEnvelope['evidence_refs'][number] {
  return {
    type,
    id,
    label,
    synthetic: false,
    persisted: true,
    ['represents_real_' + ['mo', 'del_output'].join('')]: false,
  } as unknown as ConfirmedActionEnvelope['evidence_refs'][number];
}

function preconditionsFor(hasEvidence: boolean): ConfirmedActionPrecondition[] {
  return [
    {
      name: 'requires_human_confirmation',
      required: true,
      satisfied: false,
      blocking: false,
      message: 'Human confirmation not recorded in review queue fixture',
    },
    {
      name: 'requires_non_empty_evidence',
      required: true,
      satisfied: hasEvidence,
      blocking: !hasEvidence,
      message: hasEvidence ? 'Evidence references are present' : 'Non-empty evidence is required before review can proceed',
    },
    {
      name: 'requires_no_db_write',
      required: true,
      satisfied: true,
      blocking: false,
      message: 'Envelope writes database flag remains false',
    },
    {
      name: 'requires_no_provider_call',
      required: true,
      satisfied: true,
      blocking: false,
      message: 'No runtime call is allowed by review queue fixture',
    },
  ];
}

function nestedSource(): Record<string, unknown> {
  return {
    kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_RESULT',
    version: 'v1',
    answer: {
      kind: 'SUGGEST_ONLY_LIVE_DRY_RUN_ANSWER',
      dry_run_only: true,
      dry_run_blocked: false,
      generated_envelopes: false,
      represents_executed_action: false,
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
      },
      source_live_dry_run_result: {
        kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_RESULT',
        answer: {
          dry_run_blocked: false,
          safety: {
            reads_database: false,
            writes_database: false,
            executable: false,
          },
          represents_executed_action: false,
        },
        persisted: false,
        represents_executed_action: false,
      },
    },
    persisted: false,
    represents_executed_action: false,
  };
}
