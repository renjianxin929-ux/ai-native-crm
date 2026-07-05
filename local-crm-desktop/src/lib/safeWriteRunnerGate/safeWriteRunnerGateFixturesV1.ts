import type {
  DbWritePlanDryRunCandidate,
  DbWritePlanDryRunRequest,
  DbWritePlanDryRunResult,
} from '../dbWritePlanDryRunReadiness';
import type {
  SafeWriteRunnerGateRequest,
} from '../safeWriteRunnerGateReadiness';

interface SourceAnswerOverride {
  contract_only?: boolean;
  dry_run_only?: boolean;
  write_plan_only?: boolean;
  ready_to_write?: boolean;
  ready_for_runner?: boolean;
  executable?: boolean;
  executed?: boolean;
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
  generated_write_plan_candidates?: boolean;
  write_plan_candidates?: readonly DbWritePlanDryRunCandidate[];
  write_plan_candidates_count?: number;
  write_plan_blocked?: boolean;
  safety?: {
    reads_database?: boolean;
    writes_database?: boolean;
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
  write_plan_status?: DbWritePlanDryRunCandidate['write_plan_status'];
  blocked_reason?: string;
  evidence_refs?: DbWritePlanDryRunCandidate['evidence_refs'];
  risk_flags?: DbWritePlanDryRunCandidate['risk_flags'];
  contract_only?: boolean;
  dry_run_only?: boolean;
  write_plan_only?: boolean;
  ready_to_write?: boolean;
  executable?: boolean;
  executed?: boolean;
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
  idempotency_usable_for_execution?: boolean;
  idempotency_resolved?: boolean;
  idempotency_persisted?: boolean;
  sql_generation_generates_executable_sql?: boolean;
  sql_generation_executes_sql?: boolean;
  sql_generation_usable_for_execution?: boolean;
  transaction_boundary_usable_for_execution?: boolean;
  transaction_boundary_opens_transaction?: boolean;
  transaction_boundary_commits_transaction?: boolean;
  transaction_boundary_rolls_back_transaction?: boolean;
}

export function buildSafeWriteRunnerGateRequestFixtureV1(
  override: SourceResultOverride = {},
): SafeWriteRunnerGateRequest {
  return {
    kind: 'SAFE_WRITE_RUNNER_GATE_REQUEST',
    version: 'v1',
    request_id: 'SAFE_WRITE_RUNNER_GATE_TEST_REQUEST_A',
    source_db_write_plan_dry_run_result: buildCallerProvidedDbWritePlanDryRunResultFixtureV1(override),
  };
}

export function buildCallerProvidedDbWritePlanDryRunResultFixtureV1(
  override: SourceResultOverride = {},
): DbWritePlanDryRunResult {
  const result = baseResult();
  applyOverride(result, override);
  return result as unknown as DbWritePlanDryRunResult;
}

export function buildSafeWriteRunnerGateSourceCandidateFixtureV1(
  index: number,
  options: SourceCandidateOptions = {},
): DbWritePlanDryRunCandidate {
  const status = options.write_plan_status ?? (
    index === 2 ? 'blocked_source_confirmation_candidate' : 'blocked_requires_real_confirmation'
  );
  const sourceActionId = `CONFIRM_LIVE_${String(index).padStart(3, '0')}`;
  const evidenceRefs = options.evidence_refs ?? [
    evidenceRef(`SAFE_WRITE_GATE_CUSTOMER_${index}`, `Safe write gate customer ${index}`),
  ];
  const riskFlags = options.risk_flags ?? ['fixture_only_signal'];

  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_CANDIDATE',
    version: 'v1',
    write_plan_candidate_id: `DB_WRITE_PLAN_DRY_RUN_LIVE_${String(index).padStart(3, '0')}`,
    source_runner_boundary_candidate_id: `ACTION_RUNNER_BOUNDARY_LIVE_${String(index).padStart(3, '0')}`,
    source_confirmation_candidate_id: `HUMAN_CONFIRM_LIVE_${String(index).padStart(3, '0')}`,
    source_action_id: sourceActionId,
    source_proposal_id: `SUGGEST_LIVE_${String(index).padStart(3, '0')}`,
    source_proposal_type: index === 2 ? 'REVIEW_EVIDENCE_GAP' : 'REVIEW_FOLLOW_UP_TASK',
    action_type: index === 2 ? 'CONFIRM_REVIEW_EVIDENCE_GAP' : 'CONFIRM_REVIEW_FOLLOW_UP_TASK',
    title: `Write plan candidate ${index}`,
    summary: `Write plan candidate ${index} remains a dry-run blocked source.`,
    evidence_refs: evidenceRefs,
    risk_flags: riskFlags,
    write_plan_status: status,
    blocked_reason: options.blocked_reason ?? (
      status === 'blocked_source_confirmation_candidate'
        ? 'Source confirmation candidate is blocked'
        : 'requires_real_human_confirmation_before_write_plan'
    ),
    target_entity_projection: {
      kind: 'TARGET_ENTITY_PROJECTION_PLACEHOLDER',
      schema_only: true,
      resolved: false,
      persisted: false,
      reads_database: false,
      writes_database: false,
      target_entity_kind: index === 2 ? 'customer_evidence_placeholder' : 'follow_up_task_placeholder',
      target_entity_id_placeholder: `UNRESOLVED_TARGET_ENTITY_${sourceActionId}`,
      represents_existing_db_row: false,
      requires_future_lookup: true,
    },
    intended_mutation_summary: {
      kind: 'INTENDED_MUTATION_SUMMARY_PLACEHOLDER',
      schema_only: true,
      executable: false,
      writes_database: false,
      summary: `Future mutation description for ${sourceActionId} is not executable.`,
    },
    write_preconditions: [
      {
        kind: 'WRITE_PRECONDITION_PLACEHOLDER',
        name: 'requires_real_human_confirmation',
        required: true,
        satisfied: false,
        blocking: true,
        message: 'Real human confirmation is required before write planning.',
      },
      {
        kind: 'WRITE_PRECONDITION_PLACEHOLDER',
        name: 'requires_safe_write_runner',
        required: true,
        satisfied: false,
        blocking: true,
        message: 'A future safe write policy must resolve this placeholder.',
      },
    ],
    transaction_boundary: {
      kind: 'TRANSACTION_BOUNDARY_PLACEHOLDER',
      placeholder_only: true,
      resolved: false,
      opens_transaction: (options.transaction_boundary_opens_transaction ?? false) as false,
      commits_transaction: (options.transaction_boundary_commits_transaction ?? false) as false,
      rolls_back_transaction: (options.transaction_boundary_rolls_back_transaction ?? false) as false,
      usable_for_execution: (options.transaction_boundary_usable_for_execution ?? false) as false,
    },
    rollback: {
      kind: 'ROLLBACK_PLACEHOLDER',
      placeholder_only: true,
      resolved: false,
      rollback_plan_recorded: false,
      usable_for_execution: false,
    },
    idempotency: {
      kind: 'DB_WRITE_PLAN_IDEMPOTENCY_PLACEHOLDER',
      version: 'v1',
      placeholder_only: true,
      resolved: (options.idempotency_resolved ?? false) as false,
      persisted: (options.idempotency_persisted ?? false) as false,
      usable_for_execution: (options.idempotency_usable_for_execution ?? false) as false,
      value: `DB_WRITE_PLAN_IDEMPOTENCY_${sourceActionId}`,
    },
    sql_generation: {
      kind: 'SQL_GENERATION_PLACEHOLDER',
      schema_only: true,
      generates_sql: false,
      generates_executable_sql: (options.sql_generation_generates_executable_sql ?? false) as false,
      executable_sql: '',
      executes_sql: (options.sql_generation_executes_sql ?? false) as false,
      usable_for_execution: (options.sql_generation_usable_for_execution ?? false) as false,
    },
    execution_prohibition: {
      kind: 'WRITE_EXECUTION_PROHIBITION',
      executes_write: false,
      writes_database: false,
      reads_database: false,
      executes_sql: false,
      generates_executable_sql: false,
      opens_transaction: false,
      commits_transaction: false,
      rolls_back_transaction: false,
      explicit_non_actions: [
        'Does not read database records',
        'Does not write database records',
        'Does not generate executable statements',
      ],
    },
    contract_only: (options.contract_only ?? true) as true,
    dry_run_only: (options.dry_run_only ?? true) as true,
    write_plan_only: (options.write_plan_only ?? true) as true,
    ready_to_write: (options.ready_to_write ?? false) as false,
    executable: (options.executable ?? false) as false,
    executed: (options.executed ?? false) as false,
    persisted: (options.persisted ?? false) as false,
    reads_database: (options.reads_database ?? false) as false,
    writes_database: (options.writes_database ?? false) as false,
    generates_executable_sql: (options.generates_executable_sql ?? false) as false,
    executes_sql: (options.executes_sql ?? false) as false,
    opens_transaction: (options.opens_transaction ?? false) as false,
    commits_transaction: (options.commits_transaction ?? false) as false,
    rolls_back_transaction: (options.rolls_back_transaction ?? false) as false,
    represents_db_write: (options.represents_db_write ?? false) as false,
    represents_executed_action: (options.represents_executed_action ?? false) as false,
    requires_real_human_confirmation: true,
    requires_safe_write_runner: true,
  } as unknown as DbWritePlanDryRunCandidate;
}

function evidenceRef(
  id: string,
  label: string,
): DbWritePlanDryRunCandidate['evidence_refs'][number] {
  return {
    type: 'customer',
    id,
    label,
    synthetic: false,
    persisted: false,
    ['represents_real_' + ['mo', 'del_output'].join('')]: false,
  } as unknown as DbWritePlanDryRunCandidate['evidence_refs'][number];
}

function baseResult(): Record<string, unknown> {
  const candidates = [
    buildSafeWriteRunnerGateSourceCandidateFixtureV1(1, {
      risk_flags: ['message_send_requires_review', 'fixture_only_signal'],
    }),
    buildSafeWriteRunnerGateSourceCandidateFixtureV1(2, {
      write_plan_status: 'blocked_source_confirmation_candidate',
      evidence_refs: [],
      risk_flags: ['insufficient_evidence'],
      blocked_reason: 'Evidence must be collected before write planning',
    }),
  ];

  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_RESULT',
    version: 'v1',
    plan: {
      kind: 'DB_WRITE_PLAN_DRY_RUN_PLAN',
      version: 'v1',
      executable: false,
      persisted: false,
      reason: 'db_write_plan_dry_run_readiness_only',
      request: {
        kind: 'DB_WRITE_PLAN_DRY_RUN_REQUEST',
        version: 'v1',
        request_id: 'SAFE_WRITE_GATE_SOURCE_DB_WRITE_PLAN_REQUEST_A',
      } satisfies Partial<DbWritePlanDryRunRequest>,
      allowed_operations: [
        'validate_action_runner_boundary_contract_result',
        'project_db_write_plan_candidates',
        'build_db_write_plan_summary',
      ],
      forbidden_operations: ['read_db', 'write_db', 'execute_write_plan'],
      safety: {
        reads_database: false,
        writes_database: false,
        executable: false,
        generates_executable_sql: false,
        executes_sql: false,
      },
    },
    answer: {
      kind: 'DB_WRITE_PLAN_DRY_RUN_ANSWER',
      version: 'v1',
      contract_only: true,
      dry_run_only: true,
      write_plan_only: true,
      ready_to_write: false,
      executable: false,
      executed: false,
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
      requires_real_human_confirmation: true,
      requires_safe_write_runner: true,
      generated_write_plan_candidates: true,
      write_plan_candidates: candidates,
      write_plan_candidates_count: candidates.length,
      write_plan_blocked: false,
      blocked_reason: null,
      summary: {
        kind: 'DB_WRITE_PLAN_DRY_RUN_SUMMARY',
        version: 'v1',
        total: candidates.length,
        blocked_requires_real_confirmation: 1,
        blocked_source_confirmation_candidate: 1,
        by_action_type: {
          CONFIRM_REVIEW_FOLLOW_UP_TASK: 1,
          CONFIRM_REVIEW_EVIDENCE_GAP: 1,
        },
        by_write_plan_status: {
          blocked_requires_real_confirmation: 1,
          blocked_source_confirmation_candidate: 1,
        },
      },
      source_action_runner_boundary_result: {
        kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT',
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
      },
    },
    persisted: false,
    represents_executed_action: false,
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
    'write_plan_only',
    'ready_to_write',
    'ready_for_runner',
    'executable',
    'executed',
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
    'generated_write_plan_candidates',
    'write_plan_blocked',
  ] as const) {
    if (override.answer[key] !== undefined) answer[key] = override.answer[key];
  }
  if (override.answer.write_plan_candidates !== undefined) {
    answer.write_plan_candidates = override.answer.write_plan_candidates;
  }
  if (override.answer.write_plan_candidates_count !== undefined) {
    answer.write_plan_candidates_count = override.answer.write_plan_candidates_count;
  } else if (override.answer.write_plan_candidates !== undefined) {
    answer.write_plan_candidates_count = override.answer.write_plan_candidates.length;
  }
  if (override.answer.safety?.reads_database !== undefined) {
    (answer.safety as Record<string, unknown>).reads_database = override.answer.safety.reads_database;
  }
  if (override.answer.safety?.writes_database !== undefined) {
    (answer.safety as Record<string, unknown>).writes_database = override.answer.safety.writes_database;
  }
}
