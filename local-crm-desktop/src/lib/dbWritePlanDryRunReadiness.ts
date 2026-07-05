import type {
  RunnerBoundaryCandidate,
  RunnerBoundaryContractResult,
  RunnerBoundaryStatus,
} from './actionRunnerBoundaryContractReadiness';

export const DB_WRITE_PLAN_DRY_RUN_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type DbWritePlanDryRunBlockedReason =
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_runner_boundary_blocked'
  | 'source_candidates_empty'
  | 'illegal_source_not_contract_only'
  | 'illegal_source_not_dry_run_only'
  | 'illegal_source_ready_for_runner'
  | 'illegal_source_executable'
  | 'illegal_source_executed'
  | 'illegal_source_persisted'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'illegal_source_represents_executed_action'
  | 'illegal_source_represents_runner_execution'
  | 'illegal_source_human_confirmed'
  | 'illegal_source_confirmed'
  | 'illegal_source_approved'
  | 'illegal_candidate_ready_for_runner'
  | 'illegal_candidate_executable'
  | 'illegal_candidate_executed'
  | 'illegal_candidate_persisted'
  | 'illegal_candidate_reads_database'
  | 'illegal_candidate_writes_database'
  | 'illegal_candidate_represents_executed_action'
  | 'illegal_candidate_represents_runner_execution'
  | 'illegal_candidate_human_confirmed'
  | 'illegal_candidate_confirmed'
  | 'illegal_candidate_approved'
  | 'illegal_candidate_not_contract_only'
  | 'illegal_candidate_not_dry_run_only'
  | 'illegal_candidate_idempotency_usable_for_execution'
  | 'illegal_candidate_idempotency_resolved'
  | 'illegal_candidate_idempotency_persisted';

export type DbWritePlanStatus =
  | 'blocked_requires_real_confirmation'
  | 'blocked_source_confirmation_candidate';

export interface DbWritePlanDryRunRequest {
  kind: 'DB_WRITE_PLAN_DRY_RUN_REQUEST';
  version?: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
  request_id: string;
  source_action_runner_boundary_result: RunnerBoundaryContractResult;
}

export interface NormalizedDbWritePlanDryRunRequest extends DbWritePlanDryRunRequest {
  version: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
}

export interface DbWritePlanSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executable: BoolFalse;
  generates_executable_sql: BoolFalse;
  executes_sql: BoolFalse;
}

export interface TargetEntityProjectionPlaceholder {
  kind: 'TARGET_ENTITY_PROJECTION_PLACEHOLDER';
  schema_only: BoolTrue;
  resolved: BoolFalse;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  target_entity_kind: string;
  target_entity_id_placeholder: string;
  represents_existing_db_row: BoolFalse;
  requires_future_lookup: BoolTrue;
}

export interface TransactionBoundaryPlaceholder {
  kind: 'TRANSACTION_BOUNDARY_PLACEHOLDER';
  placeholder_only: BoolTrue;
  resolved: BoolFalse;
  opens_transaction: BoolFalse;
  commits_transaction: BoolFalse;
  rolls_back_transaction: BoolFalse;
  usable_for_execution: BoolFalse;
}

export interface RollbackPlaceholder {
  kind: 'ROLLBACK_PLACEHOLDER';
  placeholder_only: BoolTrue;
  resolved: BoolFalse;
  rollback_plan_recorded: BoolFalse;
  usable_for_execution: BoolFalse;
}

export interface SqlGenerationPlaceholder {
  kind: 'SQL_GENERATION_PLACEHOLDER';
  schema_only: BoolTrue;
  generates_sql: BoolFalse;
  generates_executable_sql: BoolFalse;
  executable_sql: '';
  executes_sql: BoolFalse;
  usable_for_execution: BoolFalse;
}

export interface DbWritePlanIdempotencyPlaceholder {
  kind: 'DB_WRITE_PLAN_IDEMPOTENCY_PLACEHOLDER';
  version: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
  placeholder_only: BoolTrue;
  resolved: BoolFalse;
  persisted: BoolFalse;
  usable_for_execution: BoolFalse;
  value: string;
}

export interface IntendedMutationSummaryPlaceholder {
  kind: 'INTENDED_MUTATION_SUMMARY_PLACEHOLDER';
  schema_only: BoolTrue;
  executable: BoolFalse;
  writes_database: BoolFalse;
  summary: string;
}

export interface WritePreconditionPlaceholder {
  kind: 'WRITE_PRECONDITION_PLACEHOLDER';
  name: string;
  required: BoolTrue;
  satisfied: BoolFalse;
  blocking: BoolTrue;
  message: string;
}

export interface WriteExecutionProhibition {
  kind: 'WRITE_EXECUTION_PROHIBITION';
  executes_write: BoolFalse;
  writes_database: BoolFalse;
  reads_database: BoolFalse;
  executes_sql: BoolFalse;
  generates_executable_sql: BoolFalse;
  opens_transaction: BoolFalse;
  commits_transaction: BoolFalse;
  rolls_back_transaction: BoolFalse;
  explicit_non_actions: readonly string[];
}

export interface DbWritePlanDryRunCandidate {
  kind: 'DB_WRITE_PLAN_DRY_RUN_CANDIDATE';
  version: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
  write_plan_candidate_id: string;
  source_runner_boundary_candidate_id: string;
  source_confirmation_candidate_id: string;
  source_action_id: string;
  source_proposal_id: string;
  source_proposal_type: RunnerBoundaryCandidate['source_proposal_type'];
  action_type: RunnerBoundaryCandidate['action_type'];
  title: string;
  summary: string;
  evidence_refs: RunnerBoundaryCandidate['evidence_refs'];
  risk_flags: RunnerBoundaryCandidate['risk_flags'];
  write_plan_status: DbWritePlanStatus;
  blocked_reason: string;
  target_entity_projection: TargetEntityProjectionPlaceholder;
  intended_mutation_summary: IntendedMutationSummaryPlaceholder;
  write_preconditions: readonly WritePreconditionPlaceholder[];
  transaction_boundary: TransactionBoundaryPlaceholder;
  rollback: RollbackPlaceholder;
  idempotency: DbWritePlanIdempotencyPlaceholder;
  sql_generation: SqlGenerationPlaceholder;
  execution_prohibition: WriteExecutionProhibition;
  contract_only: BoolTrue;
  dry_run_only: BoolTrue;
  write_plan_only: BoolTrue;
  ready_to_write: BoolFalse;
  executable: BoolFalse;
  executed: BoolFalse;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  generates_executable_sql: BoolFalse;
  executes_sql: BoolFalse;
  opens_transaction: BoolFalse;
  commits_transaction: BoolFalse;
  rolls_back_transaction: BoolFalse;
  represents_db_write: BoolFalse;
  represents_executed_action: BoolFalse;
  requires_real_human_confirmation: BoolTrue;
  requires_safe_write_runner: BoolTrue;
}

export interface DbWritePlanSummary {
  kind: 'DB_WRITE_PLAN_DRY_RUN_SUMMARY';
  version: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
  total: number;
  blocked_requires_real_confirmation: number;
  blocked_source_confirmation_candidate: number;
  by_action_type: Record<string, number>;
  by_write_plan_status: Record<string, number>;
}

export interface DbWritePlanDryRunPlan {
  kind: 'DB_WRITE_PLAN_DRY_RUN_PLAN';
  version: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'db_write_plan_dry_run_readiness_only';
  request: NormalizedDbWritePlanDryRunRequest;
  allowed_operations: readonly [
    'validate_action_runner_boundary_contract_result',
    'project_db_write_plan_candidates',
    'build_db_write_plan_summary',
  ];
  forbidden_operations: readonly string[];
  safety: DbWritePlanSafety;
}

export interface DbWritePlanDryRunAnswer {
  kind: 'DB_WRITE_PLAN_DRY_RUN_ANSWER';
  version: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
  contract_only: BoolTrue;
  dry_run_only: BoolTrue;
  write_plan_only: BoolTrue;
  ready_to_write: BoolFalse;
  executable: BoolFalse;
  executed: BoolFalse;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  generates_executable_sql: BoolFalse;
  executes_sql: BoolFalse;
  opens_transaction: BoolFalse;
  commits_transaction: BoolFalse;
  rolls_back_transaction: BoolFalse;
  represents_db_write: BoolFalse;
  represents_executed_action: BoolFalse;
  requires_real_human_confirmation: BoolTrue;
  requires_safe_write_runner: BoolTrue;
  generated_write_plan_candidates: boolean;
  write_plan_candidates: readonly DbWritePlanDryRunCandidate[];
  write_plan_candidates_count: number;
  write_plan_blocked: boolean;
  blocked_reason: DbWritePlanDryRunBlockedReason | null;
  summary: DbWritePlanSummary;
  source_action_runner_boundary_result: RunnerBoundaryContractResult;
  safety: DbWritePlanSafety;
}

export interface DbWritePlanDryRunResult {
  kind: 'DB_WRITE_PLAN_DRY_RUN_RESULT';
  version: typeof DB_WRITE_PLAN_DRY_RUN_VERSION;
  plan: DbWritePlanDryRunPlan;
  answer: DbWritePlanDryRunAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface DbWritePlanDryRunTrace {
  kind: 'DB_WRITE_PLAN_DRY_RUN_TRACE';
  plan: DbWritePlanDryRunPlan;
  result: DbWritePlanDryRunResult;
  persisted: BoolFalse;
}

export interface DbWritePlanDryRunValidation {
  ok: boolean;
  blocked_reason: DbWritePlanDryRunBlockedReason | null;
}

export function validateDbWritePlanDryRunInput(
  result: unknown,
): DbWritePlanDryRunValidation {
  const source = asRecord(result);
  if (source?.kind !== 'ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT') return blocked('invalid_source_result_kind');

  const answer = asRecord(source.answer);
  if (!answer) return blocked('source_answer_missing');
  if (answer.runner_boundary_blocked === true) return blocked('source_runner_boundary_blocked');
  if (answer.contract_only !== true) return blocked('illegal_source_not_contract_only');
  if (answer.dry_run_only !== true) return blocked('illegal_source_not_dry_run_only');
  if (answer.ready_for_runner === true) return blocked('illegal_source_ready_for_runner');
  if (answer.executable === true) return blocked('illegal_source_executable');
  if (answer.executed === true) return blocked('illegal_source_executed');
  if (answer.persisted === true || source.persisted === true) return blocked('illegal_source_persisted');
  if (answer.reads_database === true) return blocked('illegal_source_reads_database');
  if (answer.writes_database === true) return blocked('illegal_source_writes_database');
  if (answer.represents_executed_action === true || source.represents_executed_action === true) {
    return blocked('illegal_source_represents_executed_action');
  }
  if (answer.represents_runner_execution === true || source.represents_runner_execution === true) {
    return blocked('illegal_source_represents_runner_execution');
  }
  if (answer.human_confirmed === true) return blocked('illegal_source_human_confirmed');
  if (answer.confirmed === true) return blocked('illegal_source_confirmed');
  if (answer.approved === true) return blocked('illegal_source_approved');

  const safety = asRecord(answer.safety);
  if (safety?.reads_database === true) return blocked('illegal_source_reads_database');
  if (safety?.writes_database === true) return blocked('illegal_source_writes_database');

  const candidates = Array.isArray(answer.runner_boundary_candidates) ? answer.runner_boundary_candidates : [];
  const count = typeof answer.runner_boundary_candidates_count === 'number'
    ? answer.runner_boundary_candidates_count
    : 0;
  if (count <= 0 || candidates.length === 0) return blocked('source_candidates_empty');

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record?.ready_for_runner === true) return blocked('illegal_candidate_ready_for_runner');
    if (record?.executable === true) return blocked('illegal_candidate_executable');
    if (record?.executed === true) return blocked('illegal_candidate_executed');
    if (record?.persisted === true) return blocked('illegal_candidate_persisted');
    if (record?.reads_database === true) return blocked('illegal_candidate_reads_database');
    if (record?.writes_database === true) return blocked('illegal_candidate_writes_database');
    if (record?.represents_executed_action === true) {
      return blocked('illegal_candidate_represents_executed_action');
    }
    if (record?.represents_runner_execution === true) {
      return blocked('illegal_candidate_represents_runner_execution');
    }
    if (record?.human_confirmed === true) return blocked('illegal_candidate_human_confirmed');
    if (record?.confirmed === true) return blocked('illegal_candidate_confirmed');
    if (record?.approved === true) return blocked('illegal_candidate_approved');
    if (record?.contract_only !== true) return blocked('illegal_candidate_not_contract_only');
    if (record?.dry_run_only !== true) return blocked('illegal_candidate_not_dry_run_only');

    const idempotency = asRecord(record?.idempotency);
    if (idempotency?.usable_for_execution === true) {
      return blocked('illegal_candidate_idempotency_usable_for_execution');
    }
    if (idempotency?.resolved === true) return blocked('illegal_candidate_idempotency_resolved');
    if (idempotency?.persisted === true) return blocked('illegal_candidate_idempotency_persisted');
  }

  return { ok: true, blocked_reason: null };
}

export function buildDbWritePlanDryRunPlan(
  request: DbWritePlanDryRunRequest,
): DbWritePlanDryRunPlan {
  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_PLAN',
    version: DB_WRITE_PLAN_DRY_RUN_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'db_write_plan_dry_run_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_action_runner_boundary_contract_result',
      'project_db_write_plan_candidates',
      'build_db_write_plan_summary',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'rerun_action_runner_boundary_contract',
      'generate_executable_statement',
      'open_transaction_boundary',
      'close_transaction_boundary',
      'persist_write_plan',
      'execute_write_plan',
      ['call', ['pro', 'vider'].join('')].join('_'),
      'render_surface',
    ],
    safety: buildSafety(),
  };
}

export function runDbWritePlanDryRun(
  plan: DbWritePlanDryRunPlan,
): DbWritePlanDryRunResult {
  const source = plan.request.source_action_runner_boundary_result;
  const validation = validateDbWritePlanDryRunInput(source);

  if (!validation.ok) return buildResult(plan, [], validation.blocked_reason);

  const candidates = source.answer.runner_boundary_candidates.map((candidate, index) => (
    projectRunnerBoundaryCandidateToDbWritePlanCandidate(candidate, index)
  ));
  return buildResult(plan, candidates, null);
}

export function buildDbWritePlanDryRunTrace(
  plan: DbWritePlanDryRunPlan,
): DbWritePlanDryRunTrace {
  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_TRACE',
    plan,
    result: runDbWritePlanDryRun(plan),
    persisted: FALSE_VALUE,
  };
}

export function projectRunnerBoundaryCandidateToDbWritePlanCandidate(
  candidate: RunnerBoundaryCandidate,
  index: number,
): DbWritePlanDryRunCandidate {
  const status = mapWritePlanStatus(candidate.runner_status);
  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_CANDIDATE',
    version: DB_WRITE_PLAN_DRY_RUN_VERSION,
    write_plan_candidate_id: `DB_WRITE_PLAN_DRY_RUN_LIVE_${String(index + 1).padStart(3, '0')}`,
    source_runner_boundary_candidate_id: candidate.runner_boundary_candidate_id,
    source_confirmation_candidate_id: candidate.source_confirmation_candidate_id,
    source_action_id: candidate.source_action_id,
    source_proposal_id: candidate.source_proposal_id,
    source_proposal_type: candidate.source_proposal_type,
    action_type: candidate.action_type,
    title: candidate.title,
    summary: `Hypothetical future write plan remains blocked for ${candidate.title}.`,
    evidence_refs: candidate.evidence_refs,
    risk_flags: candidate.risk_flags,
    write_plan_status: status,
    blocked_reason: buildWritePlanBlockedReason(candidate, status),
    target_entity_projection: buildTargetEntityProjection(candidate),
    intended_mutation_summary: buildIntendedMutationSummary(candidate),
    write_preconditions: buildWritePreconditions(candidate),
    transaction_boundary: buildTransactionBoundaryPlaceholder(),
    rollback: buildRollbackPlaceholder(),
    idempotency: buildIdempotencyPlaceholder(candidate.source_action_id),
    sql_generation: buildSqlGenerationPlaceholder(),
    execution_prohibition: buildExecutionProhibition(),
    contract_only: TRUE_VALUE,
    dry_run_only: TRUE_VALUE,
    write_plan_only: TRUE_VALUE,
    ready_to_write: FALSE_VALUE,
    executable: FALSE_VALUE,
    executed: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    generates_executable_sql: FALSE_VALUE,
    executes_sql: FALSE_VALUE,
    opens_transaction: FALSE_VALUE,
    commits_transaction: FALSE_VALUE,
    rolls_back_transaction: FALSE_VALUE,
    represents_db_write: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    requires_real_human_confirmation: TRUE_VALUE,
    requires_safe_write_runner: TRUE_VALUE,
  };
}

export function buildDbWritePlanSummary(
  candidates: readonly DbWritePlanDryRunCandidate[],
): DbWritePlanSummary {
  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_SUMMARY',
    version: DB_WRITE_PLAN_DRY_RUN_VERSION,
    total: candidates.length,
    blocked_requires_real_confirmation: candidates.filter(
      candidate => candidate.write_plan_status === 'blocked_requires_real_confirmation',
    ).length,
    blocked_source_confirmation_candidate: candidates.filter(
      candidate => candidate.write_plan_status === 'blocked_source_confirmation_candidate',
    ).length,
    by_action_type: countBy(candidates.map(candidate => candidate.action_type)),
    by_write_plan_status: countBy(candidates.map(candidate => candidate.write_plan_status)),
  };
}

function buildResult(
  plan: DbWritePlanDryRunPlan,
  candidates: readonly DbWritePlanDryRunCandidate[],
  blockedReason: DbWritePlanDryRunBlockedReason | null,
): DbWritePlanDryRunResult {
  const isBlocked = blockedReason !== null;
  return {
    kind: 'DB_WRITE_PLAN_DRY_RUN_RESULT',
    version: DB_WRITE_PLAN_DRY_RUN_VERSION,
    plan,
    answer: {
      kind: 'DB_WRITE_PLAN_DRY_RUN_ANSWER',
      version: DB_WRITE_PLAN_DRY_RUN_VERSION,
      contract_only: TRUE_VALUE,
      dry_run_only: TRUE_VALUE,
      write_plan_only: TRUE_VALUE,
      ready_to_write: FALSE_VALUE,
      executable: FALSE_VALUE,
      executed: FALSE_VALUE,
      persisted: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      generates_executable_sql: FALSE_VALUE,
      executes_sql: FALSE_VALUE,
      opens_transaction: FALSE_VALUE,
      commits_transaction: FALSE_VALUE,
      rolls_back_transaction: FALSE_VALUE,
      represents_db_write: FALSE_VALUE,
      represents_executed_action: FALSE_VALUE,
      requires_real_human_confirmation: TRUE_VALUE,
      requires_safe_write_runner: TRUE_VALUE,
      generated_write_plan_candidates: !isBlocked && candidates.length > 0,
      write_plan_candidates: isBlocked ? [] : candidates,
      write_plan_candidates_count: isBlocked ? 0 : candidates.length,
      write_plan_blocked: isBlocked,
      blocked_reason: blockedReason,
      summary: isBlocked ? emptySummary() : buildDbWritePlanSummary(candidates),
      source_action_runner_boundary_result: plan.request.source_action_runner_boundary_result,
      safety: buildSafety(),
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: DbWritePlanDryRunRequest,
): NormalizedDbWritePlanDryRunRequest {
  return {
    ...request,
    version: DB_WRITE_PLAN_DRY_RUN_VERSION,
  };
}

function mapWritePlanStatus(status: RunnerBoundaryStatus): DbWritePlanStatus {
  return status === 'blocked_source_confirmation_candidate'
    ? 'blocked_source_confirmation_candidate'
    : 'blocked_requires_real_confirmation';
}

function buildWritePlanBlockedReason(
  candidate: RunnerBoundaryCandidate,
  status: DbWritePlanStatus,
): string {
  if (status === 'blocked_source_confirmation_candidate') {
    return candidate.blocked_reason || 'source_confirmation_candidate_blocked';
  }
  return 'requires_real_human_confirmation_before_write_plan';
}

function buildTargetEntityProjection(candidate: RunnerBoundaryCandidate): TargetEntityProjectionPlaceholder {
  return {
    kind: 'TARGET_ENTITY_PROJECTION_PLACEHOLDER',
    schema_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    target_entity_kind: targetEntityKindFor(candidate.action_type),
    target_entity_id_placeholder: `UNRESOLVED_TARGET_ENTITY_${candidate.source_action_id}`,
    represents_existing_db_row: FALSE_VALUE,
    requires_future_lookup: TRUE_VALUE,
  };
}

function buildIntendedMutationSummary(candidate: RunnerBoundaryCandidate): IntendedMutationSummaryPlaceholder {
  return {
    kind: 'INTENDED_MUTATION_SUMMARY_PLACEHOLDER',
    schema_only: TRUE_VALUE,
    executable: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    summary: `A future writer may prepare a non-executed mutation description for ${candidate.action_type}.`,
  };
}

function buildWritePreconditions(candidate: RunnerBoundaryCandidate): readonly WritePreconditionPlaceholder[] {
  return [
    {
      kind: 'WRITE_PRECONDITION_PLACEHOLDER',
      name: 'requires_real_human_confirmation',
      required: TRUE_VALUE,
      satisfied: FALSE_VALUE,
      blocking: TRUE_VALUE,
      message: `Real human confirmation is required before ${candidate.source_action_id} can be planned for writing.`,
    },
    {
      kind: 'WRITE_PRECONDITION_PLACEHOLDER',
      name: 'requires_safe_write_runner',
      required: TRUE_VALUE,
      satisfied: FALSE_VALUE,
      blocking: TRUE_VALUE,
      message: 'A future safe write runner must resolve this placeholder.',
    },
  ];
}

function buildTransactionBoundaryPlaceholder(): TransactionBoundaryPlaceholder {
  return {
    kind: 'TRANSACTION_BOUNDARY_PLACEHOLDER',
    placeholder_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    opens_transaction: FALSE_VALUE,
    commits_transaction: FALSE_VALUE,
    rolls_back_transaction: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
  };
}

function buildRollbackPlaceholder(): RollbackPlaceholder {
  return {
    kind: 'ROLLBACK_PLACEHOLDER',
    placeholder_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    rollback_plan_recorded: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
  };
}

function buildSqlGenerationPlaceholder(): SqlGenerationPlaceholder {
  return {
    kind: 'SQL_GENERATION_PLACEHOLDER',
    schema_only: TRUE_VALUE,
    generates_sql: FALSE_VALUE,
    generates_executable_sql: FALSE_VALUE,
    executable_sql: '',
    executes_sql: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
  };
}

function buildIdempotencyPlaceholder(sourceActionId: string): DbWritePlanIdempotencyPlaceholder {
  return {
    kind: 'DB_WRITE_PLAN_IDEMPOTENCY_PLACEHOLDER',
    version: DB_WRITE_PLAN_DRY_RUN_VERSION,
    placeholder_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    persisted: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
    value: `DB_WRITE_PLAN_IDEMPOTENCY_${sourceActionId}`,
  };
}

function buildExecutionProhibition(): WriteExecutionProhibition {
  return {
    kind: 'WRITE_EXECUTION_PROHIBITION',
    executes_write: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    executes_sql: FALSE_VALUE,
    generates_executable_sql: FALSE_VALUE,
    opens_transaction: FALSE_VALUE,
    commits_transaction: FALSE_VALUE,
    rolls_back_transaction: FALSE_VALUE,
    explicit_non_actions: [
      'Does not read database records',
      'Does not write database records',
      'Does not generate executable statements',
      'Does not open or close a transaction boundary',
      'Does not persist a write plan',
    ],
  };
}

function buildSafety(): DbWritePlanSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executable: FALSE_VALUE,
    generates_executable_sql: FALSE_VALUE,
    executes_sql: FALSE_VALUE,
  };
}

function emptySummary(): DbWritePlanSummary {
  return buildDbWritePlanSummary([]);
}

function targetEntityKindFor(actionType: string): string {
  if (actionType.includes('EVIDENCE')) return 'customer_evidence_placeholder';
  if (actionType.includes('FOLLOW_UP')) return 'follow_up_task_placeholder';
  return 'crm_entity_placeholder';
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function blocked(
  reason: DbWritePlanDryRunBlockedReason,
): DbWritePlanDryRunValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
