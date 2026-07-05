import type { LoadedReadOnlyAgentSnapshot, LoadedSnapshotEvidenceRef } from '../readOnlySnapshotLoaderReadiness';

export function buildAdapterTestLoadedSnapshotV1(): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: 'v1',
    snapshot_id: 'LOADER_TEST_SNAPSHOT_ADAPTER_A',
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: '2026-07-05T09:00:00.000Z',
    context: {
      active_profile_id: 'ADAPTER_TEST_PROFILE',
      now: '2026-07-05T09:00:00.000Z',
    },
    work_items: [
      {
        id: 'LOADER_TEST_WORK_ITEM_A',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        company_name: 'Loader Test Company A',
        status: 'SEARCHING',
        priority: 90,
        updated_at: '2026-07-05T08:30:00.000Z',
        lookup_goal: 'FIND_CONTACT',
        evidence_ref: evidenceRef('lead_work_item', 'LOADER_TEST_WORK_ITEM_A', 'Loader Test Company A'),
      },
      {
        id: 'LOADER_TEST_WORK_ITEM_ORPHAN',
        customer_id: null,
        company_name: 'Loader Test Company Orphan',
        status: 'TODO',
        priority: 10,
        updated_at: '2026-07-04T08:30:00.000Z',
        lookup_goal: null,
        evidence_ref: evidenceRef('lead_work_item', 'LOADER_TEST_WORK_ITEM_ORPHAN', 'Loader Test Company Orphan'),
      },
    ],
    collected_leads: [
      {
        id: 'LOADER_TEST_COLLECTED_A',
        work_item_id: 'LOADER_TEST_WORK_ITEM_A',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        company_name: 'Loader Test Company A',
        sync_status: 'PENDING',
        evidence_ref: evidenceRef('collected_lead', 'LOADER_TEST_COLLECTED_A', 'Loader Test Company A'),
      },
      {
        id: 'LOADER_TEST_COLLECTED_DETACHED',
        work_item_id: null,
        customer_id: null,
        company_name: 'Loader Test Detached Lead',
        sync_status: 'SKIPPED',
        evidence_ref: evidenceRef('collected_lead', 'LOADER_TEST_COLLECTED_DETACHED', 'Loader Test Detached Lead'),
      },
    ],
    replay_evidence: [
      {
        id: 'LOADER_TEST_SYNC_LOG_A',
        log_id: 'LOADER_TEST_SYNC_LOG_A',
        collected_lead_id: 'LOADER_TEST_COLLECTED_A',
        action: 'CREATE_CUSTOMER',
        status: 'OK',
        message: 'Adapter replay summary A',
        created_at: '2026-07-05T08:45:00.000Z',
        work_item_id: 'LOADER_TEST_WORK_ITEM_A',
        work_item_status: 'COLLECTED',
        import_row_id: 'LOADER_TEST_IMPORT_ROW_A',
        collected_sync_status: 'PENDING',
        evidence_ref: evidenceRef('lead_sync_log', 'LOADER_TEST_SYNC_LOG_A', 'Adapter replay summary A'),
      },
      {
        id: 'LOADER_TEST_SYNC_LOG_ORPHAN',
        log_id: 'LOADER_TEST_SYNC_LOG_ORPHAN',
        collected_lead_id: null,
        action: 'SKIP_DUPLICATE',
        status: 'SKIPPED',
        message: 'Adapter replay summary orphan',
        created_at: '2026-07-04T08:45:00.000Z',
        work_item_id: null,
        work_item_status: null,
        import_row_id: 'LOADER_TEST_IMPORT_ROW_B',
        collected_sync_status: 'SKIPPED',
        evidence_ref: evidenceRef('lead_sync_log', 'LOADER_TEST_SYNC_LOG_ORPHAN', 'Adapter replay summary orphan'),
      },
    ],
    import_rows: [
      {
        id: 'LOADER_TEST_IMPORT_ROW_A',
        company_name: 'Loader Test Company A',
        decision: 'CRM_WITH_LOOKUP',
        decision_status: 'DONE',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        evidence_ref: evidenceRef('import_row', 'LOADER_TEST_IMPORT_ROW_A', 'Loader Test Company A'),
      },
      {
        id: 'LOADER_TEST_IMPORT_ROW_B',
        company_name: 'Loader Test Company B',
        decision: 'NOOP',
        decision_status: 'PENDING',
        customer_id: null,
        evidence_ref: evidenceRef('import_row', 'LOADER_TEST_IMPORT_ROW_B', 'Loader Test Company B'),
      },
    ],
    capture_events: [
      {
        id: 'LOADER_TEST_CAPTURE_A',
        work_item_id: 'LOADER_TEST_WORK_ITEM_A',
        action: 'CAPTURE_SAVED',
        created_at: '2026-07-05T08:40:00.000Z',
        summary: 'Adapter capture summary A',
        evidence_ref: evidenceRef('capture_event', 'LOADER_TEST_CAPTURE_A', 'Adapter capture summary A'),
      },
      {
        id: 'LOADER_TEST_CAPTURE_ORPHAN',
        work_item_id: null,
        action: 'CAPTURE_SKIPPED',
        created_at: '2026-07-04T08:40:00.000Z',
        summary: 'Adapter capture summary orphan',
        evidence_ref: evidenceRef('capture_event', 'LOADER_TEST_CAPTURE_ORPHAN', 'Adapter capture summary orphan'),
      },
    ],
    customers: [
      {
        id: 'LOADER_TEST_CUSTOMER_A',
        name: 'Loader Test Customer A',
        customer_grade: 'A',
        intent_level: 'HIGH',
        evidence_ref: evidenceRef('customer', 'LOADER_TEST_CUSTOMER_A', 'Loader Test Customer A'),
      },
      {
        id: 'LOADER_TEST_CUSTOMER_B',
        name: 'Loader Test Customer B',
        customer_grade: 'C',
        intent_level: 'LOW',
        evidence_ref: evidenceRef('customer', 'LOADER_TEST_CUSTOMER_B', 'Loader Test Customer B'),
      },
    ],
    tasks: [
      {
        id: 'LOADER_TEST_TASK_A',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        title: 'Adapter test task A',
        due_at: '2026-07-06T00:00:00.000Z',
        status: 'TODO',
        priority: 80,
        evidence_ref: evidenceRef('task', 'LOADER_TEST_TASK_A', 'Adapter test task A'),
      },
      {
        id: 'LOADER_TEST_TASK_B',
        customer_id: null,
        title: 'Adapter test task B',
        due_at: null,
        status: 'DONE',
        priority: 20,
        evidence_ref: evidenceRef('task', 'LOADER_TEST_TASK_B', 'Adapter test task B'),
      },
    ],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
}

export function buildAdapterTestPiiPollutedLoadedSnapshotV1(): LoadedReadOnlyAgentSnapshot {
  const snapshot = structuredClone(buildAdapterTestLoadedSnapshotV1()) as LoadedReadOnlyAgentSnapshot & {
    raw_data_json?: string;
  };
  snapshot.snapshot_id = 'LOADER_TEST_SNAPSHOT_ADAPTER_PII';
  snapshot.raw_data_json = '{"mobile":"13800138000","email":"privacy@example.test","wechat_id":"wxid_adapter_private"}';
  snapshot.capture_events = [
    ...snapshot.capture_events,
    {
      id: 'LOADER_TEST_CAPTURE_PII',
      work_item_id: 'LOADER_TEST_WORK_ITEM_A',
      action: 'CAPTURE_PII',
      created_at: '2026-07-05T08:50:00.000Z',
      summary: 'Adapter polluted capture',
      raw_text: 'privacy@example.test wxid_adapter_private',
      parsed_json: '{"phone_number":"13800138000"}',
      evidence_ref: evidenceRef('capture_event', 'LOADER_TEST_CAPTURE_PII', 'Adapter polluted capture'),
    } as unknown as LoadedReadOnlyAgentSnapshot['capture_events'][number],
  ];
  return snapshot;
}

function evidenceRef(
  type: LoadedSnapshotEvidenceRef['type'],
  id: string,
  label: string,
): LoadedSnapshotEvidenceRef {
  return {
    type,
    id,
    label,
    synthetic: false,
    persisted: true,
  };
}
