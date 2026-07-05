export const READ_ONLY_SNAPSHOT_LOADER_VERSION = 'v1';

export interface DatabaseLike {
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface ReadOnlySnapshotLoaderRequest {
  kind: 'READ_ONLY_SNAPSHOT_LOADER_REQUEST';
  version?: typeof READ_ONLY_SNAPSHOT_LOADER_VERSION;
  active_profile_id: string;
  now: string;
  limits?: ReadOnlySnapshotLoaderLimits;
  includes?: ReadOnlySnapshotLoaderIncludes;
  filters?: ReadOnlySnapshotLoaderFilters;
}

export interface ReadOnlySnapshotLoaderLimits {
  customers?: number;
  tasks?: number;
  lead_workbench?: number;
}

export interface ReadOnlySnapshotLoaderIncludes {
  customers?: boolean;
  tasks?: boolean;
  lead_workbench?: boolean;
}

export interface ReadOnlySnapshotLoaderFilters {
  target_customer_id?: string;
  target_work_item_id?: string;
}

export interface ReadOnlySnapshotLoaderSafety {
  reads_database: true;
  writes_database: false;
  no_side_effects: true;
  no_provider_calls: true;
  no_network: true;
  executable: false;
  persisted: false;
  represents_true_agent: false;
  represents_executed_action: false;
  pii_redacted: true;
}

export interface ReadOnlySnapshotLoaderPlan {
  kind: 'READ_ONLY_SNAPSHOT_LOADER_PLAN';
  version: typeof READ_ONLY_SNAPSHOT_LOADER_VERSION;
  executable: false;
  persisted: false;
  reason: 'read_only_snapshot_loader_readiness_only';
  request: NormalizedReadOnlySnapshotLoaderRequest;
  allowed_operations: readonly ['select_db', 'map_snapshot'];
  forbidden_operations: readonly string[];
  safety: ReadOnlySnapshotLoaderSafety;
}

export interface NormalizedReadOnlySnapshotLoaderRequest extends ReadOnlySnapshotLoaderRequest {
  version: typeof READ_ONLY_SNAPSHOT_LOADER_VERSION;
  limits: Required<ReadOnlySnapshotLoaderLimits>;
  includes: Required<ReadOnlySnapshotLoaderIncludes>;
  filters: ReadOnlySnapshotLoaderFilters;
}

export interface LoadedSnapshotEvidenceRef {
  type:
    | 'lead_work_item'
    | 'collected_lead'
    | 'lead_sync_log'
    | 'import_row'
    | 'capture_event'
    | 'customer'
    | 'task';
  id: string;
  label: string;
  synthetic: false;
  persisted: true;
}

export interface LoadedReadOnlyAgentWorkItem {
  id: string;
  customer_id: string | null;
  company_name: string;
  status: string;
  priority: number;
  updated_at: string;
  lookup_goal: string | null;
  evidence_ref: LoadedSnapshotEvidenceRef;
}

export interface LoadedReadOnlyAgentCollectedLead {
  id: string;
  work_item_id: string | null;
  customer_id: string | null;
  company_name: string;
  sync_status: 'PENDING' | 'CREATED' | 'FAILED' | 'SKIPPED';
  evidence_ref: LoadedSnapshotEvidenceRef;
}

export interface LoadedReadOnlyAgentReplayEvidence {
  id: string;
  log_id: string;
  collected_lead_id: string | null;
  action: string;
  status: 'OK' | 'FAILED' | 'SKIPPED';
  message: string;
  created_at: string;
  work_item_id: string | null;
  work_item_status: string | null;
  import_row_id: string | null;
  collected_sync_status: 'PENDING' | 'CREATED' | 'FAILED' | 'SKIPPED';
  evidence_ref: LoadedSnapshotEvidenceRef;
}

export interface LoadedReadOnlyAgentImportRow {
  id: string;
  company_name: string;
  decision: string;
  decision_status: string;
  customer_id: string | null;
  evidence_ref: LoadedSnapshotEvidenceRef;
}

export interface LoadedReadOnlyAgentCaptureEvent {
  id: string;
  work_item_id: string | null;
  action: string;
  created_at: string;
  summary: string;
  evidence_ref: LoadedSnapshotEvidenceRef;
}

export interface LoadedReadOnlyAgentCustomer {
  id: string;
  name: string;
  customer_grade: string;
  intent_level: string;
  evidence_ref: LoadedSnapshotEvidenceRef;
}

export interface LoadedReadOnlyAgentTask {
  id: string;
  customer_id: string | null;
  title: string;
  due_at: string | null;
  status: 'TODO' | 'DONE';
  priority: number;
  evidence_ref: LoadedSnapshotEvidenceRef;
}

export interface LoadedReadOnlyAgentSnapshot {
  kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT';
  version: typeof READ_ONLY_SNAPSHOT_LOADER_VERSION;
  snapshot_id: string;
  synthetic: false;
  persisted: true;
  load_source: 'sqlite_read_only';
  loaded_at: string;
  context: {
    active_profile_id: string;
    now: string;
  };
  work_items: readonly LoadedReadOnlyAgentWorkItem[];
  collected_leads: readonly LoadedReadOnlyAgentCollectedLead[];
  replay_evidence: readonly LoadedReadOnlyAgentReplayEvidence[];
  import_rows: readonly LoadedReadOnlyAgentImportRow[];
  capture_events: readonly LoadedReadOnlyAgentCaptureEvent[];
  customers: readonly LoadedReadOnlyAgentCustomer[];
  tasks: readonly LoadedReadOnlyAgentTask[];
  prompt_plans: readonly [];
  model_invocations: readonly [];
  eval_summaries: readonly [];
}

export interface ReadOnlySnapshotLoaderResult {
  kind: 'READ_ONLY_SNAPSHOT_LOADER_RESULT';
  version: typeof READ_ONLY_SNAPSHOT_LOADER_VERSION;
  plan: ReadOnlySnapshotLoaderPlan;
  snapshot: LoadedReadOnlyAgentSnapshot;
  safety: ReadOnlySnapshotLoaderSafety;
  represents_executed_action: false;
}

export interface ReadOnlySnapshotLoaderTrace {
  kind: 'READ_ONLY_SNAPSHOT_LOADER_TRACE';
  plan: ReadOnlySnapshotLoaderPlan;
  result: ReadOnlySnapshotLoaderResult;
  persisted: false;
}

interface CustomerRow {
  id?: unknown;
  name?: unknown;
  customer_grade?: unknown;
  intent_level?: unknown;
}

interface TaskRow {
  id?: unknown;
  customer_id?: unknown;
  title?: unknown;
  due_at?: unknown;
  status?: unknown;
  priority?: unknown;
}

interface WorkItemRow {
  id?: unknown;
  customer_id?: unknown;
  company_name?: unknown;
  status?: unknown;
  priority?: unknown;
  updated_at?: unknown;
  lookup_goal?: unknown;
}

interface CollectedLeadRow {
  id?: unknown;
  work_item_id?: unknown;
  customer_id?: unknown;
  company_name?: unknown;
  sync_status?: unknown;
}

interface ReplayEvidenceRow {
  log_id?: unknown;
  collected_lead_id?: unknown;
  action?: unknown;
  status?: unknown;
  message?: unknown;
  created_at?: unknown;
  work_item_id?: unknown;
  work_item_status?: unknown;
  import_row_id?: unknown;
  collected_sync_status?: unknown;
}

interface ImportRow {
  id?: unknown;
  company_name?: unknown;
  decision?: unknown;
  decision_status?: unknown;
  customer_id?: unknown;
}

interface CaptureEventRow {
  id?: unknown;
  work_item_id?: unknown;
  action?: unknown;
  created_at?: unknown;
  summary?: unknown;
}

const DEFAULT_LIMITS: Required<ReadOnlySnapshotLoaderLimits> = {
  customers: 50,
  tasks: 50,
  lead_workbench: 50,
};

export function buildReadOnlySnapshotLoaderPlan(
  request: ReadOnlySnapshotLoaderRequest,
): ReadOnlySnapshotLoaderPlan {
  return {
    kind: 'READ_ONLY_SNAPSHOT_LOADER_PLAN',
    version: READ_ONLY_SNAPSHOT_LOADER_VERSION,
    executable: false,
    persisted: false,
    reason: 'read_only_snapshot_loader_readiness_only',
    request: normalizeRequest(request),
    allowed_operations: ['select_db', 'map_snapshot'],
    forbidden_operations: [
      op('write', '_db'),
      'insert',
      'update',
      'delete',
      op('create', '_customer'),
      op('update', '_customer'),
      'sync',
      op('update', '_status'),
      op('call', '_provider'),
      op('execute', '_action'),
      op('generate', '_proposal'),
      op('emit', '_envelope'),
    ],
    safety: buildReadOnlySnapshotLoaderSafety(),
  };
}

export async function loadReadOnlySnapshotFromDb(
  db: DatabaseLike,
  plan: ReadOnlySnapshotLoaderPlan,
): Promise<ReadOnlySnapshotLoaderResult> {
  const request = plan.request;
  const [customers, tasks, workItems, collectedLeads, replayEvidence, importRows, captureEvents] = await Promise.all([
    request.includes.customers ? selectCustomers(db, request) : Promise.resolve([]),
    request.includes.tasks ? selectTasks(db, request) : Promise.resolve([]),
    request.includes.lead_workbench ? selectWorkItems(db, request) : Promise.resolve([]),
    request.includes.lead_workbench ? selectCollectedLeads(db, request) : Promise.resolve([]),
    request.includes.lead_workbench ? selectReplayEvidence(db, request) : Promise.resolve([]),
    request.includes.lead_workbench ? selectImportRows(db, request) : Promise.resolve([]),
    request.includes.lead_workbench ? selectCaptureEvents(db, request) : Promise.resolve([]),
  ]);

  return {
    kind: 'READ_ONLY_SNAPSHOT_LOADER_RESULT',
    version: READ_ONLY_SNAPSHOT_LOADER_VERSION,
    plan,
    snapshot: {
      kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
      version: READ_ONLY_SNAPSHOT_LOADER_VERSION,
      snapshot_id: snapshotIdFor(request),
      synthetic: false,
      persisted: true,
      load_source: 'sqlite_read_only',
      loaded_at: request.now,
      context: {
        active_profile_id: request.active_profile_id,
        now: request.now,
      },
      work_items: workItems,
      collected_leads: collectedLeads,
      replay_evidence: replayEvidence,
      import_rows: importRows,
      capture_events: captureEvents,
      customers,
      tasks,
      prompt_plans: [],
      model_invocations: [],
      eval_summaries: [],
    },
    safety: plan.safety,
    represents_executed_action: false,
  };
}

export async function buildReadOnlySnapshotLoaderTrace(
  db: DatabaseLike,
  plan: ReadOnlySnapshotLoaderPlan,
): Promise<ReadOnlySnapshotLoaderTrace> {
  return {
    kind: 'READ_ONLY_SNAPSHOT_LOADER_TRACE',
    plan,
    result: await loadReadOnlySnapshotFromDb(db, plan),
    persisted: false,
  };
}

export function mapCollectedLeadSyncStatusForSnapshot(
  status: unknown,
): LoadedReadOnlyAgentCollectedLead['sync_status'] {
  if (status === 'SYNCED') return 'CREATED';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'IGNORED') return 'SKIPPED';
  return 'PENDING';
}

export function mapLeadSyncLogStatusForSnapshot(
  status: unknown,
): LoadedReadOnlyAgentReplayEvidence['status'] {
  if (status === 'FAILED') return 'FAILED';
  if (status === 'SKIPPED') return 'SKIPPED';
  return 'OK';
}

export function mapTaskStatusForSnapshot(status: unknown): LoadedReadOnlyAgentTask['status'] {
  return status === 'OPEN' ? 'TODO' : 'DONE';
}

async function selectCustomers(
  db: DatabaseLike,
  request: NormalizedReadOnlySnapshotLoaderRequest,
): Promise<LoadedReadOnlyAgentCustomer[]> {
  const query = limitedQuery(
    'SELECT id, name, customer_grade, intent_level FROM customers',
    request.filters.target_customer_id ? ['id = ?'] : [],
    'updated_at DESC, rowid DESC',
  );
  const params = compactParams([request.filters.target_customer_id, request.limits.customers]);
  const rows = await db.select<CustomerRow>(query, params);
  return rows.slice(0, request.limits.customers).map(row => {
    const id = toText(row.id, 'customer');
    const label = toText(row.name, id);
    return {
      id,
      name: label,
      customer_grade: toText(row.customer_grade, 'UNKNOWN'),
      intent_level: toText(row.intent_level, 'UNKNOWN'),
      evidence_ref: evidenceRef('customer', id, label),
    };
  });
}

async function selectTasks(
  db: DatabaseLike,
  request: NormalizedReadOnlySnapshotLoaderRequest,
): Promise<LoadedReadOnlyAgentTask[]> {
  const query = limitedQuery(
    'SELECT id, customer_id, title, due_at, status, priority FROM tasks',
    request.filters.target_customer_id ? ['customer_id = ?'] : [],
    'due_at ASC, rowid DESC',
  );
  const params = compactParams([request.filters.target_customer_id, request.limits.tasks]);
  const rows = await db.select<TaskRow>(query, params);
  return rows.slice(0, request.limits.tasks).map(row => {
    const id = toText(row.id, 'task');
    const title = toText(row.title, id);
    return {
      id,
      customer_id: toOptionalText(row.customer_id),
      title,
      due_at: toOptionalText(row.due_at),
      status: mapTaskStatusForSnapshot(row.status),
      priority: toNumber(row.priority),
      evidence_ref: evidenceRef('task', id, title),
    };
  });
}

async function selectWorkItems(
  db: DatabaseLike,
  request: NormalizedReadOnlySnapshotLoaderRequest,
): Promise<LoadedReadOnlyAgentWorkItem[]> {
  const query = limitedQuery(
    'SELECT id, customer_id, company_name, status, priority, updated_at, lookup_goal FROM lead_work_items',
    [
      request.filters.target_work_item_id ? 'id = ?' : '',
      request.filters.target_customer_id ? 'customer_id = ?' : '',
    ],
    'updated_at DESC, rowid DESC',
  );
  const params = compactParams([
    request.filters.target_work_item_id,
    request.filters.target_customer_id,
    request.limits.lead_workbench,
  ]);
  const rows = await db.select<WorkItemRow>(query, params);
  return rows.slice(0, request.limits.lead_workbench).map(row => {
    const id = toText(row.id, 'work_item');
    const label = toText(row.company_name, id);
    return {
      id,
      customer_id: toOptionalText(row.customer_id),
      company_name: label,
      status: toText(row.status, 'UNKNOWN'),
      priority: toNumber(row.priority),
      updated_at: toText(row.updated_at, ''),
      lookup_goal: toOptionalText(row.lookup_goal),
      evidence_ref: evidenceRef('lead_work_item', id, label),
    };
  });
}

async function selectCollectedLeads(
  db: DatabaseLike,
  request: NormalizedReadOnlySnapshotLoaderRequest,
): Promise<LoadedReadOnlyAgentCollectedLead[]> {
  const query = limitedQuery(
    'SELECT id, work_item_id, customer_id, company_name, sync_status FROM collected_leads',
    [
      request.filters.target_work_item_id ? 'work_item_id = ?' : '',
      request.filters.target_customer_id ? 'customer_id = ?' : '',
    ],
    'updated_at DESC, rowid DESC',
  );
  const params = compactParams([
    request.filters.target_work_item_id,
    request.filters.target_customer_id,
    request.limits.lead_workbench,
  ]);
  const rows = await db.select<CollectedLeadRow>(query, params);
  return rows.slice(0, request.limits.lead_workbench).map(row => {
    const id = toText(row.id, 'collected_lead');
    const label = toText(row.company_name, id);
    return {
      id,
      work_item_id: toOptionalText(row.work_item_id),
      customer_id: toOptionalText(row.customer_id),
      company_name: label,
      sync_status: mapCollectedLeadSyncStatusForSnapshot(row.sync_status),
      evidence_ref: evidenceRef('collected_lead', id, label),
    };
  });
}

async function selectReplayEvidence(
  db: DatabaseLike,
  request: NormalizedReadOnlySnapshotLoaderRequest,
): Promise<LoadedReadOnlyAgentReplayEvidence[]> {
  const where = [
    request.filters.target_work_item_id ? 'collected.work_item_id = ?' : '',
    request.filters.target_customer_id ? '(collected.customer_id = ? OR log.target_customer_id = ?)' : '',
  ];
  const query = limitedQuery(
    `SELECT
      log.id AS log_id,
      log.collected_lead_id,
      log.action,
      log.status,
      log.message,
      log.created_at,
      collected.work_item_id,
      work.status AS work_item_status,
      collected.import_row_id,
      collected.sync_status AS collected_sync_status
     FROM lead_sync_logs log
     LEFT JOIN collected_leads collected ON collected.id = log.collected_lead_id
     LEFT JOIN lead_work_items work ON work.id = collected.work_item_id`,
    where,
    'log.created_at DESC, log.rowid DESC',
  );
  const params = compactParams([
    request.filters.target_work_item_id,
    request.filters.target_customer_id,
    request.filters.target_customer_id,
    request.limits.lead_workbench,
  ]);
  const rows = await db.select<ReplayEvidenceRow>(query, params);
  return rows.slice(0, request.limits.lead_workbench).map(row => {
    const id = toText(row.log_id, 'lead_sync_log');
    const message = toText(row.message, id);
    return {
      id,
      log_id: id,
      collected_lead_id: toOptionalText(row.collected_lead_id),
      action: toText(row.action, 'UNKNOWN'),
      status: mapLeadSyncLogStatusForSnapshot(row.status),
      message,
      created_at: toText(row.created_at, ''),
      work_item_id: toOptionalText(row.work_item_id),
      work_item_status: toOptionalText(row.work_item_status),
      import_row_id: toOptionalText(row.import_row_id),
      collected_sync_status: mapCollectedLeadSyncStatusForSnapshot(row.collected_sync_status),
      evidence_ref: evidenceRef('lead_sync_log', id, message),
    };
  });
}

async function selectImportRows(
  db: DatabaseLike,
  request: NormalizedReadOnlySnapshotLoaderRequest,
): Promise<LoadedReadOnlyAgentImportRow[]> {
  const query = limitedQuery(
    'SELECT id, company_name, decision, decision_status, created_customer_id AS customer_id FROM lead_import_rows',
    [
      request.filters.target_customer_id ? 'created_customer_id = ?' : '',
      request.filters.target_work_item_id ? 'created_work_item_id = ?' : '',
    ],
    'row_index ASC, rowid DESC',
  );
  const params = compactParams([
    request.filters.target_customer_id,
    request.filters.target_work_item_id,
    request.limits.lead_workbench,
  ]);
  const rows = await db.select<ImportRow>(query, params);
  return rows.slice(0, request.limits.lead_workbench).map(row => {
    const id = toText(row.id, 'import_row');
    const label = toText(row.company_name, id);
    return {
      id,
      company_name: label,
      decision: toText(row.decision, 'UNKNOWN'),
      decision_status: toText(row.decision_status, 'UNKNOWN'),
      customer_id: toOptionalText(row.customer_id),
      evidence_ref: evidenceRef('import_row', id, label),
    };
  });
}

async function selectCaptureEvents(
  db: DatabaseLike,
  request: NormalizedReadOnlySnapshotLoaderRequest,
): Promise<LoadedReadOnlyAgentCaptureEvent[]> {
  const query = limitedQuery(
    'SELECT id, work_item_id, action, created_at, action AS summary FROM lead_capture_events',
    request.filters.target_work_item_id ? ['work_item_id = ?'] : [],
    'created_at DESC, rowid DESC',
  );
  const params = compactParams([request.filters.target_work_item_id, request.limits.lead_workbench]);
  const rows = await db.select<CaptureEventRow>(query, params);
  return rows.slice(0, request.limits.lead_workbench).map(row => {
    const id = toText(row.id, 'capture_event');
    const action = toText(row.action, 'UNKNOWN');
    return {
      id,
      work_item_id: toOptionalText(row.work_item_id),
      action,
      created_at: toText(row.created_at, ''),
      summary: toText(row.summary, action),
      evidence_ref: evidenceRef('capture_event', id, action),
    };
  });
}

function buildReadOnlySnapshotLoaderSafety(): ReadOnlySnapshotLoaderSafety {
  return {
    reads_database: true,
    writes_database: false,
    no_side_effects: true,
    no_provider_calls: true,
    no_network: true,
    executable: false,
    persisted: false,
    represents_true_agent: false,
    represents_executed_action: false,
    pii_redacted: true,
  };
}

function normalizeRequest(request: ReadOnlySnapshotLoaderRequest): NormalizedReadOnlySnapshotLoaderRequest {
  return {
    ...request,
    version: READ_ONLY_SNAPSHOT_LOADER_VERSION,
    limits: {
      customers: normalizeLimit(request.limits?.customers, DEFAULT_LIMITS.customers),
      tasks: normalizeLimit(request.limits?.tasks, DEFAULT_LIMITS.tasks),
      lead_workbench: normalizeLimit(request.limits?.lead_workbench, DEFAULT_LIMITS.lead_workbench),
    },
    includes: {
      customers: request.includes?.customers ?? true,
      tasks: request.includes?.tasks ?? true,
      lead_workbench: request.includes?.lead_workbench ?? true,
    },
    filters: {
      target_customer_id: normalizeFilter(request.filters?.target_customer_id),
      target_work_item_id: normalizeFilter(request.filters?.target_work_item_id),
    },
  };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function limitedQuery(base: string, where: readonly string[], orderBy: string): string {
  const clauses = where.filter(Boolean);
  const suffix = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return `${base}${suffix} ORDER BY ${orderBy} LIMIT ?`;
}

function compactParams(values: readonly unknown[]): unknown[] {
  return values.filter(value => value !== undefined);
}

function evidenceRef(
  type: LoadedSnapshotEvidenceRef['type'],
  id: string,
  label: string,
): LoadedSnapshotEvidenceRef {
  return {
    type,
    id,
    label: label.trim() || id,
    synthetic: false,
    persisted: true,
  };
}

function snapshotIdFor(request: NormalizedReadOnlySnapshotLoaderRequest): string {
  return `LOADED_SNAPSHOT_${sanitizeIdPart(request.active_profile_id)}_${sanitizeIdPart(request.now)}`;
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'v1';
}

function toText(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function toOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function toNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function op(...parts: string[]): string {
  return parts.join('');
}
