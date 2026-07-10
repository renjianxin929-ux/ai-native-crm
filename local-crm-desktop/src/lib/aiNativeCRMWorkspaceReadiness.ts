import type {
  LoadedReadOnlyAgentSnapshot,
  ReadOnlySnapshotLoaderRequest,
  ReadOnlySnapshotLoaderSafety,
} from './readOnlySnapshotLoaderReadiness';

export const AI_NATIVE_CRM_WORKSPACE_VERSION = 'target-phase-v1';

export const AI_NATIVE_CRM_PHASE_1_2_FILE_ALLOWLIST = [
  'src/App.tsx',
  'src/components/aiNative/AINativeCRMWorkspace.tsx',
  'src/lib/aiNativeCRMWorkspaceReadiness.ts',
  'src/__tests__/aiNativeCRMWorkspace.readiness.test.ts',
] as const;

export interface AINativeCRMContextSummary {
  snapshot_id: string;
  captured_at: string;
  freshness: 'fresh' | 'stale';
  source: 'sqlite_read_only';
  source_records_persisted: true;
  snapshot_persisted: false;
  redaction_status: 'pii_allowlist_redacted';
  read_only: true;
  selected_customer_id: string | null;
  customer_count: number;
  open_task_count: number;
  work_item_count: number;
  evidence_count: number;
}

export function buildCustomerCatalogRequest(
  activeProfileId: string,
  now: string,
): ReadOnlySnapshotLoaderRequest {
  return {
    kind: 'READ_ONLY_SNAPSHOT_LOADER_REQUEST',
    active_profile_id: activeProfileId,
    now,
    limits: { customers: 100, tasks: 0, lead_workbench: 0 },
    includes: { customers: true, tasks: false, lead_workbench: false },
  };
}

export function buildSelectedCRMContextRequest(
  activeProfileId: string,
  customerId: string,
  now: string,
): ReadOnlySnapshotLoaderRequest {
  const normalizedCustomerId = customerId.trim();
  if (!normalizedCustomerId) {
    throw new Error('A selected customer id is required for a CRM context snapshot.');
  }

  return {
    kind: 'READ_ONLY_SNAPSHOT_LOADER_REQUEST',
    active_profile_id: activeProfileId,
    now,
    limits: { customers: 1, tasks: 50, lead_workbench: 50 },
    includes: { customers: true, tasks: true, lead_workbench: true },
    filters: { target_customer_id: normalizedCustomerId },
  };
}

export function isStrictReadOnlyWorkspaceSafety(
  safety: ReadOnlySnapshotLoaderSafety,
): boolean {
  return safety.reads_database === true
    && safety.writes_database === false
    && safety.no_side_effects === true
    && safety.no_provider_calls === true
    && safety.no_network === true
    && safety.executable === false
    && safety.persisted === false
    && safety.represents_executed_action === false
    && safety.pii_redacted === true;
}

export function projectCRMContextSummary(
  snapshot: LoadedReadOnlyAgentSnapshot,
  selectedCustomerId: string | null,
  observedAt: string,
): AINativeCRMContextSummary {
  const capturedAt = Date.parse(snapshot.loaded_at);
  const observed = Date.parse(observedAt);
  const ageMs = Number.isFinite(capturedAt) && Number.isFinite(observed)
    ? Math.max(0, observed - capturedAt)
    : Number.POSITIVE_INFINITY;

  return {
    snapshot_id: snapshot.snapshot_id,
    captured_at: snapshot.loaded_at,
    freshness: ageMs <= 5 * 60 * 1000 ? 'fresh' : 'stale',
    source: snapshot.load_source,
    source_records_persisted: true,
    snapshot_persisted: false,
    redaction_status: 'pii_allowlist_redacted',
    read_only: true,
    selected_customer_id: selectedCustomerId,
    customer_count: snapshot.customers.length,
    open_task_count: snapshot.tasks.filter(task => task.status === 'TODO').length,
    work_item_count: snapshot.work_items.length,
    evidence_count: snapshot.customers.length
      + snapshot.tasks.length
      + snapshot.work_items.length
      + snapshot.collected_leads.length
      + snapshot.replay_evidence.length
      + snapshot.import_rows.length
      + snapshot.capture_events.length,
  };
}
