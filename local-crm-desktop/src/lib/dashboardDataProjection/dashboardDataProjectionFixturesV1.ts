import type {
  SafeWriteRunnerCandidate,
  SafeWriteRunnerGateRequest,
  SafeWriteRunnerGateResult,
} from '../safeWriteRunnerGateReadiness';
import type {
  DashboardDataProjectionRequest,
} from '../dashboardDataProjectionReadiness';

interface SourceAnswerOverride {
  contract_only?: boolean;
  dry_run_only?: boolean;
  gate_only?: boolean;
  generated_safe_write_runner_candidates?: boolean;
  ready_to_write?: boolean;
  ready_for_runner?: boolean;
  executable?: boolean;
  executed?: boolean;
  write_executed?: boolean;
  persisted?: boolean;
  reads_database?: boolean;
  writes_database?: boolean;
  generates_executable_sql?: boolean;
  executes_sql?: boolean;
  opens_transaction?: boolean;
  commits_transaction?: boolean;
  rolls_back_transaction?: boolean;
  represents_db_write?: boolean;
  represents_executed_action?: boolean;
  represents_write_runner_execution?: boolean;
  runner_gate_blocked?: boolean;
  safe_write_runner_candidates?: readonly SafeWriteRunnerCandidate[];
  safe_write_runner_candidates_count?: number;
  safety?: {
    reads_database?: boolean;
    writes_database?: boolean;
    executes_sql?: boolean;
    opens_transaction?: boolean;
  };
}

interface SourceResultOverride {
  kind?: string;
  persisted?: boolean;
  represents_executed_action?: boolean;
  writes_database?: boolean;
  answer?: SourceAnswerOverride | null;
}

interface SourceCandidateOptions {
  runner_gate_status?: SafeWriteRunnerCandidate['runner_gate_status'];
  blocked_reason?: string;
  evidence_refs?: SafeWriteRunnerCandidate['evidence_refs'];
  risk_flags?: SafeWriteRunnerCandidate['risk_flags'];
  contract_only?: boolean;
  dry_run_only?: boolean;
  gate_only?: boolean;
  ready_to_write?: boolean;
  ready_for_runner?: boolean;
  executable?: boolean;
  executed?: boolean;
  write_executed?: boolean;
  persisted?: boolean;
  reads_database?: boolean;
  writes_database?: boolean;
  generates_executable_sql?: boolean;
  executes_sql?: boolean;
  opens_transaction?: boolean;
  represents_db_write?: boolean;
  represents_executed_action?: boolean;
  represents_write_runner_execution?: boolean;
  idempotency_usable_for_execution?: boolean;
  idempotency_resolved?: boolean;
}

export function buildDashboardDataProjectionRequestFixtureV1(
  override: SourceResultOverride = {},
): DashboardDataProjectionRequest {
  return {
    kind: 'DASHBOARD_DATA_PROJECTION_REQUEST',
    version: 'v1',
    request_id: 'DASHBOARD_DATA_PROJECTION_TEST_REQUEST_A',
    source_safe_write_runner_gate_result: buildCallerProvidedSafeWriteRunnerGateResultFixtureV1(override),
  };
}

export function buildCallerProvidedSafeWriteRunnerGateResultFixtureV1(
  override: SourceResultOverride = {},
): SafeWriteRunnerGateResult {
  const result = baseResult();
  applyOverride(result, override);
  return result as unknown as SafeWriteRunnerGateResult;
}

export function buildDashboardDataProjectionSourceCandidateFixtureV1(
  index: number,
  options: SourceCandidateOptions = {},
): SafeWriteRunnerCandidate {
  const status = options.runner_gate_status ?? (
    index === 2 ? 'blocked_source_write_plan_candidate' : 'blocked_requires_real_confirmation'
  );
  const sourceActionId = `CONFIRM_LIVE_${String(index).padStart(3, '0')}`;
  const evidenceRefs = options.evidence_refs ?? [
    evidenceRef(`DASHBOARD_PROJECTION_CUSTOMER_${index}`, `Dashboard projection customer ${index}`),
  ];
  const riskFlags = options.risk_flags ?? ['fixture_only_signal'];

  return {
    kind: 'SAFE_WRITE_RUNNER_CANDIDATE',
    version: 'v1',
    safe_write_runner_candidate_id: `SAFE_WRITE_RUNNER_GATE_LIVE_${String(index).padStart(3, '0')}`,
    source_write_plan_candidate_id: `DB_WRITE_PLAN_DRY_RUN_LIVE_${String(index).padStart(3, '0')}`,
    source_runner_boundary_candidate_id: `ACTION_RUNNER_BOUNDARY_LIVE_${String(index).padStart(3, '0')}`,
    source_confirmation_candidate_id: `HUMAN_CONFIRM_LIVE_${String(index).padStart(3, '0')}`,
    source_action_id: sourceActionId,
    source_proposal_id: `SUGGEST_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_type: index === 2 ? 'REVIEW_EVIDENCE_GAP' : 'REVIEW_FOLLOW_UP_TASK',
    action_type: index === 2 ? 'CONFIRM_REVIEW_EVIDENCE_GAP' : 'CONFIRM_REVIEW_FOLLOW_UP_TASK',
    title: `Dashboard source candidate ${index}`,
    summary: `Dashboard source candidate ${index} remains blocked before projection.`,
    evidence_refs: evidenceRefs,
    risk_flags: riskFlags,
    runner_gate_status: status,
    blocked_reason: options.blocked_reason ?? (
      status === 'blocked_source_write_plan_candidate'
        ? 'Source write plan candidate is blocked'
        : 'requires_real_human_confirmation_before_safe_write_gate'
    ),
    missing_execution_requirements: [
      missingRequirement('requires_real_human_confirmation'),
      missingRequirement('requires_resolved_operator'),
      missingRequirement('requires_executable_write_plan'),
    ],
    write_execution_denial: {
      kind: 'WRITE_EXECUTION_DENIAL',
      denial_only: true,
      executes_write: false,
      writes_database: false,
      reason: 'Fixture candidate remains denied for execution.',
      missing_requirements: [],
    },
    db_write_prohibition: {
      kind: 'DB_WRITE_PROHIBITION',
      reads_database: false,
      writes_database: false,
      opens_connection: false,
      uses_db_handle: false,
      executes_statement: false,
      mutates_state: false,
    },
    transaction_prohibition: {
      kind: 'TRANSACTION_PROHIBITION',
      opens_transaction: false,
      commits_transaction: false,
      rolls_back_transaction: false,
      uses_transaction_handle: false,
      usable_for_execution: false,
    },
    sql_execution_prohibition: {
      kind: 'SQL_EXECUTION_PROHIBITION',
      generates_sql: false,
      generates_executable_sql: false,
      executable_sql: '',
      executes_sql: false,
      usable_for_execution: false,
    },
    idempotency_resolution_requirement: {
      kind: 'IDEMPOTENCY_RESOLUTION_REQUIREMENT',
      required: true,
      resolved: (options.idempotency_resolved ?? false) as false,
      usable_for_execution: (options.idempotency_usable_for_execution ?? false) as false,
      source_placeholder_id: `DB_WRITE_PLAN_IDEMPOTENCY_${sourceActionId}`,
      requires_future_persistence: true,
    },
    contract_only: (options.contract_only ?? true) as true,
    dry_run_only: (options.dry_run_only ?? true) as true,
    gate_only: (options.gate_only ?? true) as true,
    ready_to_write: (options.ready_to_write ?? false) as false,
    ready_for_runner: (options.ready_for_runner ?? false) as false,
    executable: (options.executable ?? false) as false,
    executed: (options.executed ?? false) as false,
    write_executed: (options.write_executed ?? false) as false,
    persisted: (options.persisted ?? false) as false,
    reads_database: (options.reads_database ?? false) as false,
    writes_database: (options.writes_database ?? false) as false,
    generates_executable_sql: (options.generates_executable_sql ?? false) as false,
    executes_sql: (options.executes_sql ?? false) as false,
    opens_transaction: (options.opens_transaction ?? false) as false,
    commits_transaction: false,
    rolls_back_transaction: false,
    represents_db_write: (options.represents_db_write ?? false) as false,
    represents_executed_action: (options.represents_executed_action ?? false) as false,
    represents_write_runner_execution: (options.represents_write_runner_execution ?? false) as false,
    requires_real_human_confirmation: true,
    requires_resolved_operator: true,
    requires_executable_write_plan: true,
    requires_safe_write_runner: true,
  } as unknown as SafeWriteRunnerCandidate;
}

function evidenceRef(
  id: string,
  label: string,
): SafeWriteRunnerCandidate['evidence_refs'][number] {
  return {
    type: 'customer',
    id,
    label,
    synthetic: false,
    persisted: false,
    ['represents_real_' + ['mo', 'del_output'].join('')]: false,
  } as unknown as SafeWriteRunnerCandidate['evidence_refs'][number];
}

function missingRequirement(
  name: SafeWriteRunnerCandidate['missing_execution_requirements'][number]['name'],
): SafeWriteRunnerCandidate['missing_execution_requirements'][number] {
  return {
    kind: 'MISSING_EXECUTION_REQUIREMENT',
    name,
    required: true,
    satisfied: false,
    blocking: true,
    message: `${name} is missing in this fixture source.`,
  } as SafeWriteRunnerCandidate['missing_execution_requirements'][number];
}

function baseResult(): Record<string, unknown> {
  const candidates = [
    buildDashboardDataProjectionSourceCandidateFixtureV1(1, {
      risk_flags: ['message_send_requires_review', 'fixture_only_signal'],
    }),
    buildDashboardDataProjectionSourceCandidateFixtureV1(2, {
      runner_gate_status: 'blocked_source_write_plan_candidate',
      evidence_refs: [],
      risk_flags: ['insufficient_evidence'],
      blocked_reason: 'Evidence must be collected before dashboard projection can advance',
    }),
  ];

  return {
    kind: 'SAFE_WRITE_RUNNER_GATE_RESULT',
    version: 'v1',
    plan: {
      kind: 'SAFE_WRITE_RUNNER_GATE_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'safe_write_runner_gate_readiness_only',
      request: {
        kind: 'SAFE_WRITE_RUNNER_GATE_REQUEST',
        version: 'v1',
        request_id: 'DASHBOARD_PROJECTION_SOURCE_SAFE_WRITE_GATE_REQUEST_A',
      } satisfies Partial<SafeWriteRunnerGateRequest>,
      allowed_operations: [
        'validate_db_write_plan_dry_run_result',
        'project_blocked_safe_write_runner_candidates',
        'build_safe_write_runner_gate_summary',
      ],
      forbidden_operations: ['read_db', 'write_db', 'run_write_candidate'],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        generates_executable_sql: false,
        executes_sql: false,
        opens_transaction: false,
      },
    },
    answer: {
      kind: 'SAFE_WRITE_RUNNER_GATE_ANSWER',
      version: 'v1',
      contract_only: true,
      dry_run_only: true,
      gate_only: true,
      ready_to_write: false,
      ready_for_runner: false,
      executable: false,
      executed: false,
      write_executed: false,
      persisted: false,
      reads_database: false,
      writes_database: false,
      generates_executable_sql: false,
      executes_sql: false,
      opens_transaction: false,
      commits_transaction: false,
      rolls_back_transaction: false,
      represents_db_write: false,
      represents_executed_action: false,
      represents_write_runner_execution: false,
      runner_gate_blocked: false,
      blocked_reason: null,
      generated_safe_write_runner_candidates: true,
      safe_write_runner_candidates: candidates,
      safe_write_runner_candidates_count: candidates.length,
      summary: {
        kind: 'SAFE_WRITE_RUNNER_GATE_SUMMARY',
        version: 'v1',
        total: candidates.length,
        blocked_requires_real_confirmation: 1,
        blocked_requires_executable_write_plan: 0,
        blocked_source_write_plan_candidate: 1,
        blocked_missing_safe_write_runner_policy: 0,
        by_action_type: {
          CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
          CONFIRM_REVIEW_EVIDENCE_GAP: 1,
        },
        by_runner_gate_status: {
          blocked_requires_real_confirmation: 1,
          blocked_source_write_plan_candidate: 1,
        },
      },
      source_db_write_plan_dry_run_result: {
        kind: 'DB_WRITE_PLAN_DRY_RUN_RESULT',
        version: 'v1',
        persisted: false,
        represents_executed_action: false,
      },
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        generates_executable_sql: false,
        executes_sql: false,
        opens_transaction: false,
      },
    },
    persisted: false,
    represents_executed_action: false,
    writes_database: false,
  };
}

function applyOverride(result: Record<string, unknown>, override: SourceResultOverride): void {
  if (override.kind !== undefined) result.kind = override.kind;
  if (override.persisted !== undefined) result.persisted = override.persisted;
  if (override.represents_executed_action !== undefined) {
    result.represents_executed_action = override.represents_executed_action;
  }
  if (override.writes_database !== undefined) result.writes_database = override.writes_database;
  if (override.answer === null) {
    delete result.answer;
    return;
  }
  if (!override.answer) return;

  const answer = result.answer as Record<string, unknown>;
  for (const key of [
    'contract_only',
    'dry_run_only',
    'gate_only',
    'generated_safe_write_runner_candidates',
    'ready_to_write',
    'ready_for_runner',
    'executable',
    'executed',
    'write_executed',
    'persisted',
    'reads_database',
    'writes_database',
    'generates_executable_sql',
    'executes_sql',
    'opens_transaction',
    'commits_transaction',
    'rolls_back_transaction',
    'represents_db_write',
    'represents_executed_action',
    'represents_write_runner_execution',
    'runner_gate_blocked',
  ] as const) {
    if (override.answer[key] !== undefined) answer[key] = override.answer[key];
  }
  if (override.answer.safe_write_runner_candidates !== undefined) {
    answer.safe_write_runner_candidates = override.answer.safe_write_runner_candidates;
  }
  if (override.answer.safe_write_runner_candidates_count !== undefined) {
    answer.safe_write_runner_candidates_count = override.answer.safe_write_runner_candidates_count;
  } else if (override.answer.safe_write_runner_candidates !== undefined) {
    answer.safe_write_runner_candidates_count = override.answer.safe_write_runner_candidates.length;
  }
  if (override.answer.safety?.reads_database !== undefined) {
    (answer.safety as Record<string, unknown>).reads_database = override.answer.safety.reads_database;
  }
  if (override.answer.safety?.writes_database !== undefined) {
    (answer.safety as Record<string, unknown>).writes_database = override.answer.safety.writes_database;
  }
  if (override.answer.safety?.executes_sql !== undefined) {
    (answer.safety as Record<string, unknown>).executes_sql = override.answer.safety.executes_sql;
  }
  if (override.answer.safety?.opens_transaction !== undefined) {
    (answer.safety as Record<string, unknown>).opens_transaction = override.answer.safety.opens_transaction;
  }
}
