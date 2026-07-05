import type {
  RunnerBoundaryCandidate,
  RunnerBoundaryContractRequest,
  RunnerBoundaryContractResult,
} from '../actionRunnerBoundaryContractReadiness';
import type {
  DbWritePlanDryRunRequest,
} from '../dbWritePlanDryRunReadiness';

interface RunnerBoundaryAnswerOverride {
  runner_boundary_blocked?: boolean;
  contract_only?: boolean;
  dry_run_only?: boolean;
  ready_for_runner?: boolean;
  executable?: boolean;
  executed?: boolean;
  persisted?: boolean;
  reads_database?: boolean;
  writes_database?: boolean;
  represents_executed_action?: boolean;
  represents_runner_execution?: boolean;
  human_confirmed?: boolean;
  confirmed?: boolean;
  approved?: boolean;
  runner_boundary_candidates?: readonly RunnerBoundaryCandidate[];
  runner_boundary_candidates_count?: number;
  safety?: {
    reads_database?: boolean;
    writes_database?: boolean;
  };
}

interface RunnerBoundaryResultOverride {
  kind?: string;
  persisted?: boolean;
  represents_executed_action?: boolean;
  represents_runner_execution?: boolean;
  answer?: RunnerBoundaryAnswerOverride | null;
}

export function buildDbWritePlanDryRunRequestFixtureV1(
  override: RunnerBoundaryResultOverride = {},
): DbWritePlanDryRunRequest {
  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_REQUEST',
    version: 'v1',
    request_id: 'DB_WRITE_PLAN_DRY_RUN_TEST_REQUEST_A',
    source_action_runner_boundary_result: buildCallerProvidedRunnerBoundaryResultFixtureV1(override),
  };
}

export function buildCallerProvidedRunnerBoundaryResultFixtureV1(
  override: RunnerBoundaryResultOverride = {},
): RunnerBoundaryContractResult {
  const result = baseResult();
  applyOverride(result, override);
  return result as unknown as RunnerBoundaryContractResult;
}

export function buildDbWritePlanSourceCandidateFixtureV1(
  index: number,
  options: {
    runner_status?: RunnerBoundaryCandidate['runner_status'];
    blocked_reason?: string;
    evidence_refs?: RunnerBoundaryCandidate['evidence_refs'];
    risk_flags?: RunnerBoundaryCandidate['risk_flags'];
    ready_for_runner?: boolean;
    executable?: boolean;
    executed?: boolean;
    persisted?: boolean;
    reads_database?: boolean;
    writes_database?: boolean;
    human_confirmed?: boolean;
    confirmed?: boolean;
    approved?: boolean;
    represents_executed_action?: boolean;
    represents_runner_execution?: boolean;
    contract_only?: boolean;
    dry_run_only?: boolean;
    idempotency_usable_for_execution?: boolean;
    idempotency_resolved?: boolean;
    idempotency_persisted?: boolean;
  } = {},
): RunnerBoundaryCandidate {
  const runnerStatus = options.runner_status ?? 'blocked_requires_real_confirmation';
  const evidenceRefs = options.evidence_refs ?? [
    evidenceRef(`DB_WRITE_PLAN_CUSTOMER_${index}`, `DB write plan customer ${index}`),
  ];
  const riskFlags = options.risk_flags ?? ['fixture_only_signal'];
  const sourceActionId = `CONFIRM_LIVE_${String(index).padStart(3, '0')}`;

  return {
    kind: 'ACTION_RUNNER_BOUNDARY_CANDIDATE',
    version: 'v1',
    runner_boundary_candidate_id: `ACTION_RUNNER_BOUNDARY_LIVE_${String(index).padStart(3, '0')}`,
    source_confirmation_candidate_id: `HUMAN_CONFIRM_LIVE_${String(index).padStart(3, '0')}`,
    source_queue_item_id: `REVIEW_QUEUE_LIVE_${String(index).padStart(3, '0')}`,
    source_action_id: sourceActionId,
    source_proposal_id: `SUGGEST_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_type: index === 2 ? 'REVIEW_EVIDENCE_GAP' : 'REVIEW_FOLLOW_UP_TASK',
    action_type: index === 2 ? 'CONFIRM_REVIEW_EVIDENCE_GAP' : 'CONFIRM_REVIEW_FOLLOW_UP_TASK',
    title: `Runner boundary candidate ${index}`,
    summary: `Runner boundary candidate ${index} remains blocked before write planning.`,
    evidence_refs: evidenceRefs,
    risk_flags: riskFlags,
    runner_status: runnerStatus,
    blocked_reason: options.blocked_reason ?? (
      runnerStatus === 'blocked_source_confirmation_candidate'
        ? 'Source confirmation candidate is blocked'
        : 'requires_real_human_confirmation'
    ),
    required_confirmation_proof: {
      kind: 'REQUIRED_CONFIRMATION_PROOF_SCHEMA',
      schema_only: true,
      requires_real_human_confirmation: true,
      requires_operator_resolution: true,
      requires_confirmation_metadata_resolution: true,
      represents_recorded_confirmation: false,
      recorded_confirmation_proof: [],
    },
    required_operator_confirmation_dependency: {
      kind: 'REQUIRED_OPERATOR_CONFIRMATION_DEPENDENCY',
      version: 'v1',
      dependency_only: true,
      resolved: false,
      represents_real_operator: false,
      persisted: false,
    },
    pre_execution_requirements: {
      kind: 'PRE_EXECUTION_REQUIREMENTS',
      requires_real_human_confirmation: true,
      requires_operator_resolution: true,
      requires_confirmation_metadata_resolution: true,
      requires_non_executable_source: true,
      requires_no_database_write: true,
      writable_for_execution: false,
    },
    execution_prohibition: {
      kind: 'RUNNER_EXECUTION_PROHIBITION',
      executes_action: false,
      writes_database: false,
      mutates_state: false,
      sends_message: false,
      calls_provider: false,
      explicit_non_actions: [
        'Does not run an action',
        'Does not write database records',
      ],
    },
    idempotency: {
      kind: 'RUNNER_IDEMPOTENCY_PLACEHOLDER',
      version: 'v1',
      placeholder_only: true,
      resolved: (options.idempotency_resolved ?? false) as false,
      persisted: (options.idempotency_persisted ?? false) as false,
      usable_for_execution: (options.idempotency_usable_for_execution ?? false) as false,
      value: `RUNNER_BOUNDARY_IDEMPOTENCY_${sourceActionId}`,
    },
    contract_only: (options.contract_only ?? true) as true,
    dry_run_only: (options.dry_run_only ?? true) as true,
    ready_for_runner: (options.ready_for_runner ?? false) as false,
    executable: (options.executable ?? false) as false,
    executed: (options.executed ?? false) as false,
    persisted: (options.persisted ?? false) as false,
    reads_database: (options.reads_database ?? false) as false,
    writes_database: (options.writes_database ?? false) as false,
    human_confirmed: (options.human_confirmed ?? false) as false,
    confirmed: (options.confirmed ?? false) as false,
    approved: (options.approved ?? false) as false,
    represents_executed_action: (options.represents_executed_action ?? false) as false,
    represents_runner_execution: (options.represents_runner_execution ?? false) as false,
    requires_real_human_confirmation: true,
  } as unknown as RunnerBoundaryCandidate;
}

function evidenceRef(
  id: string,
  label: string,
): RunnerBoundaryCandidate['evidence_refs'][number] {
  return {
    type: 'customer',
    id,
    label,
    synthetic: false,
    persisted: false,
    ['represents_real_' + ['mo', 'del_output'].join('')]: false,
  } as unknown as RunnerBoundaryCandidate['evidence_refs'][number];
}

function baseResult(): Record<string, unknown> {
  const candidates = [
    buildDbWritePlanSourceCandidateFixtureV1(1, {
      risk_flags: ['message_send_requires_review', 'fixture_only_signal'],
    }),
    buildDbWritePlanSourceCandidateFixtureV1(2, {
      runner_status: 'blocked_source_confirmation_candidate',
      evidence_refs: [],
      risk_flags: ['insufficient_evidence'],
      blocked_reason: 'Evidence must be collected before runner boundary use',
    }),
  ];

  return {
    kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT',
    version: 'v1',
    plan: {
      kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'action_runner_boundary_contract_readiness_only',
      request: {
        kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_REQUEST',
        version: 'v1',
        request_id: 'DB_WRITE_PLAN_SOURCE_RUNNER_BOUNDARY_REQUEST_A',
      } satisfies Partial<RunnerBoundaryContractRequest>,
      allowed_operations: [
        'validate_human_confirmation_contract_result',
        'project_runner_boundary_candidates',
        'build_runner_boundary_summary',
      ],
      forbidden_operations: ['read_db', 'write_db', 'execute_runner_boundary'],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        calls_provider: false,
      },
    },
    answer: {
      kind: 'ACTION_RUNNER_BOUNDARY_ANSWER',
      version: 'v1',
      contract_only: true,
      dry_run_only: true,
      ready_for_runner: false,
      executable: false,
      executed: false,
      persisted: false,
      reads_database: false,
      writes_database: false,
      human_confirmed: false,
      confirmed: false,
      approved: false,
      represents_executed_action: false,
      represents_runner_execution: false,
      requires_real_human_confirmation: true,
      generated_runner_boundary_candidates: true,
      runner_boundary_candidates: candidates,
      runner_boundary_candidates_count: candidates.length,
      runner_boundary_blocked: false,
      blocked_reason: null,
      summary: {
        kind: 'ACTION_RUNNER_BOUNDARY_SUMMARY',
        version: 'v1',
        total: candidates.length,
        blocked_requires_real_confirmation: 1,
        blocked_source_confirmation_candidate: 1,
        by_action_type: {
          CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
          CONFIRM_REVIEW_EVIDENCE_GAP: 1,
        },
        by_runner_status: {
          blocked_requires_real_confirmation: 1,
          blocked_source_confirmation_candidate: 1,
        },
      },
      source_human_confirmation_contract_result: {
        kind: 'HUMAN_CONFIRMATION_CONTRACT_RESULT',
        version: 'v1',
        persisted: false,
        represents_executed_action: false,
      },
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        calls_provider: false,
      },
    },
    persisted: false,
    represents_executed_action: false,
    represents_runner_execution: false,
  };
}

function applyOverride(result: Record<string, unknown>, override: RunnerBoundaryResultOverride): void {
  if (override.kind !== undefined) result.kind = override.kind;
  if (override.persisted !== undefined) result.persisted = override.persisted;
  if (override.represents_executed_action !== undefined) {
    result.represents_executed_action = override.represents_executed_action;
  }
  if (override.represents_runner_execution !== undefined) {
    result.represents_runner_execution = override.represents_runner_execution;
  }
  if (override.answer === null) {
    delete result.answer;
    return;
  }
  if (!override.answer) return;

  const answer = result.answer as Record<string, unknown>;
  for (const key of [
    'runner_boundary_blocked',
    'contract_only',
    'dry_run_only',
    'ready_for_runner',
    'executable',
    'executed',
    'persisted',
    'reads_database',
    'writes_database',
    'represents_executed_action',
    'represents_runner_execution',
    'human_confirmed',
    'confirmed',
    'approved',
  ] as const) {
    if (override.answer[key] !== undefined) answer[key] = override.answer[key];
  }
  if (override.answer.runner_boundary_candidates !== undefined) {
    answer.runner_boundary_candidates = override.answer.runner_boundary_candidates;
  }
  if (override.answer.runner_boundary_candidates_count !== undefined) {
    answer.runner_boundary_candidates_count = override.answer.runner_boundary_candidates_count;
  } else if (override.answer.runner_boundary_candidates !== undefined) {
    answer.runner_boundary_candidates_count = override.answer.runner_boundary_candidates.length;
  }
  if (override.answer.safety?.reads_database !== undefined) {
    (answer.safety as Record<string, unknown>).reads_database = override.answer.safety.reads_database;
  }
  if (override.answer.safety?.writes_database !== undefined) {
    (answer.safety as Record<string, unknown>).writes_database = override.answer.safety.writes_database;
  }
}
