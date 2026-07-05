import {
  adaptLoadedSnapshot,
  buildReadOnlyAgentSnapshotAdapterPlan,
  type ReadOnlyAgentSnapshotAdapterResult,
} from './readOnlyAgentSnapshotAdapterReadiness';
import type { LoadedReadOnlyAgentSnapshot } from './readOnlySnapshotLoaderReadiness';
import {
  answerReadOnlyAgentQueryForCollections,
  type ReadOnlyAgentAnswer,
  type ReadOnlyAgentCollectedLead,
  type ReadOnlyAgentContext,
  type ReadOnlyAgentCustomer,
  type ReadOnlyAgentImportRow,
  type ReadOnlyAgentIntent,
  type ReadOnlyAgentReplayEvidence,
  type ReadOnlyAgentSnapshotCollections,
  type ReadOnlyAgentTask,
  type ReadOnlyAgentWorkItem,
} from './readOnlyAgentReadiness';

export const READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;

export interface ReadOnlyAgentLiveDryRunRequest {
  kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_REQUEST';
  version?: typeof READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION;
  request_id: string;
  intent: ReadOnlyAgentIntent;
  loaded_snapshot: LoadedReadOnlyAgentSnapshot;
  context?: ReadOnlyAgentContext;
  target_customer_id?: string;
  target_work_item_id?: string;
}

export interface NormalizedReadOnlyAgentLiveDryRunRequest extends ReadOnlyAgentLiveDryRunRequest {
  version: typeof READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION;
  context: ReadOnlyAgentContext;
}

export interface ReadOnlyAgentLiveDryRunSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  no_side_effects: BoolTrue;
  no_provider_calls: BoolTrue;
  no_network: BoolTrue;
  executable: BoolFalse;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
  represents_live_agent_product: BoolFalse;
  dry_run_only: BoolTrue;
  generated_proposals: BoolFalse;
  generated_envelopes: BoolFalse;
  invokes_read_only_agent: boolean;
}

export interface ReadOnlyAgentLiveDryRunPlan {
  kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_PLAN';
  version: typeof READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'read_only_agent_live_dry_run_readiness_only';
  request: NormalizedReadOnlyAgentLiveDryRunRequest;
  allowed_operations: readonly ['adapt_loaded_snapshot', 'bridge_collections', 'emit_dry_run_answer'];
  forbidden_operations: readonly string[];
  safety: ReadOnlyAgentLiveDryRunSafety;
}

export interface ReadOnlyAgentLiveDryRunAnswer {
  kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_ANSWER';
  version: typeof READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION;
  dry_run_only: BoolTrue;
  source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT';
  source_snapshot_id: string;
  load_source: 'sqlite_read_only';
  source_is_loaded_snapshot: BoolTrue;
  adapter_result: ReadOnlyAgentSnapshotAdapterResult;
  read_only_answer: ReadOnlyAgentAnswer | null;
  dry_run_blocked: boolean;
  blocked_reason: string | null;
  invokes_read_only_agent: boolean;
  generated_findings: boolean;
  generated_proposals: BoolFalse;
  generated_envelopes: BoolFalse;
  finding_evidence_uses_agent_internal_refs: BoolTrue;
  safety: ReadOnlyAgentLiveDryRunSafety;
  represents_executed_action: BoolFalse;
}

export interface ReadOnlyAgentLiveDryRunResult {
  kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_RESULT';
  version: typeof READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION;
  plan: ReadOnlyAgentLiveDryRunPlan;
  answer: ReadOnlyAgentLiveDryRunAnswer;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
}

export interface ReadOnlyAgentLiveDryRunTrace {
  kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_TRACE';
  plan: ReadOnlyAgentLiveDryRunPlan;
  result: ReadOnlyAgentLiveDryRunResult;
  persisted: BoolFalse;
}

export function buildReadOnlyAgentLiveDryRunPlan(
  request: ReadOnlyAgentLiveDryRunRequest,
): ReadOnlyAgentLiveDryRunPlan {
  return {
    kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_PLAN',
    version: READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'read_only_agent_live_dry_run_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: ['adapt_loaded_snapshot', 'bridge_collections', 'emit_dry_run_answer'],
    forbidden_operations: [
      'read_db',
      'write_db',
      'load_snapshot',
      'generate_proposals',
      'emit_envelopes',
      'call_provider',
      'execute_action',
      'persist_answer',
    ],
    safety: buildSafety(FALSE_VALUE),
  };
}

export function mapRequestCandidateToSnapshotCollections(
  requestCandidate: ReadOnlyAgentSnapshotAdapterResult['request_candidate'],
): ReadOnlyAgentSnapshotCollections {
  const snapshot = requestCandidate.snapshot;

  return {
    work_items: snapshot.work_items.map(item => ({
      id: item.id,
      customer_id: item.customer_id,
      collected_lead_id: item.collected_lead_id,
      company_name: item.company_name,
      status: mapWorkItemStatus(item.status),
      priority: item.priority,
      updated_at: item.updated_at,
      due_at: item.due_at,
      lookup_goal: item.lookup_goal,
    })),
    collected_leads: snapshot.collected_leads.map(item => ({
      id: item.id,
      work_item_id: item.work_item_id ?? '',
      customer_id: item.customer_id,
      company_name: item.company_name,
      intent_level: mapIntentLevel(item.intent_level),
      lead_grade: mapGrade(item.lead_grade),
      sync_status: mapSyncStatus(item.sync_status),
    })),
    replay_evidence: snapshot.replay_evidence.map(item => ({
      id: item.id,
      work_item_id: item.work_item_id,
      collected_lead_id: item.collected_lead_id,
      customer_id: item.customer_id,
      status: mapReplayStatus(item.status),
      message: item.message,
      created_at: item.created_at,
    })),
    import_rows: snapshot.import_rows.map(item => ({
      id: item.id,
      customer_id: item.customer_id,
      company_name: item.company_name,
      decision: mapDecision(item.decision),
      decision_status: mapDecisionStatus(item.decision_status),
      intent_level: mapIntentLevel(item.intent_level),
      lead_grade: mapGrade(item.lead_grade),
    })),
    customers: snapshot.customers.map(item => ({
      id: item.id,
      name: item.name,
      customer_grade: mapGrade(item.customer_grade),
      intent_level: mapIntentLevel(item.intent_level),
    })),
    tasks: snapshot.tasks.map(item => ({
      id: item.id,
      customer_id: item.customer_id,
      title: item.title,
      status: mapTaskStatus(item.status),
      priority: item.priority,
      due_at: item.due_at,
    })),
    capture_events: snapshot.capture_events.map(item => ({
      id: item.id,
      work_item_id: item.work_item_id,
      customer_id: item.customer_id,
      action: item.action,
      created_at: item.created_at,
      summary: item.summary,
    })),
    prompt_plans: snapshot.prompt_plans,
    model_invocations: snapshot.model_invocations,
    eval_summaries: snapshot.eval_summaries,
  };
}

export function runReadOnlyAgentLiveDryRun(
  plan: ReadOnlyAgentLiveDryRunPlan,
): ReadOnlyAgentLiveDryRunResult {
  const adapterResult = adaptLoadedSnapshot(buildReadOnlyAgentSnapshotAdapterPlan({
    kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_REQUEST',
    request_id: plan.request.request_id,
    intent: plan.request.intent,
    loaded_snapshot: plan.request.loaded_snapshot,
    context: plan.request.context,
    target_customer_id: plan.request.target_customer_id,
    target_work_item_id: plan.request.target_work_item_id,
  }));
  const blocked = adapterResult.adaptation_blocked || !adapterResult.pii_check.passed;
  const safety = buildSafety(!blocked);
  const readOnlyAnswer = blocked ? null : answerReadOnlyAgentQueryForCollections({
    intent: adapterResult.request_candidate.intent,
    collections: mapRequestCandidateToSnapshotCollections(adapterResult.request_candidate),
    context: adapterResult.request_candidate.context,
    target_customer_id: adapterResult.request_candidate.target_customer_id,
    target_work_item_id: adapterResult.request_candidate.target_work_item_id,
  });
  const answer: ReadOnlyAgentLiveDryRunAnswer = {
    kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_ANSWER',
    version: READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION,
    dry_run_only: TRUE_VALUE,
    source_snapshot_kind: adapterResult.snapshot_candidate.source_snapshot_kind,
    source_snapshot_id: adapterResult.snapshot_candidate.source_snapshot_id,
    load_source: adapterResult.snapshot_candidate.load_source,
    source_is_loaded_snapshot: adapterResult.request_candidate.source_is_loaded_snapshot,
    adapter_result: adapterResult,
    read_only_answer: readOnlyAnswer,
    dry_run_blocked: blocked,
    blocked_reason: blocked ? adapterResult.blocked_reason ?? 'adapter_blocked' : null,
    invokes_read_only_agent: !blocked,
    generated_findings: (readOnlyAnswer?.findings.length ?? 0) > 0,
    generated_proposals: FALSE_VALUE,
    generated_envelopes: FALSE_VALUE,
    finding_evidence_uses_agent_internal_refs: TRUE_VALUE,
    safety,
    represents_executed_action: FALSE_VALUE,
  };

  return {
    kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_RESULT',
    version: READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION,
    plan,
    answer,
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
  };
}

export function buildReadOnlyAgentLiveDryRunTrace(
  plan: ReadOnlyAgentLiveDryRunPlan,
): ReadOnlyAgentLiveDryRunTrace {
  return {
    kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_TRACE',
    plan,
    result: runReadOnlyAgentLiveDryRun(plan),
    persisted: FALSE_VALUE,
  };
}

function normalizeRequest(
  request: ReadOnlyAgentLiveDryRunRequest,
): NormalizedReadOnlyAgentLiveDryRunRequest {
  return {
    ...request,
    version: READ_ONLY_AGENT_LIVE_DRY_RUN_VERSION,
    context: request.context ?? request.loaded_snapshot.context,
  };
}

function buildSafety(invokesReadOnlyAgent: boolean): ReadOnlyAgentLiveDryRunSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    no_side_effects: TRUE_VALUE,
    no_provider_calls: TRUE_VALUE,
    no_network: TRUE_VALUE,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    represents_live_agent_product: FALSE_VALUE,
    dry_run_only: TRUE_VALUE,
    generated_proposals: FALSE_VALUE,
    generated_envelopes: FALSE_VALUE,
    invokes_read_only_agent: invokesReadOnlyAgent,
  };
}

function mapWorkItemStatus(status: string): ReadOnlyAgentWorkItem['status'] {
  if (status === 'TODO' || status === 'SEARCHING' || status === 'STAGED' || status === 'COLLECTED') return status;
  if (status === 'NO_PHONE' || status === 'SKIPPED' || status === 'DONE') return status;
  return 'TODO';
}

function mapSyncStatus(status: string): ReadOnlyAgentCollectedLead['sync_status'] {
  if (status === 'CREATED' || status === 'ENRICHED' || status === 'FAILED' || status === 'SKIPPED') return status;
  return 'PENDING';
}

function mapReplayStatus(status: string): ReadOnlyAgentReplayEvidence['status'] {
  if (status === 'FAILED' || status === 'SKIPPED') return status;
  return 'OK';
}

function mapDecision(decision: string): ReadOnlyAgentImportRow['decision'] {
  if (decision === 'DIRECT_TO_CRM' || decision === 'CRM_WITH_LOOKUP' || decision === 'LOOKUP_FIRST') return decision;
  return 'NOOP';
}

function mapDecisionStatus(status: string): ReadOnlyAgentImportRow['decision_status'] {
  if (status === 'DONE' || status === 'FAILED' || status === 'SKIPPED') return status;
  return 'PENDING';
}

function mapGrade(grade: string): ReadOnlyAgentCustomer['customer_grade'] {
  if (grade === 'A' || grade === 'B' || grade === 'C' || grade === 'D') return grade;
  return 'UNKNOWN';
}

function mapIntentLevel(intentLevel: string): ReadOnlyAgentCustomer['intent_level'] {
  if (intentLevel === 'HIGH' || intentLevel === 'MEDIUM' || intentLevel === 'LOW' || intentLevel === 'NONE') {
    return intentLevel;
  }
  return 'UNKNOWN';
}

function mapTaskStatus(status: string): ReadOnlyAgentTask['status'] {
  return status === 'DONE' ? 'DONE' : 'TODO';
}
