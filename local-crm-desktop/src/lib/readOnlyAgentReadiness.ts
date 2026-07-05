export const READ_ONLY_AGENT_VERSION = 'v1';

export type ReadOnlyAgentIntent =
  | 'today_priorities'
  | 'stuck_work_items'
  | 'sync_failures'
  | 'high_intent_leads'
  | 'evidence_for_customer'
  | 'next_best_read_only_summary';

export type ReadOnlyAgentEvidenceType =
  | 'lead_work_item'
  | 'collected_lead'
  | 'lead_sync_log'
  | 'import_row'
  | 'customer'
  | 'task'
  | 'capture_event'
  | 'prompt_plan'
  | 'model_invocation'
  | 'eval_summary';

export interface ReadOnlyAgentEvidenceRef {
  type: ReadOnlyAgentEvidenceType;
  id: string;
  label: string;
  synthetic: true;
  persisted: false;
  represents_real_model_output: false;
}

export interface ReadOnlyAgentContext {
  active_profile_id: string;
  now: string;
}

export interface ReadOnlyAgentWorkItem {
  id: string;
  customer_id?: string | null;
  collected_lead_id?: string | null;
  company_name: string;
  status: 'TODO' | 'SEARCHING' | 'STAGED' | 'COLLECTED' | 'NO_PHONE' | 'SKIPPED' | 'DONE';
  priority: number;
  updated_at: string;
  due_at?: string | null;
  lookup_goal?: string | null;
}

export interface ReadOnlyAgentCollectedLead {
  id: string;
  work_item_id: string;
  customer_id?: string | null;
  company_name: string;
  intent_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN';
  lead_grade: 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';
  sync_status: 'PENDING' | 'CREATED' | 'ENRICHED' | 'FAILED' | 'SKIPPED';
}

export interface ReadOnlyAgentReplayEvidence {
  id: string;
  work_item_id?: string | null;
  collected_lead_id?: string | null;
  customer_id?: string | null;
  status: 'OK' | 'FAILED' | 'SKIPPED';
  message: string;
  created_at: string;
}

export interface ReadOnlyAgentImportRow {
  id: string;
  customer_id?: string | null;
  company_name: string;
  decision: 'DIRECT_TO_CRM' | 'CRM_WITH_LOOKUP' | 'LOOKUP_FIRST' | 'NOOP';
  decision_status: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED';
  intent_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN';
  lead_grade: 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';
}

export interface ReadOnlyAgentCustomer {
  id: string;
  name: string;
  customer_grade: 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';
  intent_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN';
}

export interface ReadOnlyAgentTask {
  id: string;
  customer_id?: string | null;
  title: string;
  status: 'TODO' | 'DONE';
  priority: number;
  due_at: string;
}

export interface ReadOnlyAgentSnapshot {
  kind: 'READ_ONLY_AGENT_SNAPSHOT';
  version: typeof READ_ONLY_AGENT_VERSION;
  snapshot_id: string;
  synthetic: true;
  persisted: false;
  work_items: readonly ReadOnlyAgentWorkItem[];
  collected_leads: readonly ReadOnlyAgentCollectedLead[];
  replay_evidence: readonly ReadOnlyAgentReplayEvidence[];
  import_rows: readonly ReadOnlyAgentImportRow[];
  customers: readonly ReadOnlyAgentCustomer[];
  tasks: readonly ReadOnlyAgentTask[];
  capture_events: readonly Readonly<Record<string, string | number | boolean | null>>[];
  prompt_plans: readonly Readonly<Record<string, string | number | boolean | null>>[];
  model_invocations: readonly Readonly<Record<string, string | number | boolean | null>>[];
  eval_summaries: readonly Readonly<Record<string, string | number | boolean | null>>[];
}

export type ReadOnlyAgentSnapshotCollections = Omit<
  ReadOnlyAgentSnapshot,
  'kind' | 'version' | 'snapshot_id' | 'synthetic' | 'persisted'
>;

export interface ReadOnlyAgentRequest {
  kind: 'READ_ONLY_AGENT_REQUEST';
  intent: ReadOnlyAgentIntent;
  snapshot: ReadOnlyAgentSnapshot;
  context?: ReadOnlyAgentContext;
  target_customer_id?: string;
  target_work_item_id?: string;
}

export interface ReadOnlyAgentCollectionsQueryInput {
  intent: ReadOnlyAgentIntent;
  collections: ReadOnlyAgentSnapshotCollections;
  context?: ReadOnlyAgentContext;
  target_customer_id?: string;
  target_work_item_id?: string;
  safety?: ReadOnlyAgentSafety;
}

type ReadOnlyAgentCollectionsRequest = Omit<ReadOnlyAgentRequest, 'kind' | 'snapshot'> & {
  snapshot: ReadOnlyAgentSnapshotCollections;
};

export interface ReadOnlyAgentFinding {
  kind: 'READ_ONLY_AGENT_FINDING';
  intent: ReadOnlyAgentIntent;
  severity: 'info' | 'warning';
  title: string;
  detail: string;
  evidence_refs: readonly ReadOnlyAgentEvidenceRef[];
  uncertainty?: string;
  represents_executed_action: false;
}

export interface ReadOnlyAgentSafety {
  writes_database: false;
  no_side_effects: true;
  no_provider_calls: true;
  no_network: true;
  requires_human_review_for_actions: true;
  represents_true_agent: false;
  represents_executed_action: false;
  forbidden_answer_phrases: readonly string[];
}

export interface ReadOnlyAgentPlan {
  kind: 'READ_ONLY_AGENT_PLAN';
  version: typeof READ_ONLY_AGENT_VERSION;
  executable: false;
  persisted: false;
  reason: 'read_only_agent_readiness_only';
  request: ReadOnlyAgentRequest;
  allowed_operations: readonly ['read_snapshot', 'emit_findings'];
  forbidden_operations: readonly string[];
  safety: ReadOnlyAgentSafety;
}

export interface ReadOnlyAgentAnswer {
  kind: 'READ_ONLY_AGENT_ANSWER';
  version: typeof READ_ONLY_AGENT_VERSION;
  intent: ReadOnlyAgentIntent;
  read_only_summary: string;
  findings: readonly ReadOnlyAgentFinding[];
  safety: ReadOnlyAgentSafety;
  represents_executed_action: false;
}

export interface ReadOnlyAgentTrace {
  kind: 'READ_ONLY_AGENT_TRACE';
  plan: ReadOnlyAgentPlan;
  answer: ReadOnlyAgentAnswer;
  persisted: false;
}

export function buildReadOnlyAgentPlan(request: ReadOnlyAgentRequest): ReadOnlyAgentPlan {
  return {
    kind: 'READ_ONLY_AGENT_PLAN',
    version: READ_ONLY_AGENT_VERSION,
    executable: false,
    persisted: false,
    reason: 'read_only_agent_readiness_only',
    request,
    allowed_operations: ['read_snapshot', 'emit_findings'],
    forbidden_operations: [
      'write_db',
      'sync',
      'update_status',
      'create_customer',
      'call_provider',
      'send_message',
    ],
    safety: buildReadOnlyAgentSafety(),
  };
}

export function answerReadOnlyAgentQuery(plan: ReadOnlyAgentPlan): ReadOnlyAgentAnswer {
  const findings = findingsFor(plan.request);

  return {
    kind: 'READ_ONLY_AGENT_ANSWER',
    version: READ_ONLY_AGENT_VERSION,
    intent: plan.request.intent,
    read_only_summary: summarize(plan.request.intent, findings),
    findings,
    safety: plan.safety,
    represents_executed_action: false,
  };
}

export function answerReadOnlyAgentQueryForCollections(
  input: ReadOnlyAgentCollectionsQueryInput,
): ReadOnlyAgentAnswer {
  const request: ReadOnlyAgentCollectionsRequest = {
    intent: input.intent,
    snapshot: input.collections,
    context: input.context,
    target_customer_id: input.target_customer_id,
    target_work_item_id: input.target_work_item_id,
  };
  const findings = findingsFor(request);

  return {
    kind: 'READ_ONLY_AGENT_ANSWER',
    version: READ_ONLY_AGENT_VERSION,
    intent: input.intent,
    read_only_summary: summarize(input.intent, findings),
    findings,
    safety: input.safety ?? buildReadOnlyAgentSafety(),
    represents_executed_action: false,
  };
}

export function buildReadOnlyAgentTrace(plan: ReadOnlyAgentPlan): ReadOnlyAgentTrace {
  return {
    kind: 'READ_ONLY_AGENT_TRACE',
    plan,
    answer: answerReadOnlyAgentQuery(plan),
    persisted: false,
  };
}

function buildReadOnlyAgentSafety(): ReadOnlyAgentSafety {
  return {
    writes_database: false,
    no_side_effects: true,
    no_provider_calls: true,
    no_network: true,
    requires_human_review_for_actions: true,
    represents_true_agent: false,
    represents_executed_action: false,
    forbidden_answer_phrases: [
      ['已', '发送'].join(''),
      ['已', '执行'].join(''),
      ['已更新', '客户'].join(''),
      ['已创建', '客户'].join(''),
      ['已', '同步'].join(''),
      ['已写入', ' CRM'].join(''),
    ],
  };
}

function findingsFor(request: ReadOnlyAgentCollectionsRequest): ReadOnlyAgentFinding[] {
  if (request.intent === 'today_priorities') return todayPriorities(request);
  if (request.intent === 'stuck_work_items') return stuckWorkItems(request);
  if (request.intent === 'sync_failures') return syncFailures(request);
  if (request.intent === 'high_intent_leads') return highIntentLeads(request);
  if (request.intent === 'evidence_for_customer') return evidenceForCustomer(request);
  return nextBestReadOnlySummary(request);
}

function todayPriorities(request: ReadOnlyAgentCollectionsRequest): ReadOnlyAgentFinding[] {
  const workItem = request.snapshot.work_items.find(item => ['TODO', 'SEARCHING'].includes(item.status));
  const task = request.snapshot.tasks.find(item => item.status === 'TODO');

  return compact([
    workItem && finding(request.intent, 'warning', 'Open work item needs review', workItem.company_name, [
      ref('lead_work_item', workItem.id, workItem.company_name),
    ]),
    task && finding(request.intent, 'warning', 'Open task needs review', task.title, [
      ref('task', task.id, task.title),
    ]),
  ]);
}

function stuckWorkItems(request: ReadOnlyAgentCollectionsRequest): ReadOnlyAgentFinding[] {
  const stale = request.snapshot.work_items.filter(item => (
    ['TODO', 'SEARCHING', 'STAGED'].includes(item.status) && item.updated_at < '2026-07-01T00:00:00.000Z'
  ));

  return stale.map(item => finding(request.intent, 'warning', 'Stale work item in snapshot', item.company_name, [
    ref('lead_work_item', item.id, item.company_name),
  ]));
}

function syncFailures(request: ReadOnlyAgentCollectionsRequest): ReadOnlyAgentFinding[] {
  return request.snapshot.replay_evidence
    .filter(item => item.status === 'FAILED')
    .map(item => finding(request.intent, 'warning', 'Failed replay evidence in snapshot', item.message, [
      ref('lead_sync_log', item.id, item.message),
      ...optionalRef('collected_lead', item.collected_lead_id, item.collected_lead_id ?? ''),
    ]));
}

function highIntentLeads(request: ReadOnlyAgentCollectionsRequest): ReadOnlyAgentFinding[] {
  const customer = request.snapshot.customers.find(item => item.intent_level === 'HIGH' || item.customer_grade === 'A');
  const collected = request.snapshot.collected_leads.find(item => item.intent_level === 'HIGH' || item.lead_grade === 'A');
  const row = request.snapshot.import_rows.find(item => item.intent_level === 'HIGH' || item.lead_grade === 'A');

  return compact([
    customer && finding(request.intent, 'warning', 'High intent customer signal', customer.name, [
      ref('customer', customer.id, customer.name),
    ]),
    collected && finding(request.intent, 'warning', 'High intent collected lead signal', collected.company_name, [
      ref('collected_lead', collected.id, collected.company_name),
    ]),
    row && finding(request.intent, 'warning', 'High intent import row signal', row.company_name, [
      ref('import_row', row.id, row.company_name),
    ]),
  ]);
}

function evidenceForCustomer(request: ReadOnlyAgentCollectionsRequest): ReadOnlyAgentFinding[] {
  const refs: ReadOnlyAgentEvidenceRef[] = [];
  const customerId = request.target_customer_id;
  const workItemId = request.target_work_item_id;

  for (const customer of request.snapshot.customers) {
    if (customer.id === customerId) refs.push(ref('customer', customer.id, customer.name));
  }
  for (const item of request.snapshot.work_items) {
    if (item.id === workItemId || item.customer_id === customerId) refs.push(ref('lead_work_item', item.id, item.company_name));
  }
  for (const event of request.snapshot.replay_evidence) {
    if (event.customer_id === customerId || event.work_item_id === workItemId) refs.push(ref('lead_sync_log', event.id, event.message));
  }
  for (const event of request.snapshot.capture_events) {
    if (event.customer_id === customerId || event.work_item_id === workItemId) {
      refs.push(ref('capture_event', String(event.id), String(event.summary ?? event.id)));
    }
  }

  if (refs.length === 0) {
    return [uncertain(request.intent, 'No matching snapshot evidence for the requested target')];
  }

  return [finding(request.intent, 'info', 'Snapshot evidence found for requested target', 'Review linked snapshot records', refs)];
}

function nextBestReadOnlySummary(request: ReadOnlyAgentCollectionsRequest): ReadOnlyAgentFinding[] {
  const source = [
    ...highIntentLeads({ ...request, intent: 'high_intent_leads' }),
    ...stuckWorkItems({ ...request, intent: 'stuck_work_items' }),
    ...syncFailures({ ...request, intent: 'sync_failures' }),
  ];
  const top = source.slice(0, 3).map(item => ({
    ...item,
    intent: request.intent,
    title: `Read-only summary: ${item.title}`,
  }));

  return top.length > 0 ? top : [uncertain(request.intent, 'No snapshot signals available for summary')];
}

function summarize(intent: ReadOnlyAgentIntent, findings: readonly ReadOnlyAgentFinding[]): string {
  if (findings.length === 0) {
    return `Read-only ${intent}: no snapshot findings; manual review is still required.`;
  }
  return `Read-only ${intent}: ${findings.length} snapshot finding(s); review evidence before any action.`;
}

function finding(
  intent: ReadOnlyAgentIntent,
  severity: ReadOnlyAgentFinding['severity'],
  title: string,
  detail: string,
  evidenceRefs: readonly ReadOnlyAgentEvidenceRef[],
): ReadOnlyAgentFinding {
  return {
    kind: 'READ_ONLY_AGENT_FINDING',
    intent,
    severity,
    title,
    detail,
    evidence_refs: evidenceRefs,
    represents_executed_action: false,
  };
}

function uncertain(intent: ReadOnlyAgentIntent, uncertainty: string): ReadOnlyAgentFinding {
  return {
    kind: 'READ_ONLY_AGENT_FINDING',
    intent,
    severity: 'info',
    title: 'Insufficient snapshot evidence',
    detail: uncertainty,
    evidence_refs: [],
    uncertainty,
    represents_executed_action: false,
  };
}

function ref(type: ReadOnlyAgentEvidenceType, id: string, label: string): ReadOnlyAgentEvidenceRef {
  return {
    type,
    id,
    label,
    synthetic: true,
    persisted: false,
    represents_real_model_output: false,
  };
}

function optionalRef(type: ReadOnlyAgentEvidenceType, id: string | null | undefined, label: string): ReadOnlyAgentEvidenceRef[] {
  return id ? [ref(type, id, label)] : [];
}

function compact<T>(values: readonly (T | false | null | undefined)[]): T[] {
  return values.filter(Boolean) as T[];
}
