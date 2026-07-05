import type {
  HumanConfirmationContractCandidate,
  HumanConfirmationContractResult,
  HumanConfirmationStatus,
} from './humanConfirmationContractReadiness';

export const RUNNER_BOUNDARY_CONTRACT_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export type RunnerBoundaryBlockedReason =
  | 'invalid_source_result_kind'
  | 'source_answer_missing'
  | 'source_contract_blocked'
  | 'source_candidates_empty'
  | 'illegal_source_executes_confirmation'
  | 'illegal_source_not_contract_only'
  | 'illegal_source_executable'
  | 'illegal_source_executed_action'
  | 'illegal_source_human_confirmed'
  | 'illegal_source_reads_database'
  | 'illegal_source_writes_database'
  | 'illegal_candidate_human_confirmed'
  | 'illegal_candidate_confirmed'
  | 'illegal_candidate_approved'
  | 'illegal_candidate_executable'
  | 'illegal_candidate_executed'
  | 'illegal_candidate_persisted'
  | 'illegal_candidate_writes_database'
  | 'illegal_candidate_represents_executed_action'
  | 'illegal_candidate_represents_recorded_confirmation'
  | 'illegal_candidate_not_contract_only'
  | 'illegal_candidate_missing_human_review'
  | 'illegal_candidate_operator_resolved'
  | 'illegal_candidate_operator_real';

export type RunnerBoundaryStatus =
  | 'blocked_requires_real_confirmation'
  | 'blocked_source_confirmation_candidate';

export interface RunnerBoundaryContractRequest {
  kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_REQUEST';
  version?: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  request_id: string;
  source_human_confirmation_contract_result: HumanConfirmationContractResult;
}

export interface NormalizedRunnerBoundaryContractRequest extends RunnerBoundaryContractRequest {
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
}

export interface RunnerBoundarySafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  executable: BoolFalse;
  calls_provider: BoolFalse;
}

export interface RequiredConfirmationProofSchema {
  kind: 'REQUIRED_CONFIRMATION_PROOF_SCHEMA';
  schema_only: BoolTrue;
  requires_real_human_confirmation: BoolTrue;
  requires_operator_resolution: BoolTrue;
  requires_confirmation_metadata_resolution: BoolTrue;
  represents_recorded_confirmation: BoolFalse;
  recorded_confirmation_proof: readonly [];
}

export interface RequiredOperatorConfirmationDependency {
  kind: 'REQUIRED_OPERATOR_CONFIRMATION_DEPENDENCY';
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  dependency_only: BoolTrue;
  resolved: BoolFalse;
  represents_real_operator: BoolFalse;
  persisted: BoolFalse;
}

export interface PreExecutionRequirements {
  kind: 'PRE_EXECUTION_REQUIREMENTS';
  requires_real_human_confirmation: BoolTrue;
  requires_operator_resolution: BoolTrue;
  requires_confirmation_metadata_resolution: BoolTrue;
  requires_non_executable_source: BoolTrue;
  requires_no_database_write: BoolTrue;
  writable_for_execution: BoolFalse;
}

export interface RunnerExecutionProhibition {
  kind: 'RUNNER_EXECUTION_PROHIBITION';
  executes_action: BoolFalse;
  writes_database: BoolFalse;
  mutates_state: BoolFalse;
  sends_message: BoolFalse;
  calls_provider: BoolFalse;
  explicit_non_actions: readonly string[];
}

export interface RunnerIdempotencyPlaceholder {
  kind: 'RUNNER_IDEMPOTENCY_PLACEHOLDER';
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  placeholder_only: BoolTrue;
  resolved: BoolFalse;
  persisted: BoolFalse;
  usable_for_execution: BoolFalse;
  value: string;
}

export interface RunnerBoundaryCandidate {
  kind: 'ACTION_RUNNER_BOUNDARY_CANDIDATE';
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  runner_boundary_candidate_id: string;
  source_confirmation_candidate_id: string;
  source_queue_item_id: string;
  source_action_id: string;
  source_proposal_id: string;
  source_proposal_type: HumanConfirmationContractCandidate['source_proposal_type'];
  action_type: HumanConfirmationContractCandidate['action_type'];
  title: string;
  summary: string;
  evidence_refs: HumanConfirmationContractCandidate['evidence_refs'];
  risk_flags: HumanConfirmationContractCandidate['risk_flags'];
  runner_status: RunnerBoundaryStatus;
  blocked_reason: string;
  required_confirmation_proof: RequiredConfirmationProofSchema;
  required_operator_confirmation_dependency: RequiredOperatorConfirmationDependency;
  pre_execution_requirements: PreExecutionRequirements;
  execution_prohibition: RunnerExecutionProhibition;
  idempotency: RunnerIdempotencyPlaceholder;
  contract_only: BoolTrue;
  dry_run_only: BoolTrue;
  ready_for_runner: BoolFalse;
  executable: BoolFalse;
  executed: BoolFalse;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  human_confirmed: BoolFalse;
  confirmed: BoolFalse;
  approved: BoolFalse;
  represents_executed_action: BoolFalse;
  represents_runner_execution: BoolFalse;
  requires_real_human_confirmation: BoolTrue;
}

export interface RunnerBoundarySummary {
  kind: 'ACTION_RUNNER_BOUNDARY_SUMMARY';
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  total: number;
  blocked_requires_real_confirmation: number;
  blocked_source_confirmation_candidate: number;
  by_action_type: Record<string, number>;
  by_runner_status: Record<string, number>;
}

export interface RunnerBoundaryContractPlan {
  kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_PLAN';
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'action_runner_boundary_contract_readiness_only';
  request: NormalizedRunnerBoundaryContractRequest;
  allowed_operations: readonly [
    'validate_human_confirmation_contract_result',
    'project_runner_boundary_candidates',
    'build_runner_boundary_summary',
  ];
  forbidden_operations: readonly string[];
  safety: RunnerBoundarySafety;
}

export interface RunnerBoundaryAnswer {
  kind: 'ACTION_RUNNER_BOUNDARY_ANSWER';
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  contract_only: BoolTrue;
  dry_run_only: BoolTrue;
  ready_for_runner: BoolFalse;
  executable: BoolFalse;
  executed: BoolFalse;
  persisted: BoolFalse;
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  human_confirmed: BoolFalse;
  confirmed: BoolFalse;
  approved: BoolFalse;
  represents_executed_action: BoolFalse;
  represents_runner_execution: BoolFalse;
  requires_real_human_confirmation: BoolTrue;
  generated_runner_boundary_candidates: boolean;
  runner_boundary_candidates: readonly RunnerBoundaryCandidate[];
  runner_boundary_candidates_count: number;
  runner_boundary_blocked: boolean;
  blocked_reason: RunnerBoundaryBlockedReason | null;
  summary: RunnerBoundarySummary;
  source_human_confirmation_contract_result: HumanConfirmationContractResult;
  safety: RunnerBoundarySafety;
}

export interface RunnerBoundaryContractResult {
  kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT';
  version: typeof RUNNER_BOUNDARY_CONTRACT_VERSION;
  plan: RunnerBoundaryContractPlan;
  answer: RunnerBoundaryAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
  represents_runner_execution: BoolFalse;
}

export interface RunnerBoundaryContractTrace {
  kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_TRACE';
  plan: RunnerBoundaryContractPlan;
  result: RunnerBoundaryContractResult;
  persisted: BoolFalse;
}

export interface RunnerBoundaryValidation {
  ok: boolean;
  blocked_reason: RunnerBoundaryBlockedReason | null;
}

export function validateRunnerBoundaryContractInput(
  result: unknown,
): RunnerBoundaryValidation {
  const source = asRecord(result);
  if (source?.kind !== 'HUMAN_CONFIRMATION_CONTRACT_RESULT') return blocked('invalid_source_result_kind');

  const answer = asRecord(source.answer);
  if (!answer) return blocked('source_answer_missing');
  if (answer.contract_blocked === true) return blocked('source_contract_blocked');
  if (answer.executes_confirmation === true) return blocked('illegal_source_executes_confirmation');
  if (answer.contract_only !== true) return blocked('illegal_source_not_contract_only');
  if (answer.executable === true) return blocked('illegal_source_executable');
  if (answer.represents_executed_action === true) return blocked('illegal_source_executed_action');
  if (answer.human_confirmed === true) return blocked('illegal_source_human_confirmed');

  const safety = asRecord(answer.safety);
  if (safety?.reads_database === true) return blocked('illegal_source_reads_database');
  if (safety?.writes_database === true) return blocked('illegal_source_writes_database');

  const candidates = Array.isArray(answer.candidates) ? answer.candidates : [];
  const count = typeof answer.candidates_count === 'number' ? answer.candidates_count : 0;
  if (count <= 0 || candidates.length === 0) return blocked('source_candidates_empty');

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record?.human_confirmed === true) return blocked('illegal_candidate_human_confirmed');
    if (record?.confirmed === true) return blocked('illegal_candidate_confirmed');
    if (record?.approved === true) return blocked('illegal_candidate_approved');
    if (record?.executable === true) return blocked('illegal_candidate_executable');
    if (record?.executed === true) return blocked('illegal_candidate_executed');
    if (record?.persisted === true) return blocked('illegal_candidate_persisted');
    if (record?.writes_database === true) return blocked('illegal_candidate_writes_database');
    if (record?.represents_executed_action === true) {
      return blocked('illegal_candidate_represents_executed_action');
    }
    if (record?.represents_recorded_confirmation === true) {
      return blocked('illegal_candidate_represents_recorded_confirmation');
    }
    if (record?.contract_only !== true) return blocked('illegal_candidate_not_contract_only');
    if (record?.requires_human_review !== true) return blocked('illegal_candidate_missing_human_review');

    const operator = asRecord(record?.operator);
    if (operator?.resolved === true) return blocked('illegal_candidate_operator_resolved');
    if (operator?.represents_real_operator === true) return blocked('illegal_candidate_operator_real');
  }

  return { ok: true, blocked_reason: null };
}

export function buildRunnerBoundaryContractPlan(
  request: RunnerBoundaryContractRequest,
): RunnerBoundaryContractPlan {
  return {
    kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_PLAN',
    version: RUNNER_BOUNDARY_CONTRACT_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'action_runner_boundary_contract_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: [
      'validate_human_confirmation_contract_result',
      'project_runner_boundary_candidates',
      'build_runner_boundary_summary',
    ],
    forbidden_operations: [
      'read_db',
      'write_db',
      'render_ui',
      'record_real_human_confirmation',
      'resolve_operator_identity',
      'send_message',
      'mutate_state',
      ['call', ['pro', 'vider'].join('')].join('_'),
    ],
    safety: buildSafety(),
  };
}

export function runRunnerBoundaryContract(
  plan: RunnerBoundaryContractPlan,
): RunnerBoundaryContractResult {
  const source = plan.request.source_human_confirmation_contract_result;
  const validation = validateRunnerBoundaryContractInput(source);

  if (!validation.ok) return buildResult(plan, [], validation.blocked_reason);

  const candidates = source.answer.candidates.map((candidate, index) => (
    projectConfirmationCandidateToRunnerBoundaryCandidate(candidate, index)
  ));
  return buildResult(plan, candidates, null);
}

export function buildRunnerBoundaryContractTrace(
  plan: RunnerBoundaryContractPlan,
): RunnerBoundaryContractTrace {
  return {
    kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_TRACE',
    plan,
    result: runRunnerBoundaryContract(plan),
    persisted: FALSE_VALUE,
  };
}

export function projectConfirmationCandidateToRunnerBoundaryCandidate(
  candidate: HumanConfirmationContractCandidate,
  index: number,
): RunnerBoundaryCandidate {
  const status = mapRunnerStatus(candidate.confirmation_status);
  return {
    kind: 'ACTION_RUNNER_BOUNDARY_CANDIDATE',
    version: RUNNER_BOUNDARY_CONTRACT_VERSION,
    runner_boundary_candidate_id: `ACTION_RUNNER_BOUNDARY_LIVE_${String(index + 1).padStart(3, '0')}`,
    source_confirmation_candidate_id: candidate.confirmation_candidate_id,
    source_queue_item_id: candidate.source_queue_item_id,
    source_action_id: candidate.source_action_id,
    source_proposal_id: candidate.source_proposal_id,
    source_proposal_type: candidate.source_proposal_type,
    action_type: candidate.action_type,
    title: candidate.title,
    summary: candidate.summary,
    evidence_refs: candidate.evidence_refs,
    risk_flags: candidate.risk_flags,
    runner_status: status,
    blocked_reason: buildCandidateBlockedReason(candidate, status),
    required_confirmation_proof: buildRequiredConfirmationProofSchema(),
    required_operator_confirmation_dependency: buildRequiredOperatorConfirmationDependency(),
    pre_execution_requirements: buildPreExecutionRequirements(),
    execution_prohibition: buildExecutionProhibition(),
    idempotency: buildIdempotencyPlaceholder(candidate.source_action_id),
    contract_only: TRUE_VALUE,
    dry_run_only: TRUE_VALUE,
    ready_for_runner: FALSE_VALUE,
    executable: FALSE_VALUE,
    executed: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    human_confirmed: FALSE_VALUE,
    confirmed: FALSE_VALUE,
    approved: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_runner_execution: FALSE_VALUE,
    requires_real_human_confirmation: TRUE_VALUE,
  };
}

export function buildRunnerBoundarySummary(
  candidates: readonly RunnerBoundaryCandidate[],
): RunnerBoundarySummary {
  return {
    kind: 'ACTION_RUNNER_BOUNDARY_SUMMARY',
    version: RUNNER_BOUNDARY_CONTRACT_VERSION,
    total: candidates.length,
    blocked_requires_real_confirmation: candidates.filter(
      candidate => candidate.runner_status === 'blocked_requires_real_confirmation',
    ).length,
    blocked_source_confirmation_candidate: candidates.filter(
      candidate => candidate.runner_status === 'blocked_source_confirmation_candidate',
    ).length,
    by_action_type: countBy(candidates.map(candidate => candidate.action_type)),
    by_runner_status: countBy(candidates.map(candidate => candidate.runner_status)),
  };
}

function buildResult(
  plan: RunnerBoundaryContractPlan,
  candidates: readonly RunnerBoundaryCandidate[],
  blockedReason: RunnerBoundaryBlockedReason | null,
): RunnerBoundaryContractResult {
  const isBlocked = blockedReason !== null;
  return {
    kind: 'ACTION_RUNNER_BOUNDARY_CONTRACT_RESULT',
    version: RUNNER_BOUNDARY_CONTRACT_VERSION,
    plan,
    answer: {
      kind: 'ACTION_RUNNER_BOUNDARY_ANSWER',
      version: RUNNER_BOUNDARY_CONTRACT_VERSION,
      contract_only: TRUE_VALUE,
      dry_run_only: TRUE_VALUE,
      ready_for_runner: FALSE_VALUE,
      executable: FALSE_VALUE,
      executed: FALSE_VALUE,
      persisted: FALSE_VALUE,
      reads_database: FALSE_VALUE,
      writes_database: FALSE_VALUE,
      human_confirmed: FALSE_VALUE,
      confirmed: FALSE_VALUE,
      approved: FALSE_VALUE,
      represents_executed_action: FALSE_VALUE,
      represents_runner_execution: FALSE_VALUE,
      requires_real_human_confirmation: TRUE_VALUE,
      generated_runner_boundary_candidates: !isBlocked && candidates.length > 0,
      runner_boundary_candidates: isBlocked ? [] : candidates,
      runner_boundary_candidates_count: isBlocked ? 0 : candidates.length,
      runner_boundary_blocked: isBlocked,
      blocked_reason: blockedReason,
      summary: isBlocked ? emptySummary() : buildRunnerBoundarySummary(candidates),
      source_human_confirmation_contract_result: plan.request.source_human_confirmation_contract_result,
      safety: buildSafety(),
    },
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_runner_execution: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: RunnerBoundaryContractRequest,
): NormalizedRunnerBoundaryContractRequest {
  return {
    ...request,
    version: RUNNER_BOUNDARY_CONTRACT_VERSION,
  };
}

function mapRunnerStatus(status: HumanConfirmationStatus): RunnerBoundaryStatus {
  return status === 'blocked'
    ? 'blocked_source_confirmation_candidate'
    : 'blocked_requires_real_confirmation';
}

function buildCandidateBlockedReason(
  candidate: HumanConfirmationContractCandidate,
  status: RunnerBoundaryStatus,
): string {
  if (status === 'blocked_source_confirmation_candidate') {
    return candidate.blocked_reason ?? 'source_confirmation_candidate_blocked';
  }
  return 'requires_real_human_confirmation';
}

function buildRequiredConfirmationProofSchema(): RequiredConfirmationProofSchema {
  return {
    kind: 'REQUIRED_CONFIRMATION_PROOF_SCHEMA',
    schema_only: TRUE_VALUE,
    requires_real_human_confirmation: TRUE_VALUE,
    requires_operator_resolution: TRUE_VALUE,
    requires_confirmation_metadata_resolution: TRUE_VALUE,
    represents_recorded_confirmation: FALSE_VALUE,
    recorded_confirmation_proof: [],
  };
}

function buildRequiredOperatorConfirmationDependency(): RequiredOperatorConfirmationDependency {
  return {
    kind: 'REQUIRED_OPERATOR_CONFIRMATION_DEPENDENCY',
    version: RUNNER_BOUNDARY_CONTRACT_VERSION,
    dependency_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    represents_real_operator: FALSE_VALUE,
    persisted: FALSE_VALUE,
  };
}

function buildPreExecutionRequirements(): PreExecutionRequirements {
  return {
    kind: 'PRE_EXECUTION_REQUIREMENTS',
    requires_real_human_confirmation: TRUE_VALUE,
    requires_operator_resolution: TRUE_VALUE,
    requires_confirmation_metadata_resolution: TRUE_VALUE,
    requires_non_executable_source: TRUE_VALUE,
    requires_no_database_write: TRUE_VALUE,
    writable_for_execution: FALSE_VALUE,
  };
}

function buildExecutionProhibition(): RunnerExecutionProhibition {
  return {
    kind: 'RUNNER_EXECUTION_PROHIBITION',
    executes_action: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    mutates_state: FALSE_VALUE,
    sends_message: FALSE_VALUE,
    calls_provider: FALSE_VALUE,
    explicit_non_actions: [
      'Does not run an action',
      'Does not write database records',
      'Does not mutate customer, task, or work item state',
      'Does not send messages',
      'Does not call provider services',
    ],
  };
}

function buildIdempotencyPlaceholder(sourceActionId: string): RunnerIdempotencyPlaceholder {
  return {
    kind: 'RUNNER_IDEMPOTENCY_PLACEHOLDER',
    version: RUNNER_BOUNDARY_CONTRACT_VERSION,
    placeholder_only: TRUE_VALUE,
    resolved: FALSE_VALUE,
    persisted: FALSE_VALUE,
    usable_for_execution: FALSE_VALUE,
    value: `RUNNER_BOUNDARY_IDEMPOTENCY_${sourceActionId}`,
  };
}

function buildSafety(): RunnerBoundarySafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    executable: FALSE_VALUE,
    calls_provider: FALSE_VALUE,
  };
}

function emptySummary(): RunnerBoundarySummary {
  return buildRunnerBoundarySummary([]);
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function blocked(
  reason: RunnerBoundaryBlockedReason,
): RunnerBoundaryValidation {
  return { ok: false, blocked_reason: reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}
