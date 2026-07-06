import type {
  DashboardDataProjectionResult,
  DashboardDataProjectionRow,
  DashboardDataProjectionSummary,
} from '../../lib/dashboardDataProjectionReadiness';

export interface DashboardProjectionViewModel {
  valid: boolean;
  errorMessage: string | null;
  stage: 'Safe Write Runner Gate';
  statusBadges: readonly string[];
  safetyItems: readonly SafetyItemView[];
  summaryCards: readonly SummaryCardView[];
  rows: readonly DashboardProjectionRowView[];
  missingProofs: readonly MissingProofSummaryView[];
  blockedReasons: readonly CountView[];
  notices: readonly string[];
}

export interface SafetyItemView {
  label: string;
  value: string;
}

export interface SummaryCardView {
  label: string;
  value: string;
}

export interface DashboardProjectionRowView {
  id: string;
  title: string;
  displaySummary: string;
  actionType: string;
  rowStatus: string;
  attentionLevel: string;
  blockedReason: string;
  evidenceRefCount: number;
  riskFlagCount: number;
  missingRequirementNames: readonly string[];
  sourceRefs: readonly SafetyItemView[];
}

export interface MissingProofSummaryView {
  name: string;
  missingCount: number;
  affectedRows: readonly string[];
}

export interface CountView {
  label: string;
  count: number;
}

interface ProjectionValidation {
  valid: boolean;
  reason: string | null;
}

const EMPTY_SUMMARY: DashboardDataProjectionSummary = {
  kind: 'DASHBOARD_DATA_PROJECTION_SUMMARY',
  version: 'v1',
  total: 0,
  review_required: 0,
  source_blocked: 0,
  policy_blocked: 0,
  missing_evidence: 0,
  high_risk: 0,
  by_action_type: {},
  by_row_status: {},
  by_attention_level: {},
};

export function buildDashboardProjectionViewModel(
  projection: DashboardDataProjectionResult,
): DashboardProjectionViewModel {
  const validation = assertReadOnlyDashboardProjection(projection);
  const rows = validation.valid ? projection.answer.dashboard_rows : [];
  const summary = validation.valid ? projection.answer.summary : EMPTY_SUMMARY;

  return {
    valid: validation.valid,
    errorMessage: validation.reason,
    stage: 'Safe Write Runner Gate',
    statusBadges: ['Blocked', 'Not Executable', 'No DB Write', 'Read-only'],
    safetyItems: [
      { label: 'All rows blocked', value: rows.every(row => row.row_status.startsWith('blocked_')) ? 'yes' : 'needs review' },
      { label: 'No execution', value: 'not executable' },
      { label: 'No DB Write', value: 'does not write database' },
      { label: 'No SQL', value: 'none generated or used' },
      { label: 'No transaction', value: 'none opened' },
      { label: 'No provider call', value: 'none made' },
      { label: 'Projection only', value: projection.answer?.projection_only === true ? 'yes' : 'needs review' },
    ],
    summaryCards: [
      { label: 'Total rows', value: String(summary.total) },
      { label: 'Review required', value: String(summary.review_required) },
      { label: 'Source blocked', value: String(summary.source_blocked) },
      { label: 'Policy blocked', value: String(summary.policy_blocked) },
      { label: 'Missing evidence', value: String(summary.missing_evidence) },
      { label: 'High risk', value: String(summary.high_risk) },
    ],
    rows: rows.map(mapDashboardRowToView),
    missingProofs: summarizeMissingProofs(rows),
    blockedReasons: countValues(rows.map(row => row.blocked_reason)),
    notices: validation.valid
      ? [
          'This dashboard is projection-only and read-only.',
          'No action was executed.',
          'No DB write happened.',
          'No SQL was generated or executed.',
          'No real human confirmation is represented.',
        ]
      : [
          'Invalid projection - not shown as valid.',
          'This dashboard remains read-only.',
          'No action was executed.',
          'No DB write happened.',
        ],
  };
}

export function assertReadOnlyDashboardProjection(
  projection: DashboardDataProjectionResult,
): ProjectionValidation {
  const answer = projection?.answer;
  if (projection?.kind !== 'DASHBOARD_DATA_PROJECTION_RESULT') {
    return invalid('Invalid projection kind');
  }
  if (!answer) return invalid('Projection answer missing');
  if (answer.projection_only !== true) return invalid('Projection only flag missing');
  if (answer.dashboard_data_only !== true) return invalid('Dashboard data only flag missing');
  if (answer.source_gate_only !== true) return invalid('Source gate only flag missing');
  if (answer.renders_surface !== false) return invalid('Projection cannot render as an active surface');
  if (answer.reads_database !== false) return invalid('Projection cannot read database');
  if (answer.writes_database !== false) return invalid('Projection cannot write database');
  if (answer.executes_sql !== false) return invalid('Projection cannot use SQL');
  if (answer.executable !== false) return invalid('Projection cannot be executable');
  if (!Array.isArray(answer.dashboard_rows)) return invalid('Projection rows missing');

  const unsafeRow = answer.dashboard_rows.find(row => (
    !row.row_status.startsWith('blocked_')
    || row.ready_to_write !== false
    || row.ready_for_runner !== false
    || row.executable !== false
    || row.executed !== false
    || row.write_executed !== false
    || row.persisted !== false
    || row.reads_database !== false
    || row.writes_database !== false
    || row.executes_sql !== false
    || row.opens_transaction !== false
    || row.renders_surface !== false
  ));
  if (unsafeRow) return invalid(`Unsafe row state: ${unsafeRow.projection_row_id}`);

  return { valid: true, reason: null };
}

export function summarizeMissingProofs(
  rows: readonly DashboardDataProjectionRow[],
): readonly MissingProofSummaryView[] {
  const grouped = rows.reduce<Record<string, { count: number; affectedRows: string[] }>>((acc, row) => {
    for (const name of row.missing_requirement_names) {
      const current = acc[name] ?? { count: 0, affectedRows: [] };
      current.count += 1;
      current.affectedRows.push(row.projection_row_id);
      acc[name] = current;
    }
    return acc;
  }, {});

  return Object.entries(grouped)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      missingCount: value.count,
      affectedRows: value.affectedRows,
    }));
}

export function mapDashboardRowToView(
  row: DashboardDataProjectionRow,
): DashboardProjectionRowView {
  return {
    id: row.projection_row_id,
    title: row.title,
    displaySummary: row.display_summary,
    actionType: safeActionTypeLabel(row.action_type),
    rowStatus: row.row_status,
    attentionLevel: row.attention_level,
    blockedReason: row.blocked_reason,
    evidenceRefCount: row.evidence_ref_count,
    riskFlagCount: row.risk_flag_count,
    missingRequirementNames: row.missing_requirement_names,
    sourceRefs: [
      { label: 'Projection row', value: row.projection_row_id },
      { label: 'Gate candidate', value: row.source_safe_write_runner_candidate_id },
      { label: 'Write plan candidate', value: row.source_write_plan_candidate_id },
      { label: 'Proposal', value: row.source_proposal_id },
    ],
  };
}

function countValues(values: readonly string[]): readonly CountView[] {
  const grouped = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(grouped)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => ({ label, count }));
}

function safeActionTypeLabel(actionType: string): string {
  return actionType.replace(/^CONFIRM_/, 'REVIEW_');
}

function invalid(reason: string): ProjectionValidation {
  return { valid: false, reason };
}
