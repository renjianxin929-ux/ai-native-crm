import type {
  DbWritePlanDryRunCandidate,
  DbWritePlanDryRunResult,
  DbWritePlanStatus,
} from './dbWritePlanDryRunReadiness';

export const SAFE_WRITE_RUNNER_GATE_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type SafeWriteRunnerGateBlockedReason =
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_write_plan_blocked'
  | 'source_candidates_empty'
  | 'illegal_source_not_contract_only'
  | 'illegal_source_not_dry_run_only'
  | 'illegal_source_not_write_plan_only'
  | 'illegal_source_not_generated_write_plan_candidates'
  | 'illegal_source_ready_to_write'
  | 'illegal_source_ready_for_runner'
  | 'illegal_source_executable'
  | 'illegal_source_executed'
  | 'illegal_source_persisted'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'illegal_source_generates_executable_sql'
  | 'illegal_source_executes_sql'
  | 'illegal_source_opens_transaction'
  | 'illegal_source_commits_transaction'
  | 'illegal_source_rolls_back_transaction'
  | 'illegal_source_represents_db_write'
  | 'illegal_source_represents_executed_action'
  | 'illegal_candidate_status_not_blocked'
  | 'illegal_candidate_not_contract_only'
  | 'illegal_candidate_not_dry_run_only'
  | 'illegal_candidate_not_write_plan_only'
  | 'illegal_candidate_ready_to_write'
  | 'illegal_candidate_executable'
  | 'illegal_candidate_executed'
  | 'illegal_candidate_persisted'
  | 'illegal_candidate_reads_database'
  | 'illegal_candidate_writes_database'
  | 'illegal_candidate_generates_executable_sql'
  | 'illegal_candidate_executes_sql'
  | 'illegal_candidate_opens_transaction'
  | 'illegal_candidate_commits_transaction'
  | 'illegal_candidate_rolls_back_transaction'
  | 'illegal_candidate_represents_db_write'
  | 'illegal_candidate_represents_executed_action'
  | 'illegal_candidate_idempotency_usable_for_execution'
  | 'illegal_candidate_idempotency_resolved'
  | 'illegal_candidate_idempotency_persisted'
  | 'illegal_candidate_sql_generation_executable'
  | 'illegal_candidate_transaction_usable_for_execution';

export type SafeWriteRunnerGateStatus =
  | 'blocked_requires_real_confirmation'
  | 'blocked_requires_executable_write_plan'
  | 'blocked_source_write_plan_candidate'
  | 'blocked_missing_safe_write_runner_policy';

export type MissingExecutionRequirementName =
  | 'requires_real_human_confirmation'
  | 'requires_resolved_operator'
  | 'requires_executable_write_plan'
  | 'requires_safe_write_runner_policy'
  | 'requires_resolved_idempotency_key'
  | 'requires_transaction_policy'
  | 'requires_rollback_strategy'
  | 'requires_db_write_test_harness';

export interface SafeWriteRunnerGateRequest {
  kind: 'SAFE_WRITE_RUNNER_GATE_REQUEST';
  version?: typeof SAFE_WRITE_RUNNER_GATE_VERSION;
  request_id: string;
  source_db_write_plan_dry_run_result: DbWritePlanDryRunResult;
}

export interface NormalizedSafeWriteRunnerGateRequest extends SafeWriteRunnerGateRequest {
  version: typeof SAFE_WRITE_RUNNER_GATE_VERSION;
}

export interface MissingExecutionRequirement {
  kind: 'MISSING_EXECUTION_REQUIREMENT';
  name: MissingExecutionRequirementName;
  required: BoolTrue;
  satisfied: BoolFalse;
  blocking: BoolTrue;
  message: string;
}

export interface WriteExecutionDenial {
  kind: 'WRITE_EXECUTION_DENIAL';
  denial_only: BoolTrue;
  executes_write: BoolFalse;
  writes_database: BoolFalse;
  reason: string;
  missing_requirements: readonly MissingExecutionRequirement[];
}

export interface DbWriteProhibition {
  kind: 'DB_WRITE_PROHIBITION';
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  opens_connection: BoolFalse;
  uses_db_handle: BoolFalse;
  executes_statement: BoolFalse;
  mutates_state: BoolFalse;
}

export interface TransactionProhibition {
  kind: 'TRANSACTION_PROHIBITION';
  opens_transaction: BoolFalse;
  commits_transaction: BoolFalse;
  rolls_back_transaction: BoolFalse;
  uses_transaction_handle: BoolFalse;
  usable_for_execution: BoolFalse;
}

export interface SqlExecutionProhibition {
  kind: 'SQL_EXECUTION_PROHIBITION';
  generates_sql: BoolFalse;
  generates_executable_sql: BoolFalse;
  executable_sql: '';
  executes_sql: BoolFalse;
  usable_for_execution: BoolFalse;
}

export interface IdempotencyResolutionRequirement {
  kind: 'IDEMPOTENCY_RESOLUTION_REQUIREMENT';
  required: BoolTrue;
  resolved: BoolFalse;
  usable_for_execution: BoolFalse;
  source_placeholder_id: string;
  requires_future_persistence: BoolTrue;
}

export interface SafeWriteRunnerCandidate {
  kind: 'SAFE_WRITE_RUNNER_CANDIDATE';
  version: typeof SAFE_WRITE_RUNNER_GATE_VERSION;
  safe_write_runner_candidate_id: string;
  source_write_plan_candidate_id: string;
  source_runner_boundary_candidate_id: string;
  source_confirmation_candidate_id: string;
  source_action_id: string;
  source_proposal_id: string;
  source_proposal_type: DbWritePlanDryRunCandidate['source_proposal_type'];
  action_type: DbWritePlanDryRunCandidate['action_type'];
  title: string;
  summary: string;
  evidence_refs: DbWritePlanDryRunCandidate['evidence_refs'];
  risk_flags: DbWritePlanDryRunCandidate['risk_flags'];
  runner_gate_status: SafeWriteRunnerGateStatus;
  blocked_reason: string;
  missing_execution_requirements: readonly MissingExecutionRequirement[];
  write_execution_denial: WriteExecutionDenial;
  db_write_prohibition: DbWriteProhibition;
  transaction_prohibition: TransactionProhibition;
  sql_execution_prohibition: SqlExecutionProhibition;
  idempotency_resolution_requirement: IdempotencyResolutionRequirement;
  contract_only: BoolTrue;
  dry_run_only: BoolTrue;
  gate_only: BoolTrue;
  ready_to_write: BoolFalse;
  ready_for_runner: BoolFalse;
  executable: BoolFalse;
  executed: BoolFalse;
  write_executed: BoolFalse;
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
  represents_write_runner_execution: BoolFalse;
  requires_real_human_confirmation: BoolTrue;
  requires_resolved_operator: BoolTrue;
  requires_executable_write_plan: BoolTrue;
  requires_safe_write_runner: BoolTrue;
}

export interface SafeWriteRunnerGateSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executable: BoolFalse;
  generates_executable_sql: BoolFalse;
  executes_sql: BoolFalse;
  opens_transaction: BoolFalse;
}

export interface SafeWriteRunnerGateSummary {
  kind: 'SAFE_WRITE_RUNNER_GATE_SUMMARY';
  version: typeof SAFE_WRITE_RUNNER_GATE_VERSION;
  total: number;
  blocked_requires_real_confirmation: number;
  blocked_requires_executable_write_plan: number;
  blocked_source_write_plan_candidate: number;
  blocked_missing_safe_write_runner_policy: number;
  by_action_type: Record<string, number>;
  by_runner_gate_status: Record<string, number>;
}

export interface SafeWriteRunnerGatePlan {
  kind: 'SAFE_WRITE_RUNNER_GATE_PLAN';
  version: typeof SAFE_WRITE_RUNNER_GATE_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'safe_write_runner_gate_readiness_only';
  request: NormalizedSafeWriteRunnerGateRequest;
  allowed_operations: readonly [
    'validate_db_write_plan_dry_run_result',
    'project_blocked_safe_write_runner_candidates',
    'build_safe_write_runner_gate_summary',
  ];
  forbidden_operations: readonly string[];
  safety: SafeWriteRunnerGateSafety;
}

export interface SafeWriteRunnerGateAnswer {
  kind: 'SAFE_WRITE_RUNNER_GATE_ANSWER';
  version: typeof SAFE_WRITE_RUNNER_GATE_VERSION;
  contract_only: BoolTrue;
  dry_run_only: BoolTrue;
  gate_only: BoolTrue;
  ready_to_write: BoolFalse;
  ready_for_runner: BoolFalse;
  executable: BoolFalse;
  executed: BoolFalse;
  write_executed: BoolFalse;
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
  represents_write_runner_execution: BoolFalse;
  runner_gate_blocked: boolean;
  blocked_reason: SafeWriteRunnerGateBlockedReason | null;
  generated_safe_write_runner_candidates: boolean;
  safe_write_runner_candidates: readonly SafeWriteRunnerCandidate[];
  safe_write_runner_candidates_count: number;
  summary: SafeWriteRunnerGateSummary;
  source_db_write_plan_dry_run_result: DbWritePlanDryRunResult;
  safety: SafeWriteRunnerGateSafety;
}

export interface SafeWriteRunnerGateResult {
  kind: 'SAFE_WRITE_RUNNER_GATE_RESULT';
  version: typeof SAFE_WRITE_RUNNER_GATE_VERSION;
  plan: SafeWriteRunnerGatePlan;
  answer: SafeWriteRunnerGateAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
  writes_database: BoolFalse;
}

export interface SafeWriteRunnerGateTrace {
  kind: 'SAFE_WRITE_RUNNER_GATE_TRACE';
  plan: SafeWriteRunnerGatePlan;
  result: SafeWriteRunnerGateResult;
  persisted: BoolFalse;
  writes_database: BoolFalse;
}

export interface SafeWriteRunnerGateValidation {
  ok: boolean;
  blocked_reason: SafeWriteRunnerGateBlockedReason | null;
}

export function validateSafeWriteRunnerGateInput(
  result: unknown,
): SafeWriteRunnerGateValidation {
  const source = asRecord(result);
  if (source?.kind !== 'DB_WRITE_PLAN_DRY_RUN_RESULT') return blocked('invalid_source_result_kind');

  const answer = asRecord(source.answer);
  if (!answer) return blocked('source_answer_missing');
  if (answer.write_plan_blocked === true) return blocked('source_write_plan_blocked');
  if (answer.contract_only !== true) return blocked('illegal_source_not_contract_only');
  if (answer.dry_run_only !== true) return blocked('illegal_source_not_dry_run_only');
  if (answer.write_plan_only !== true) return blocked('illegal_source_not_write_plan_only');
  if (answer.generated_write_plan_candidates !== true) {
    return blocked('illegal_source_not_generated_write_plan_candidates');
  }
  if (answer.ready_to_write === true) return blocked('illegal_source_ready_to_write');
  if (answer.ready_for_runner === true) return blocked('illegal_source_ready_for_runner');
  if (answer.executable === true) return blocked('illegal_source_executable');
  if (answer.executed === true) return blocked('illegal_source_executed');
  if (answer.persisted === true || source.persisted === true) return blocked('illegal_source_persisted');
  if (answer.reads_database === true) return blocked('illegal_source_reads_database');
  if (answer.writes_database === true || source.writes_database === true) {
    return blocked('illegal_source_writes_database');
  }
  if (answer.generates_executable_sql === true) return blocked('illegal_source_generates_executable_sql');
  if (answer.executes_sql === true) return blocked('illegal_source_executes_sql');
  if (answer.opens_transaction === true) return blocked('illegal_source_opens_transaction');
  if (answer.commits_transaction === true) return blocked('illegal_source_commits_transaction');
  if (answer.rolls_back_transaction === true) return blocked('illegal_source_rolls_back_transaction');
  if (answer.represents_db_write === true) return blocked('illegal_source_represents_db_write');
  if (answer.represents_executed_action === true || source.represents_executed_action === true) {
    return blocked('illegal_source_represents_executed_action');
  }

  const safety = asRecord(answer.safety);
  if (safety?.reads_database === true) return blocked('illegal_source_reads_database');
  if (safety?.writes_database === true) return blocked('illegal_source_writes_database');

  const candidates = Array.isArray(answer.write_plan_candidates) ? answer.write_plan_candidates : [];
  const count = typeof answer.write_plan_candidates_count === 'number'
    ? answer.write_plan_candidates_count
    : 0;
  if (count <= 0 || candidates.length === 0) return blocked('source_candidates_empty');

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const status = typeof record?.write_plan_status === 'string' ? record.write_plan_status : '';
    if (!status.startsWith('blocked_')) return blocked('illegal_candidate_status_not_blocked');
    if (record?.contract_only !== true) return blocked('illegal_candidate_not_contract_only');
    if (record?.dry_run_only !== true) return blocked('illegal_candidate_not_dry_run_only');
    if (record?.write_plan_only !== true) return blocked('illegal_candidate_not_write_plan_only');
    if (record?.ready_to_write === true) return blocked('illegal_candidate_ready_to_write');
    if (record?.executable === true) return blocked('illegal_candidate_executable');
    if (record?.executed === true) return blocked('illegal_candidate_executed');
    if (record?.persisted === true) return blocked('illegal_candidate_persisted');
    if (record?.reads_database === true) return blocked('illegal_candidate_reads_database');
    if (record?.writes_database === true) return blocked('illegal_candidate_writes_database');
    if (record?.generates_executable_sql === true) return blocked('illegal_candidate_generates_executable_sql');
    if (record?.executes_sql === true) return blocked('illegal_candidate_executes_sql');
    if (record?.opens_transaction === true) return blocked('illegal_candidate_opens_transaction');
    if (record?.commits_transaction === true) return blocked('illegal_candidate_commits_transaction');
    if (record?.rolls_back_transaction === true) return blocked('illegal_candidate_rolls_back_transaction');
    if (record?.represents_db_write === true) return blocked('illegal_candidate_represents_db_write');
    if (record?.represents_executed_action === true) {
      return blocked('illegal_candidate_represents_executed_action');
    }

    const idempotency = asRecord(record?.idempotency);
    if (idempotency?.usable_for_execution === true) {
      return blocked('illegal_candidate_idempotency_usable_for_execution');
    }
    if (idempotency?.resolved === true) return blocked('illegal_candidate_idempotency_resolved');
    if (idempotency?.persisted === true) return blocked('illegal_candidate_idempotency_persisted');

    const sqlGeneration = asRecord(record?.sql_generation);
    if (
      sqlGeneration?.generates_executable_sql === true
      || sqlGeneration?.executes_sql === true
      || sqlGeneration?.usable_for_execution === true
    ) {
      return blocked('illegal_candidate_sql_generation_executable');
    }

    const boundary = asRecord(record?.transaction_boundary);
    if (
      boundary?.usable_for_execution === true
      || boundary?.opens_transaction === true
      || boundary?.commits_transaction === true
      || boundary?.rolls_back_transaction === true
    ) {
      return blocked('illegal_candidate_transaction_usable_for_execution');
    }
  }

  return { ok: true, blocked_reason: null };
}

export function buildSafeWriteRunnerGatePlan(
  request: SafeWriteRunnerGateRequest,
): SafeWriteRunnerGatePlan {
  return {
    kind: 'SAFE_WRITE_RUNNER_GATE_PLAN',
    version: SAFE_WRITE_RUNNER_GATE_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'safe_write_runner_gate_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_db_write_plan_dry_run_result',
      'project_blocked_safe_write_runner_candidates',
      'build_safe_write_runner_gate_summary',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'rerun_db_write_plan_dry_run',
      'generate_executable_statement',
      'open_transaction_boundary',
      'close_transaction_boundary',
      'persist_write_plan',
      'run_write_candidate',
      'resolve_real_operator',
      'record_real_confirmation',
    ],
    safety: buildSafety(),
  };
}

export function runSafeWriteRunnerGate(
  plan: SafeWriteRunnerGatePlan,
): SafeWriteRunnerGateResult {
  const source = plan.request.source_db_write_plan_dry_run_result;
  const validation = validateSafeWriteRunnerGateInput(source);

  if (!validation.ok) return buildResult(plan, [], validation.blocked_reason);

  const candidates = source.answer.write_plan_candidates.map((candidate, index) => (
    projectWritePlanCandidateToSafeWriteRunnerCandidate(candidate, index)
  ));
  return buildResult(plan, candidates, null);
}

export function buildSafeWriteRunnerGateTrace(
  plan: SafeWriteRunnerGatePlan,
): SafeWriteRunnerGateTrace {
  return {
    kind: 'SAFE_WRITE_RUNNER_GATE_TRACE',
    plan,
    result: runSafeWriteRunnerGate(plan),
    persisted: FALSE_VALUE,
    writes_database: FALSE_VALUE,
  };
}

export function projectWritePlanCandidateToSafeWriteRunnerCandidate(
  candidate: DbWritePlanDryRunCandidate,
  index: number,
): SafeWriteRunnerCandidate {
  const missingRequirements = buildMissingExecutionRequirements(candidate.source_action_id);
  const status = mapRunnerGateStatus(candidate.write_plan_status);
  return {
    kind: 'SAFE_WRITE_RUNNER_CANDIDATE',
    version: SAFE_WRITE_RUNNER_GATE_VERSION,
    safe_write_runner_candidate_id: `SAFE_WRITE_RUNNER_GATE_LIVE_${String(index + 1).padStart(3, '0')}`,
    source_write_plan_candidate_id: candidate.write_plan_candidate_id,
    source_runner_boundary_candidate_id: candidate.source_runner_boundary_candidate_id,
    source_confirmation_candidate_id: candidate.source_confirmation_candidate_id,
    source_action_id: candidate.source_action_id,
    source_proposal_id: candidate.source_proposal_id,
    source_proposal_type: candidate.source_proposal_type,
    action_type: candidate.action_type,
    title: candidate.title,
    summary: `Safe write runner gate refused execution for ${candidate.title}.`,
    evidence_refs: candidate.evidence_refs,
    risk_flags: candidate.risk_flags,
    runner_gate_status: status,
    blocked_reason: buildRunnerGateBlockedReason(candidate, status),
    missing_execution_requirements: missingRequirements,
    write_execution_denial: buildWriteExecutionDenial(missingRequirements),
    db_write_prohibition: buildDbWriteProhibition(),
    transaction_prohibition: buildTransactionProhibition(),
    sql_execution_prohibition: buildSqlExecutionProhibition(),
    idempotency_resolution_requirement: buildIdempotencyResolutionRequirement(candidate),
    contract_only: TRUE_VALUE,
    dry_run_only: TRUE_VALUE,
    gate_only: TRUE_VALUE,
    ready_to_write: FALSE_VALUE,
    ready_for_runner: FALSE_VALUE,
    executable: FALSE_VALUE,
    executed: FALSE_VALUE,
    write_executed: FALSE_VALUE,
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
    represents_write_runner_execution: FALSE_VALUE,
    requires_real_human_confirmation: TRUE_VALUE,
    requires_resolved_operator: TRUE_VALUE,
    requires_executable_write_plan: TRUE_VALUE,
    requires_safe_write_runner: TRUE_VALUE,
  };
}

export function buildSafeWriteRunnerGateSummary(
  candidates: readonly SafeWriteRunnerCandidate[],
): SafeWriteRunnerGateSummary {
  return {
    kind: 'SAFE_WRITE_RUNNER_GATE_SUMMARY',
    version: SAFE_WRITE_RUNNER_GATE_VERSION,
    total: candidates.length,
    blocked_requires_real_confirmation: countStatus(candidates, 'blocked_requires_real_confirmation'),
    blocked_requires_executable_write_plan: countStatus(candidates, 'blocked_requires_executable_write_plan'),
    blocked_source_write_plan_candidate: countStatus(candidates, 'blocked_source_write_plan_candidate'),
    blocked_missing_safe_write_runner_policy: countStatus(candidates, 'blocked_missing_safe_write_runner_policy'),
    by_action_type: countBy(candidates.map(candidate => candidate.action_type)),
    by_runner_gate_status: countBy(candidates.map(candidate => candidate.runner_gate_status)),
  };
}

function buildResult(
  plan: SafeWriteRunnerGatePlan,
  candidates: readonly SafeWriteRunnerCandidate[],
  blockedReason: SafeWriteRunnerGateBlockedReason | null,
): SafeWriteRunnerGateResult {
  const isBlocked = blockedReason !== null;
  return {
    kind: 'SAFE_WRITE_RUNNER_GATE_RESULT',
    version: SAFE_WRITE_RUNNER_GATE_VERSION,
    plan,
    answer: {
      kind: 'SAFE_WRITE_RUNNER_GATE_ANSWER',
      version: SAFE_WRITE_RUNNER_GATE_VERSION,
      contract_only: TRUE_VALUE,
      dry_run_only: TRUE_VALUE,
      gate_only: TRUE_VALUE,
      ready_to_write: FALSE_VALUE,
      ready_for_runner: FALSE_VALUE,
      executable: FALSE_VALUE,
      executed: FALSE_VALUE,
      write_executed: FALSE_VALUE,
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
      represents_write_runner_execution: FALSE_VALUE,
      runner_gate_blocked: isBlocked,
      blocked_reason: blockedReason,
      generated_safe_write_runner_candidates: !isBlocked && candidates.length > 0,
      safe_write_runner_candidates: isBlocked ? [] : candidates,
      safe_write_runner_candidates_count: isBlocked ? 0 : candidates.length,
      summary: isBlocked ? emptySummary() : buildSafeWriteRunnerGateSummary(candidates),
      source_db_write_plan_dry_run_result: plan.request.source_db_write_plan_dry_run_result,
      safety: buildSafety(),
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    writes_database: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: SafeWriteRunnerGateRequest,
): NormalizedSafeWriteRunnerGateRequest {
  return {
    ...request,
    version: SAFE_WRITE_RUNNER_GATE_VERSION,
  };
}

function mapRunnerGateStatus(status: DbWritePlanStatus): SafeWriteRunnerGateStatus {
  if (status === 'blocked_source_confirmation_candidate') return 'blocked_source_write_plan_candidate';
  if (status === 'blocked_requires_real_confirmation') return 'blocked_requires_real_confirmation';
  return 'blocked_requires_executable_write_plan';
}

function buildRunnerGateBlockedReason(
  candidate: DbWritePlanDryRunCandidate,
  status: SafeWriteRunnerGateStatus,
): string {
  if (status === 'blocked_source_write_plan_candidate') {
    return candidate.blocked_reason || 'source_write_plan_candidate_blocked';
  }
  if (status === 'blocked_requires_real_confirmation') {
    return 'requires_real_human_confirmation_before_safe_write_gate';
  }
  return 'requires_executable_write_plan_before_safe_write_gate';
}

function buildMissingExecutionRequirements(
  sourceActionId: string,
): readonly MissingExecutionRequirement[] {
  return [
    missingRequirement(
      'requires_real_human_confirmation',
      `Real human confirmation is required before ${sourceActionId} can be considered for writing.`,
    ),
    missingRequirement(
      'requires_resolved_operator',
      'A real operator identity must be resolved outside this gate.',
    ),
    missingRequirement(
      'requires_executable_write_plan',
      'The source write plan is still a blocked dry-run candidate.',
    ),
    missingRequirement(
      'requires_safe_write_runner_policy',
      'A future safe write runner policy must be supplied before any write attempt.',
    ),
    missingRequirement(
      'requires_resolved_idempotency_key',
      'The idempotency placeholder is not resolved for execution.',
    ),
    missingRequirement(
      'requires_transaction_policy',
      'No transaction policy is available to this gate.',
    ),
    missingRequirement(
      'requires_rollback_strategy',
      'No rollback strategy is available to this gate.',
    ),
    missingRequirement(
      'requires_db_write_test_harness',
      'No database write test harness is available to this gate.',
    ),
  ];
}

function missingRequirement(
  name: MissingExecutionRequirementName,
  message: string,
): MissingExecutionRequirement {
  return {
    kind: 'MISSING_EXECUTION_REQUIREMENT',
    name,
    required: TRUE_VALUE,
    satisfied: FALSE_VALUE,
    blocking: TRUE_VALUE,
    message,
  };
}

function buildWriteExecutionDenial(
  missingRequirements: readonly MissingExecutionRequirement[],
): WriteExecutionDenial {
  return {
    kind: 'WRITE_EXECUTION_DENIAL',
    denial_only: TRUE_VALUE,
    executes_write: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    reason: 'Safe write runner gate refused execution because required proofs are missing.',
    missing_requirements: missingRequirements,
  };
}

function buildDbWriteProhibition(): DbWriteProhibition {
  return {
    kind: 'DB_WRITE_PROHIBITION',
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    opens_connection: FALSE_VALUE,
    uses_db_handle: FALSE_VALUE,
    executes_statement: FALSE_VALUE,
    mutates_state: FALSE_VALUE,
  };
}

function buildTransactionProhibition(): TransactionProhibition {
  return {
    kind: 'TRANSACTION_PROHIBITION',
    opens_transaction: FALSE_VALUE,
    commits_transaction: FALSE_VALUE,
    rolls_back_transaction: FALSE_VALUE,
    uses_transaction_handle: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
  };
}

function buildSqlExecutionProhibition(): SqlExecutionProhibition {
  return {
    kind: 'SQL_EXECUTION_PROHIBITION',
    generates_sql: FALSE_VALUE,
    generates_executable_sql: FALSE_VALUE,
    executable_sql: '',
    executes_sql: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
  };
}

function buildIdempotencyResolutionRequirement(
  candidate: DbWritePlanDryRunCandidate,
): IdempotencyResolutionRequirement {
  return {
    kind: 'IDEMPOTENCY_RESOLUTION_REQUIREMENT',
    required: TRUE_VALUE,
    resolved: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
    source_placeholder_id: candidate.idempotency.value,
    requires_future_persistence: TRUE_VALUE,
  };
}

function buildSafety(): SafeWriteRunnerGateSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executable: FALSE_VALUE,
    generates_executable_sql: FALSE_VALUE,
    executes_sql: FALSE_VALUE,
    opens_transaction: FALSE_VALUE,
  };
}

function emptySummary(): SafeWriteRunnerGateSummary {
  return buildSafeWriteRunnerGateSummary([]);
}

function countStatus(
  candidates: readonly SafeWriteRunnerCandidate[],
  status: SafeWriteRunnerGateStatus,
): number {
  return candidates.filter(candidate => candidate.runner_gate_status === status).length;
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function blocked(
  reason: SafeWriteRunnerGateBlockedReason,
): SafeWriteRunnerGateValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
