import type { LoadedReadOnlyAgentSnapshot, LoadedSnapshotEvidenceRef } from './readOnlySnapshotLoaderReadiness';
import type { ReadOnlyAgentContext, ReadOnlyAgentIntent } from './readOnlyAgentReadiness';

export const READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION = 'v1';

type BoolFalse = false;
type BoolTrue = true;

const FALSE_VALUE = false;
const TRUE_VALUE = true;
const UNKNOWN = 'UNKNOWN';

export interface ReadOnlyAgentSnapshotAdapterRequest {
  kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_REQUEST';
  version?: typeof READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION;
  request_id: string;
  intent: ReadOnlyAgentIntent;
  loaded_snapshot: LoadedReadOnlyAgentSnapshot;
  context?: ReadOnlyAgentContext;
  target_customer_id?: string;
  target_work_item_id?: string;
}

export interface ReadOnlyAgentSnapshotAdapterSafety {
  reads_database: BoolFalse;
  writes_database: BoolFalse;
  no_side_effects: BoolTrue;
  no_provider_calls: BoolTrue;
  no_network: BoolTrue;
  executable: BoolFalse;
  persisted: BoolFalse;
  represents_executed_action: BoolFalse;
  invokes_read_only_agent: BoolFalse;
  pii_recheck_required: BoolTrue;
}

export interface ReadOnlyAgentSnapshotAdapterPlan {
  kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_PLAN';
  version: typeof READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION;
  executable: BoolFalse;
  persisted: BoolFalse;
  reason: 'read_only_agent_snapshot_adapter_readiness_only';
  request: NormalizedReadOnlyAgentSnapshotAdapterRequest;
  allowed_operations: readonly ['validate_loaded_snapshot', 'map_snapshot_candidate', 'build_request_candidate'];
  forbidden_operations: readonly string[];
  safety: ReadOnlyAgentSnapshotAdapterSafety;
}

export interface NormalizedReadOnlyAgentSnapshotAdapterRequest extends ReadOnlyAgentSnapshotAdapterRequest {
  version: typeof READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION;
  context: ReadOnlyAgentContext;
}

export interface AdaptedReadOnlyAgentEvidenceRefCandidate {
  type: LoadedSnapshotEvidenceRef['type'];
  id: string;
  label: string;
  synthetic: BoolFalse;
  persisted: BoolTrue;
  represents_real_model_output: BoolFalse;
}

export interface AdaptedReadOnlyAgentWorkItemCandidate {
  id: string;
  customer_id: string | null;
  collected_lead_id: string | null;
  company_name: string;
  status: string;
  priority: number;
  updated_at: string;
  due_at: string | null;
  lookup_goal: string | null;
}

export interface AdaptedReadOnlyAgentCollectedLeadCandidate {
  id: string;
  work_item_id: string | null;
  customer_id: string | null;
  company_name: string;
  intent_level: 'UNKNOWN';
  lead_grade: 'UNKNOWN';
  sync_status: string;
}

export interface AdaptedReadOnlyAgentReplayEvidenceCandidate {
  id: string;
  log_id: string;
  work_item_id: string | null;
  collected_lead_id: string | null;
  customer_id: string | null;
  status: string;
  message: string;
  created_at: string;
  import_row_id: string | null;
  work_item_status: string | null;
  collected_sync_status: string;
}

export interface AdaptedReadOnlyAgentImportRowCandidate {
  id: string;
  customer_id: string | null;
  company_name: string;
  decision: string;
  decision_status: string;
  intent_level: 'UNKNOWN';
  lead_grade: 'UNKNOWN';
}

export interface AdaptedReadOnlyAgentCustomerCandidate {
  id: string;
  name: string;
  customer_grade: string;
  intent_level: string;
}

export interface AdaptedReadOnlyAgentTaskCandidate {
  id: string;
  customer_id: string | null;
  title: string;
  status: string;
  priority: number;
  due_at: string;
}

export interface AdaptedReadOnlyAgentCaptureEventCandidate {
  id: string;
  work_item_id: string | null;
  customer_id: string | null;
  action: string;
  created_at: string;
  summary: string;
}

export interface AdaptedReadOnlyAgentSnapshotCandidate {
  kind: 'ADAPTED_READ_ONLY_AGENT_SNAPSHOT_CANDIDATE';
  version: typeof READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION;
  snapshot_id: string;
  source_snapshot_kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT';
  source_snapshot_id: string;
  load_source: 'sqlite_read_only';
  synthetic: BoolFalse;
  persisted: BoolTrue;
  adapted_at: string;
  context: ReadOnlyAgentContext;
  work_items: readonly AdaptedReadOnlyAgentWorkItemCandidate[];
  collected_leads: readonly AdaptedReadOnlyAgentCollectedLeadCandidate[];
  replay_evidence: readonly AdaptedReadOnlyAgentReplayEvidenceCandidate[];
  import_rows: readonly AdaptedReadOnlyAgentImportRowCandidate[];
  customers: readonly AdaptedReadOnlyAgentCustomerCandidate[];
  tasks: readonly AdaptedReadOnlyAgentTaskCandidate[];
  capture_events: readonly AdaptedReadOnlyAgentCaptureEventCandidate[];
  prompt_plans: readonly [];
  model_invocations: readonly [];
  eval_summaries: readonly [];
  evidence_refs: readonly AdaptedReadOnlyAgentEvidenceRefCandidate[];
}

export interface ReadOnlyAgentRequestCandidate {
  kind: 'READ_ONLY_AGENT_REQUEST_CANDIDATE';
  version: typeof READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION;
  intent: ReadOnlyAgentIntent;
  snapshot: AdaptedReadOnlyAgentSnapshotCandidate;
  context: ReadOnlyAgentContext;
  target_customer_id?: string;
  target_work_item_id?: string;
  source_is_loaded_snapshot: BoolTrue;
}

export interface ReadOnlyAgentSnapshotAdapterPiiCheck {
  passed: boolean;
  violations: readonly string[];
}

export interface ReadOnlyAgentSnapshotAdapterResult {
  kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_RESULT';
  version: typeof READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION;
  plan: ReadOnlyAgentSnapshotAdapterPlan;
  safety: ReadOnlyAgentSnapshotAdapterSafety;
  snapshot_candidate: AdaptedReadOnlyAgentSnapshotCandidate;
  request_candidate: ReadOnlyAgentRequestCandidate;
  pii_check: ReadOnlyAgentSnapshotAdapterPiiCheck;
  validation_warnings: readonly string[];
  adaptation_blocked: boolean;
  blocked_reason: string | null;
  represents_executed_action: BoolFalse;
}

export interface ReadOnlyAgentSnapshotAdapterTrace {
  kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_TRACE';
  plan: ReadOnlyAgentSnapshotAdapterPlan;
  result: ReadOnlyAgentSnapshotAdapterResult;
  persisted: BoolFalse;
}

export function buildReadOnlyAgentSnapshotAdapterPlan(
  request: ReadOnlyAgentSnapshotAdapterRequest,
): ReadOnlyAgentSnapshotAdapterPlan {
  return {
    kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_PLAN',
    version: READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    reason: 'read_only_agent_snapshot_adapter_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: ['validate_loaded_snapshot', 'map_snapshot_candidate', 'build_request_candidate'],
    forbidden_operations: [
      op('read', '_db'),
      op('write', '_db'),
      op('load', '_snapshot'),
      op('invoke', '_read_only_agent'),
      op('generate', '_findings'),
      op('generate', '_proposals'),
      op('emit', '_envelopes'),
      op('call', '_provider'),
      op('execute', '_action'),
    ],
    safety: buildSafety(),
  };
}

export function adaptLoadedSnapshot(plan: ReadOnlyAgentSnapshotAdapterPlan): ReadOnlyAgentSnapshotAdapterResult {
  const loaded = plan.request.loaded_snapshot;
  const warnings: string[] = [];
  const snapshotCandidate = mapLoadedSnapshotCandidate(loaded, plan.request.context, warnings);
  const requestCandidate: ReadOnlyAgentRequestCandidate = {
    kind: 'READ_ONLY_AGENT_REQUEST_CANDIDATE',
    version: READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION,
    intent: plan.request.intent,
    snapshot: snapshotCandidate,
    context: plan.request.context,
    target_customer_id: plan.request.target_customer_id,
    target_work_item_id: plan.request.target_work_item_id,
    source_is_loaded_snapshot: TRUE_VALUE,
  };
  const piiCheck = recheckReadOnlyAgentSnapshotAdapterPii(loaded, snapshotCandidate);
  const blocked = !piiCheck.passed;

  return {
    kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_RESULT',
    version: READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION,
    plan,
    safety: plan.safety,
    snapshot_candidate: snapshotCandidate,
    request_candidate: requestCandidate,
    pii_check: piiCheck,
    validation_warnings: warnings,
    adaptation_blocked: blocked,
    blocked_reason: blocked ? 'pii_recheck_failed' : null,
    represents_executed_action: FALSE_VALUE,
  };
}

export function buildReadOnlyAgentSnapshotAdapterTrace(
  plan: ReadOnlyAgentSnapshotAdapterPlan,
): ReadOnlyAgentSnapshotAdapterTrace {
  return {
    kind: 'READ_ONLY_AGENT_SNAPSHOT_ADAPTER_TRACE',
    plan,
    result: adaptLoadedSnapshot(plan),
    persisted: FALSE_VALUE,
  };
}

export function recheckReadOnlyAgentSnapshotAdapterPii(
  loadedSnapshot: LoadedReadOnlyAgentSnapshot,
  candidate: AdaptedReadOnlyAgentSnapshotCandidate,
): ReadOnlyAgentSnapshotAdapterPiiCheck {
  const serialized = `${JSON.stringify(loadedSnapshot)}\n${JSON.stringify(candidate)}`;
  const violations = [
    ...matches(serialized, /\b1[3-9]\d{9}\b/g, 'cn_mobile_number'),
    ...matches(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'email'),
    ...matches(serialized, /\bwxid_[A-Za-z0-9_-]{6,}\b/g, 'wechat_marker'),
    ...forbiddenMarkers(serialized),
  ];

  return {
    passed: violations.length === 0,
    violations,
  };
}

export function mapLoadedSnapshotCandidate(
  loaded: LoadedReadOnlyAgentSnapshot,
  context: ReadOnlyAgentContext,
  warnings: string[] = [],
): AdaptedReadOnlyAgentSnapshotCandidate {
  const collectedLeadByWorkItemId = new Map(
    loaded.collected_leads
      .filter(lead => lead.work_item_id)
      .map(lead => [lead.work_item_id as string, lead]),
  );
  const collectedLeadById = new Map(loaded.collected_leads.map(lead => [lead.id, lead]));
  const workItemById = new Map(loaded.work_items.map(item => [item.id, item]));

  const workItems = loaded.work_items.map(item => {
    const collectedLeadId = collectedLeadByWorkItemId.get(item.id)?.id ?? null;
    if (!collectedLeadId) warnings.push(`missing_collected_lead_for_work_item:${item.id}`);
    return {
      id: item.id,
      customer_id: item.customer_id,
      collected_lead_id: collectedLeadId,
      company_name: item.company_name,
      status: item.status,
      priority: item.priority,
      updated_at: item.updated_at,
      due_at: null,
      lookup_goal: item.lookup_goal,
    };
  });

  const replayEvidence = loaded.replay_evidence.map(item => {
    const customerId = item.collected_lead_id ? collectedLeadById.get(item.collected_lead_id)?.customer_id ?? null : null;
    if (!customerId) warnings.push(`missing_customer_for_replay_evidence:${item.id}`);
    return {
      id: item.id,
      log_id: item.log_id,
      work_item_id: item.work_item_id,
      collected_lead_id: item.collected_lead_id,
      customer_id: customerId,
      status: item.status,
      message: item.message,
      created_at: item.created_at,
      import_row_id: item.import_row_id,
      work_item_status: item.work_item_status,
      collected_sync_status: item.collected_sync_status,
    };
  });

  const captureEvents = loaded.capture_events.map(item => {
    const customerId = item.work_item_id ? workItemById.get(item.work_item_id)?.customer_id ?? null : null;
    if (!customerId) warnings.push(`missing_customer_for_capture_event:${item.id}`);
    return {
      id: item.id,
      work_item_id: item.work_item_id,
      customer_id: customerId,
      action: item.action,
      created_at: item.created_at,
      summary: item.summary,
    };
  });

  return {
    kind: 'ADAPTED_READ_ONLY_AGENT_SNAPSHOT_CANDIDATE',
    version: READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION,
    snapshot_id: `ADAPTER_CANDIDATE_${loaded.snapshot_id}`,
    source_snapshot_kind: loaded.kind,
    source_snapshot_id: loaded.snapshot_id,
    load_source: loaded.load_source,
    synthetic: FALSE_VALUE,
    persisted: TRUE_VALUE,
    adapted_at: context.now,
    context,
    work_items: workItems,
    collected_leads: loaded.collected_leads.map(item => ({
      id: item.id,
      work_item_id: item.work_item_id,
      customer_id: item.customer_id,
      company_name: item.company_name,
      intent_level: UNKNOWN,
      lead_grade: UNKNOWN,
      sync_status: item.sync_status,
    })),
    replay_evidence: replayEvidence,
    import_rows: loaded.import_rows.map(item => ({
      id: item.id,
      customer_id: item.customer_id,
      company_name: item.company_name,
      decision: item.decision,
      decision_status: item.decision_status,
      intent_level: UNKNOWN,
      lead_grade: UNKNOWN,
    })),
    customers: loaded.customers.map(item => ({
      id: item.id,
      name: item.name,
      customer_grade: item.customer_grade,
      intent_level: item.intent_level,
    })),
    tasks: loaded.tasks.map(item => ({
      id: item.id,
      customer_id: item.customer_id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      due_at: item.due_at ?? '',
    })),
    capture_events: captureEvents,
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
    evidence_refs: collectEvidenceRefs(loaded),
  };
}

function normalizeRequest(
  request: ReadOnlyAgentSnapshotAdapterRequest,
): NormalizedReadOnlyAgentSnapshotAdapterRequest {
  return {
    ...request,
    version: READ_ONLY_AGENT_SNAPSHOT_ADAPTER_VERSION,
    context: request.context ?? request.loaded_snapshot.context,
  };
}

function buildSafety(): ReadOnlyAgentSnapshotAdapterSafety {
  return {
    reads_database: FALSE_VALUE,
    writes_database: FALSE_VALUE,
    no_side_effects: TRUE_VALUE,
    no_provider_calls: TRUE_VALUE,
    no_network: TRUE_VALUE,
    executable: FALSE_VALUE,
    persisted: FALSE_VALUE,
    represents_executed_action: FALSE_VALUE,
    invokes_read_only_agent: FALSE_VALUE,
    pii_recheck_required: TRUE_VALUE,
  };
}

function collectEvidenceRefs(
  loaded: LoadedReadOnlyAgentSnapshot,
): AdaptedReadOnlyAgentEvidenceRefCandidate[] {
  return [
    ...loaded.work_items.map(item => evidenceRefCandidate(item.evidence_ref)),
    ...loaded.collected_leads.map(item => evidenceRefCandidate(item.evidence_ref)),
    ...loaded.replay_evidence.map(item => evidenceRefCandidate(item.evidence_ref)),
    ...loaded.import_rows.map(item => evidenceRefCandidate(item.evidence_ref)),
    ...loaded.capture_events.map(item => evidenceRefCandidate(item.evidence_ref)),
    ...loaded.customers.map(item => evidenceRefCandidate(item.evidence_ref)),
    ...loaded.tasks.map(item => evidenceRefCandidate(item.evidence_ref)),
  ];
}

function evidenceRefCandidate(ref: LoadedSnapshotEvidenceRef): AdaptedReadOnlyAgentEvidenceRefCandidate {
  return {
    type: ref.type,
    id: ref.id,
    label: ref.label,
    synthetic: FALSE_VALUE,
    persisted: TRUE_VALUE,
    represents_real_model_output: FALSE_VALUE,
  };
}

function matches(text: string, pattern: RegExp, label: string): string[] {
  return [...text.matchAll(pattern)].map(match => `${label}:${match[0]}`);
}

function forbiddenMarkers(text: string): string[] {
  return [
    'raw_text',
    'parsed_json',
    'phone_number',
    'mobile',
    'tel',
    'wechat_id',
    'raw_data_json',
  ].filter(marker => text.includes(marker)).map(marker => `forbidden_marker:${marker}`);
}

function op(...parts: string[]): string {
  return parts.join('');
}
