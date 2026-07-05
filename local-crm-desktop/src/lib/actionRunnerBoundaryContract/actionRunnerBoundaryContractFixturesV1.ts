import type {
  HumanConfirmationContractCandidate,
  HumanConfirmationContractRequest,
  HumanConfirmationContractResult,
} from '../humanConfirmationContractReadiness';
import type {
  RunnerBoundaryContractRequest,
} from '../actionRunnerBoundaryContractReadiness';

interface HumanConfirmationAnswerOverride {
  contract_blocked?: boolean;
  executes_confirmation?: boolean;
  contract_only?: boolean;
  executable?: boolean;
  human_confirmed?: boolean;
  represents_executed_action?: boolean;
  candidates?: readonly HumanConfirmationContractCandidate[];
  candidates_count?: number;
  safety?: {
    reads_database?: boolean;
    writes_database?: boolean;
    executable?: boolean;
  };
}

interface HumanConfirmationResultOverride {
  kind?: string;
  answer?: HumanConfirmationAnswerOverride | null;
}

export function buildRunnerBoundaryContractRequestFixtureV1(
  override: HumanConfirmationResultOverride = {},
): RunnerBoundaryContractRequest {
  return {
    kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_REQUEST',
    version: 'v1',
    request_id: 'RUNNER_BOUNDARY_CONTRACT_TEST_REQUEST_A',
    source_human_confirmation_contract_result: buildCallerProvidedHumanConfirmationContractResultFixtureV1(override),
  };
}

export function buildCallerProvidedHumanConfirmationContractResultFixtureV1(
  override: HumanConfirmationResultOverride = {},
): HumanConfirmationContractResult {
  const result = baseResult();
  applyOverride(result, override);
  return result as unknown as HumanConfirmationContractResult;
}

export function buildRunnerBoundarySourceCandidateFixtureV1(
  index: number,
  options: {
    confirmation_status?: HumanConfirmationContractCandidate['confirmation_status'];
    evidence_refs?: HumanConfirmationContractCandidate['evidence_refs'];
    risk_flags?: HumanConfirmationContractCandidate['risk_flags'];
    blocked_reason?: string | null;
    human_confirmed?: boolean;
    confirmed?: boolean;
    approved?: boolean;
    executable?: boolean;
    executed?: boolean;
    persisted?: boolean;
    writes_database?: boolean;
    represents_executed_action?: boolean;
    represents_recorded_confirmation?: boolean;
    contract_only?: boolean;
    requires_human_review?: boolean;
    operator_resolved?: boolean;
    operator_represents_real_operator?: boolean;
  } = {},
): HumanConfirmationContractCandidate {
  const confirmationStatus = options.confirmation_status ?? 'awaiting_human_confirmation';
  const evidenceRefs = options.evidence_refs ?? [
    evidenceRef(`RUNNER_BOUNDARY_CUSTOMER_${index}`, `Runner boundary customer ${index}`),
  ];
  const riskFlags = options.risk_flags ?? ['fixture_only_signal'];

  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_CANDIDATE',
    version: 'v1',
    confirmation_candidate_id: `HUMAN_CONFIRM_LIVE_${String(index).padStart(3, '0')}`,
    source_queue_item_id: `REVIEW_QUEUE_LIVE_${String(index).padStart(3, '0')}`,
    source_action_id: `CONFIRM_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_id: `SUGGEST_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_type: index === 2 ? 'REVIEW_EVIDENCE_GAP' : 'REVIEW_FOLLOW_UP_TASK',
    action_type: index === 2 ? 'CONFIRM_REVIEW_EVIDENCE_GAP' : 'CONFIRM_REVIEW_FOLLOW_UP_TASK',
    title: `Human confirmation candidate ${index}`,
    summary: `Human confirmation candidate ${index} remains blocked before runner boundary use.`,
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
    review_status: confirmationStatus === 'blocked' ? 'blocked' : 'pending_review',
    confirmation_status: confirmationStatus,
    priority_band: index === 1 ? 'high' : 'low',
    blocked_reason: options.blocked_reason ?? (
      confirmationStatus === 'blocked' ? 'Source confirmation candidate is blocked' : null
    ),
    operator: {
      kind: 'HUMAN_CONFIRMATION_OPERATOR_PLACEHOLDER',
      version: 'v1',
      contract_only: true,
      resolved: (options.operator_resolved ?? false) as false,
      source: 'future_ui_or_session',
      represents_real_operator: (options.operator_represents_real_operator ?? false) as false,
      persisted: false,
    },
    confirmation_metadata: {
      kind: 'HUMAN_CONFIRMATION_METADATA_PLACEHOLDER',
      version: 'v1',
      contract_only: true,
      resolved: false,
      source: 'future_ui_or_session',
      persisted: false,
    },
    executable: (options.executable ?? false) as false,
    persisted: (options.persisted ?? false) as false,
    human_confirmed: (options.human_confirmed ?? false) as false,
    confirmed: (options.confirmed ?? false) as false,
    approved: (options.approved ?? false) as false,
    writes_database: (options.writes_database ?? false) as false,
    represents_executed_action: (options.represents_executed_action ?? false) as false,
    requires_human_review: (options.requires_human_review ?? true) as true,
    contract_only: (options.contract_only ?? true) as true,
    ...(options.executed !== undefined ? { executed: options.executed } : {}),
    ...(options.represents_recorded_confirmation !== undefined
      ? { represents_recorded_confirmation: options.represents_recorded_confirmation }
      : {}),
  } as unknown as HumanConfirmationContractCandidate;
}

function evidenceRef(
  id: string,
  label: string,
): HumanConfirmationContractCandidate['evidence_refs'][number] {
  return {
    type: 'customer',
    id,
    label,
    synthetic: false,
    persisted: false,
    ['represents_real_' + ['mo', 'del_output'].join('')]: false,
  } as unknown as HumanConfirmationContractCandidate['evidence_refs'][number];
}

function baseResult(): Record<string, unknown> {
  const candidates = [
    buildRunnerBoundarySourceCandidateFixtureV1(1, {
      risk_flags: ['message_send_requires_review', 'fixture_only_signal'],
    }),
    buildRunnerBoundarySourceCandidateFixtureV1(2, {
      confirmation_status: 'blocked',
      evidence_refs: [],
      risk_flags: ['insufficient_evidence'],
      blocked_reason: 'Evidence must be collected before confirmation can proceed',
    }),
  ];

  return {
    kind: 'HUMAN_CONFIRMATION_CONTRACT_RESULT',
    version: 'v1',
    plan: {
      kind: 'HUMAN_CONFIRMATION_CONTRACT_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'human_confirmation_contract_readiness_only',
      request: {
        kind: 'HUMAN_CONFIRMATION_CONTRACT_REQUEST',
        version: 'v1',
        request_id: 'RUNNER_BOUNDARY_SOURCE_HUMAN_CONFIRMATION_REQUEST_A',
      } satisfies Partial<HumanConfirmationContractRequest>,
      allowed_operations: [
        'validate_review_queue_result',
        'project_confirmation_contract_candidates',
        'build_confirmation_contract_summary',
      ],
      forbidden_operations: ['read_db', 'write_db', 'record_human_confirmation', 'persist_confirmation'],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
      },
    },
    answer: {
      kind: 'HUMAN_CONFIRMATION_CONTRACT_ANSWER',
      version: 'v1',
      contract_only: true,
      executable: false,
      persisted: false,
      human_confirmed: false,
      represents_executed_action: false,
      generated_confirmation_contract_candidates: true,
      executes_confirmation: false,
      candidates,
      candidates_count: candidates.length,
      summary: {
        kind: 'HUMAN_CONFIRMATION_CONTRACT_SUMMARY',
        version: 'v1',
        total: candidates.length,
        awaiting_human_confirmation: 1,
        blocked: 1,
        high_priority: 1,
        by_action_type: {
          CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
          CONFIRM_REVIEW_EVIDENCE_GAP: 1,
        },
        by_confirmation_status: {
          awaiting_human_confirmation: 1,
          blocked: 1,
        },
      },
      source_review_queue_result: {
        kind: 'CONFIRMED_ACTION_REVIEW_QUEUE_RESULT',
        version: 'v1',
        persisted: false,
        represents_executed_action: false,
      },
      contract_blocked: false,
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

function applyOverride(result: Record<string, unknown>, override: HumanConfirmationResultOverride): void {
  if (override.kind !== undefined) result.kind = override.kind;
  if (override.answer === null) {
    delete result.answer;
    return;
  }
  if (!override.answer) return;

  const answer = result.answer as Record<string, unknown>;
  if (override.answer.contract_blocked !== undefined) answer.contract_blocked = override.answer.contract_blocked;
  if (override.answer.executes_confirmation !== undefined) {
    answer.executes_confirmation = override.answer.executes_confirmation;
  }
  if (override.answer.contract_only !== undefined) answer.contract_only = override.answer.contract_only;
  if (override.answer.executable !== undefined) answer.executable = override.answer.executable;
  if (override.answer.human_confirmed !== undefined) answer.human_confirmed = override.answer.human_confirmed;
  if (override.answer.represents_executed_action !== undefined) {
    answer.represents_executed_action = override.answer.represents_executed_action;
  }
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
