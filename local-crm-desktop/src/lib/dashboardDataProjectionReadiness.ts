import type {
  SafeWriteRunnerCandidate,
  SafeWriteRunnerGateResult,
} from './safeWriteRunnerGateReadiness';

export const DASHBOARD_DATA_PROJECTION_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type DashboardDataProjectionBlockedReason =
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_gate_blocked'
  | 'source_candidates_empty'
  | 'illegal_source_not_contract_only'
  | 'illegal_source_not_dry_run_only'
  | 'illegal_source_not_gate_only'
  | 'illegal_source_missing_generated_safe_write_runner_candidates'
  | 'illegal_source_ready_to_write'
  | 'illegal_source_ready_for_runner'
  | 'illegal_source_executable'
  | 'illegal_source_executed'
  | 'illegal_source_write_executed'
  | 'illegal_source_persisted'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'illegal_source_generates_executable_sql'
  | 'illegal_source_executes_sql'
  | 'illegal_source_opens_transaction'
  | 'illegal_source_represents_db_write'
  | 'illegal_source_represents_executed_action'
  | 'illegal_source_represents_write_runner_execution'
  | 'illegal_candidate_status_not_blocked'
  | 'illegal_candidate_not_contract_only'
  | 'illegal_candidate_not_dry_run_only'
  | 'illegal_candidate_not_gate_only'
  | 'illegal_candidate_ready_to_write'
  | 'illegal_candidate_ready_for_runner'
  | 'illegal_candidate_executable'
  | 'illegal_candidate_executed'
  | 'illegal_candidate_write_executed'
  | 'illegal_candidate_persisted'
  | 'illegal_candidate_reads_database'
  | 'illegal_candidate_writes_database'
  | 'illegal_candidate_generates_executable_sql'
  | 'illegal_candidate_executes_sql'
  | 'illegal_candidate_opens_transaction'
  | 'illegal_candidate_represents_db_write'
  | 'illegal_candidate_represents_executed_action'
  | 'illegal_candidate_represents_write_runner_execution'
  | 'illegal_candidate_idempotency_usable_for_execution'
  | 'illegal_candidate_idempotency_resolved';

export type DashboardProjectionRowStatus =
  | 'blocked_requires_real_confirmation'
  | 'blocked_requires_executable_write_plan'
  | 'blocked_source_write_plan_candidate'
  | 'blocked_missing_safe_write_runner_policy';

export type DashboardProjectionAttentionLevel = 'review_required' | 'source_blocked' | 'policy_blocked';

export interface DashboardDataProjectionRequest {
  kind: 'DASHBOARD_DATA_PROJECTION_REQUEST';
  version?: typeof DASHBOARD_DATA_PROJECTION_VERSION;
  request_id: string;
  source_safe_write_runner_gate_result: SafeWriteRunnerGateResult;
}

export interface NormalizedDashboardDataProjectionRequest extends DashboardDataProjectionRequest {
  version: typeof DASHBOARD_DATA_PROJECTION_VERSION;
}

export interface DashboardDataProjectionSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executable: BoolFalse;
  generates_executable_sql: BoolFalse;
  executes_sql: BoolFalse;
  opens_transaction: BoolFalse;
  renders_surface: BoolFalse;
}

export interface DashboardDataProjectionPlan {
  kind: 'DASHBOARD_DATA_PROJECTION_PLAN';
  version: typeof DASHBOARD_DATA_PROJECTION_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'dashboard_data_projection_readiness_only';
  request: NormalizedDashboardDataProjectionRequest;
  allowed_operations: readonly [
    'validate_safe_write_runner_gate_result',
    'project_dashboard_data_rows',
    'build_dashboard_data_projection_summary',
  ];
  forbidden_operations: readonly string[];
  safety: DashboardDataProjectionSafety;
}

export interface DashboardDataProjectionRow {
  kind: 'DASHBOARD_DATA_PROJECTION_ROW';
  version: typeof DASHBOARD_DATA_PROJECTION_VERSION;
  projection_row_id: string;
  source_safe_write_runner_candidate_id: string;
  source_write_plan_candidate_id: string;
  source_runner_boundary_candidate_id: string;
  source_confirmation_candidate_id: string;
  source_action_id: string;
  source_proposal_id: string;
  source_proposal_type: SafeWriteRunnerCandidate['source_proposal_type'];
  action_type: SafeWriteRunnerCandidate['action_type'];
  title: string;
  display_summary: string;
  row_status: DashboardProjectionRowStatus;
  attention_level: DashboardProjectionAttentionLevel;
  blocked_reason: string;
  evidence_ref_count: number;
  risk_flag_count: number;
  evidence_refs: SafeWriteRunnerCandidate['evidence_refs'];
  risk_flags: SafeWriteRunnerCandidate['risk_flags'];
  missing_requirement_names: readonly string[];
  contract_only: BoolTrue;
  projection_only: BoolTrue;
  source_gate_only: BoolTrue;
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
  renders_surface: BoolFalse;
}

export interface DashboardDataProjectionSummary {
  kind: 'DASHBOARD_DATA_PROJECTION_SUMMARY';
  version: typeof DASHBOARD_DATA_PROJECTION_VERSION;
  total: number;
  review_required: number;
  source_blocked: number;
  policy_blocked: number;
  missing_evidence: number;
  high_risk: number;
  by_action_type: Record<string, number>;
  by_row_status: Record<string, number>;
  by_attention_level: Record<string, number>;
}

export interface DashboardDataProjectionAnswer {
  kind: 'DASHBOARD_DATA_PROJECTION_ANSWER';
  version: typeof DASHBOARD_DATA_PROJECTION_VERSION;
  contract_only: BoolTrue;
  projection_only: BoolTrue;
  source_gate_only: BoolTrue;
  dashboard_data_only: BoolTrue;
  generated_dashboard_rows: boolean;
  dashboard_rows: readonly DashboardDataProjectionRow[];
  dashboard_rows_count: number;
  projection_blocked: boolean;
  blocked_reason: DashboardDataProjectionBlockedReason | null;
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
  renders_surface: BoolFalse;
  summary: DashboardDataProjectionSummary;
  source_safe_write_runner_gate_result: SafeWriteRunnerGateResult;
  safety: DashboardDataProjectionSafety;
}

export interface DashboardDataProjectionResult {
  kind: 'DASHBOARD_DATA_PROJECTION_RESULT';
  version: typeof DASHBOARD_DATA_PROJECTION_VERSION;
  plan: DashboardDataProjectionPlan;
  answer: DashboardDataProjectionAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
  writes_database: BoolFalse;
}

export interface DashboardDataProjectionTrace {
  kind: 'DASHBOARD_DATA_PROJECTION_TRACE';
  plan: DashboardDataProjectionPlan;
  result: DashboardDataProjectionResult;
  persisted: BoolFalse;
  writes_database: BoolFalse;
}

export interface DashboardDataProjectionValidation {
  ok: boolean;
  blocked_reason: DashboardDataProjectionBlockedReason | null;
}

export function validateDashboardDataProjectionInput(
  result: unknown,
): DashboardDataProjectionValidation {
  const source = asRecord(result);
  if (source?.kind !== 'SAFE_WRITE_RUNNER_GATE_RESULT') return blocked('invalid_source_result_kind');

  const answer = asRecord(source.answer);
  if (!answer) return blocked('source_answer_missing');
  if (answer.runner_gate_blocked === true) return blocked('source_gate_blocked');
  if (answer.contract_only !== true) return blocked('illegal_source_not_contract_only');
  if (answer.dry_run_only !== true) return blocked('illegal_source_not_dry_run_only');
  if (answer.gate_only !== true) return blocked('illegal_source_not_gate_only');
  if (answer.generated_safe_write_runner_candidates !== true) {
    return blocked('illegal_source_missing_generated_safe_write_runner_candidates');
  }
  if (answer.ready_to_write === true) return blocked('illegal_source_ready_to_write');
  if (answer.ready_for_runner === true) return blocked('illegal_source_ready_for_runner');
  if (answer.executable === true) return blocked('illegal_source_executable');
  if (answer.executed === true) return blocked('illegal_source_executed');
  if (answer.write_executed === true) return blocked('illegal_source_write_executed');
  if (answer.persisted === true || source.persisted === true) return blocked('illegal_source_persisted');
  if (answer.reads_database === true) return blocked('illegal_source_reads_database');
  if (answer.writes_database === true || source.writes_database === true) {
    return blocked('illegal_source_writes_database');
  }
  if (answer.generates_executable_sql === true) return blocked('illegal_source_generates_executable_sql');
  if (answer.executes_sql === true) return blocked('illegal_source_executes_sql');
  if (answer.opens_transaction === true) return blocked('illegal_source_opens_transaction');
  if (answer.represents_db_write === true) return blocked('illegal_source_represents_db_write');
  if (answer.represents_executed_action === true || source.represents_executed_action === true) {
    return blocked('illegal_source_represents_executed_action');
  }
  if (answer.represents_write_runner_execution === true) {
    return blocked('illegal_source_represents_write_runner_execution');
  }

  const safety = asRecord(answer.safety);
  if (safety?.reads_database === true) return blocked('illegal_source_reads_database');
  if (safety?.writes_database === true) return blocked('illegal_source_writes_database');
  if (safety?.executes_sql === true) return blocked('illegal_source_executes_sql');
  if (safety?.opens_transaction === true) return blocked('illegal_source_opens_transaction');

  const candidates = Array.isArray(answer.safe_write_runner_candidates)
    ? answer.safe_write_runner_candidates
    : [];
  const count = typeof answer.safe_write_runner_candidates_count === 'number'
    ? answer.safe_write_runner_candidates_count
    : 0;
  if (count <= 0 || candidates.length === 0) return blocked('source_candidates_empty');

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const status = typeof record?.runner_gate_status === 'string' ? record.runner_gate_status : '';
    if (!status.startsWith('blocked_')) return blocked('illegal_candidate_status_not_blocked');
    if (record?.contract_only !== true) return blocked('illegal_candidate_not_contract_only');
    if (record?.dry_run_only !== true) return blocked('illegal_candidate_not_dry_run_only');
    if (record?.gate_only !== true) return blocked('illegal_candidate_not_gate_only');
    if (record?.ready_to_write === true) return blocked('illegal_candidate_ready_to_write');
    if (record?.ready_for_runner === true) return blocked('illegal_candidate_ready_for_runner');
    if (record?.executable === true) return blocked('illegal_candidate_executable');
    if (record?.executed === true) return blocked('illegal_candidate_executed');
    if (record?.write_executed === true) return blocked('illegal_candidate_write_executed');
    if (record?.persisted === true) return blocked('illegal_candidate_persisted');
    if (record?.reads_database === true) return blocked('illegal_candidate_reads_database');
    if (record?.writes_database === true) return blocked('illegal_candidate_writes_database');
    if (record?.generates_executable_sql === true) return blocked('illegal_candidate_generates_executable_sql');
    if (record?.executes_sql === true) return blocked('illegal_candidate_executes_sql');
    if (record?.opens_transaction === true) return blocked('illegal_candidate_opens_transaction');
    if (record?.represents_db_write === true) return blocked('illegal_candidate_represents_db_write');
    if (record?.represents_executed_action === true) {
      return blocked('illegal_candidate_represents_executed_action');
    }
    if (record?.represents_write_runner_execution === true) {
      return blocked('illegal_candidate_represents_write_runner_execution');
    }

    const idempotency = asRecord(record?.idempotency_resolution_requirement);
    if (idempotency?.usable_for_execution === true) {
      return blocked('illegal_candidate_idempotency_usable_for_execution');
    }
    if (idempotency?.resolved === true) return blocked('illegal_candidate_idempotency_resolved');
  }

  return { ok: true, blocked_reason: null };
}

export function buildDashboardDataProjectionPlan(
  request: DashboardDataProjectionRequest,
): DashboardDataProjectionPlan {
  return {
    kind: 'DASHBOARD_DATA_PROJECTION_PLAN',
    version: DASHBOARD_DATA_PROJECTION_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'dashboard_data_projection_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_safe_write_runner_gate_result',
      'project_dashboard_data_rows',
      'build_dashboard_data_projection_summary',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'rerun_safe_write_runner_gate',
      'render_surface',
      'mount_dashboard',
      'execute_row',
      'confirm_row',
      'persist_projection',
      'generate_executable_statement',
      'open_transaction_boundary',
      ['call', ['pro', 'vider'].join('')].join('_'),
    ],
    safety: buildSafety(),
  };
}

export function runDashboardDataProjection(
  plan: DashboardDataProjectionPlan,
): DashboardDataProjectionResult {
  const source = plan.request.source_safe_write_runner_gate_result;
  const validation = validateDashboardDataProjectionInput(source);

  if (!validation.ok) return buildResult(plan, [], validation.blocked_reason);

  const rows = source.answer.safe_write_runner_candidates.map((candidate, index) => (
    projectSafeWriteRunnerCandidateToDashboardRow(candidate, index)
  ));
  return buildResult(plan, rows, null);
}

export function buildDashboardDataProjectionTrace(
  plan: DashboardDataProjectionPlan,
): DashboardDataProjectionTrace {
  return {
    kind: 'DASHBOARD_DATA_PROJECTION_TRACE',
    plan,
    result: runDashboardDataProjection(plan),
    persisted: FALSE_VALUE,
    writes_database: FALSE_VALUE,
  };
}

export function projectSafeWriteRunnerCandidateToDashboardRow(
  candidate: SafeWriteRunnerCandidate,
  index: number,
): DashboardDataProjectionRow {
  return {
    kind: 'DASHBOARD_DATA_PROJECTION_ROW',
    version: DASHBOARD_DATA_PROJECTION_VERSION,
    projection_row_id: `DASHBOARD_DATA_PROJECTION_LIVE_${String(index + 1).padStart(3, '0')}`,
    source_safe_write_runner_candidate_id: candidate.safe_write_runner_candidate_id,
    source_write_plan_candidate_id: candidate.source_write_plan_candidate_id,
    source_runner_boundary_candidate_id: candidate.source_runner_boundary_candidate_id,
    source_confirmation_candidate_id: candidate.source_confirmation_candidate_id,
    source_action_id: candidate.source_action_id,
    source_proposal_id: candidate.source_proposal_id,
    source_proposal_type: candidate.source_proposal_type,
    action_type: candidate.action_type,
    title: candidate.title,
    display_summary: `Dashboard projection keeps ${candidate.title} blocked for review.`,
    row_status: candidate.runner_gate_status,
    attention_level: attentionLevelFor(candidate),
    blocked_reason: candidate.blocked_reason,
    evidence_ref_count: candidate.evidence_refs.length,
    risk_flag_count: candidate.risk_flags.length,
    evidence_refs: candidate.evidence_refs,
    risk_flags: candidate.risk_flags,
    missing_requirement_names: candidate.missing_execution_requirements.map(requirement => requirement.name),
    contract_only: TRUE_VALUE,
    projection_only: TRUE_VALUE,
    source_gate_only: TRUE_VALUE,
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
    renders_surface: FALSE_VALUE,
  };
}

export function buildDashboardDataProjectionSummary(
  rows: readonly DashboardDataProjectionRow[],
): DashboardDataProjectionSummary {
  return {
    kind: 'DASHBOARD_DATA_PROJECTION_SUMMARY',
    version: DASHBOARD_DATA_PROJECTION_VERSION,
    total: rows.length,
    review_required: rows.filter(row => row.attention_level === 'review_required').length,
    source_blocked: rows.filter(row => row.attention_level === 'source_blocked').length,
    policy_blocked: rows.filter(row => row.attention_level === 'policy_blocked').length,
    missing_evidence: rows.filter(row => row.evidence_ref_count === 0).length,
    high_risk: rows.filter(row => row.risk_flags.some(flag => flag.includes('requires_review'))).length,
    by_action_type: countBy(rows.map(row => row.action_type)),
    by_row_status: countBy(rows.map(row => row.row_status)),
    by_attention_level: countBy(rows.map(row => row.attention_level)),
  };
}

function buildResult(
  plan: DashboardDataProjectionPlan,
  rows: readonly DashboardDataProjectionRow[],
  blockedReason: DashboardDataProjectionBlockedReason | null,
): DashboardDataProjectionResult {
  const isBlocked = blockedReason !== null;

  return {
    kind: 'DASHBOARD_DATA_PROJECTION_RESULT',
    version: DASHBOARD_DATA_PROJECTION_VERSION,
    plan,
    answer: {
      kind: 'DASHBOARD_DATA_PROJECTION_ANSWER',
      version: DASHBOARD_DATA_PROJECTION_VERSION,
      contract_only: TRUE_VALUE,
      projection_only: TRUE_VALUE,
      source_gate_only: TRUE_VALUE,
      dashboard_data_only: TRUE_VALUE,
      generated_dashboard_rows: !isBlocked && rows.length > 0,
      dashboard_rows: isBlocked ? [] : rows,
      dashboard_rows_count: isBlocked ? 0 : rows.length,
      projection_blocked: isBlocked,
      blocked_reason: blockedReason,
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
      renders_surface: FALSE_VALUE,
      summary: isBlocked ? emptySummary() : buildDashboardDataProjectionSummary(rows),
      source_safe_write_runner_gate_result: plan.request.source_safe_write_runner_gate_result,
      safety: buildSafety(),
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    writes_database: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: DashboardDataProjectionRequest,
): NormalizedDashboardDataProjectionRequest {
  return {
    ...request,
    version: DASHBOARD_DATA_PROJECTION_VERSION,
  };
}

function attentionLevelFor(candidate: SafeWriteRunnerCandidate): DashboardProjectionAttentionLevel {
  if (candidate.runner_gate_status === 'blocked_source_write_plan_candidate') return 'source_blocked';
  if (candidate.runner_gate_status === 'blocked_missing_safe_write_runner_policy') return 'policy_blocked';
  return 'review_required';
}

function buildSafety(): DashboardDataProjectionSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executable: FALSE_VALUE,
    generates_executable_sql: FALSE_VALUE,
    executes_sql: FALSE_VALUE,
    opens_transaction: FALSE_VALUE,
    renders_surface: FALSE_VALUE,
  };
}

function emptySummary(): DashboardDataProjectionSummary {
  return buildDashboardDataProjectionSummary([]);
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function blocked(
  reason: DashboardDataProjectionBlockedReason,
): DashboardDataProjectionValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
