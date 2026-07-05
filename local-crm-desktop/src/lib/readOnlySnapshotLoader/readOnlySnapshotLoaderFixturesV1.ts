import { vi } from 'vitest';

import type { DatabaseLike, ReadOnlySnapshotLoaderRequest } from '../readOnlySnapshotLoaderReadiness';

export const LOADER_TEST_PII_VALUES = [
  '13800138000',
  '020-88889999',
  'privacy@example.test',
  'wxid_loader_private',
  'Loader Private Address',
  'Loader private note',
  'Loader raw text secret',
  '{"private":"raw_data"}',
  '{"private":"parsed"}',
];

export function buildReadOnlySnapshotLoaderRequestFixtureV1(
  overrides: Partial<ReadOnlySnapshotLoaderRequest> = {},
): ReadOnlySnapshotLoaderRequest {
  return {
    kind: 'READ_ONLY_SNAPSHOT_LOADER_REQUEST',
    version: 'v1',
    active_profile_id: 'LOADER_TEST_PROFILE',
    now: '2026-07-05T09:00:00.000Z',
    limits: {
      customers: 20,
      tasks: 20,
      lead_workbench: 20,
      ...overrides.limits,
    },
    includes: {
      customers: true,
      tasks: true,
      lead_workbench: true,
      ...overrides.includes,
    },
    filters: {
      ...overrides.filters,
    },
  };
}

export function buildReadOnlySnapshotLoaderDbFixtureV1(
  options: { includeNullSources?: boolean; ignoreSelectLimit?: boolean } = {},
): DatabaseLike & { selectMock: ReturnType<typeof vi.fn> } {
  const rows = buildRows(options);
  const select = vi.fn(async <T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const normalized = sql.toLowerCase();
    const limit = Number(params[params.length - 1] ?? 50);

    if (normalized.includes(' from customers')) {
      return applyLimit(filterById(rows.customers, params), limit, options) as T[];
    }
    if (normalized.includes(' from tasks')) {
      return applyLimit(filterByCustomer(rows.tasks, params), limit, options) as T[];
    }
    if (normalized.includes(' from lead_work_items')) {
      return applyLimit(filterByCustomer(filterByWorkItem(rows.work_items, params), params), limit, options) as T[];
    }
    if (normalized.includes(' from collected_leads')) {
      return applyLimit(filterByCustomer(filterByWorkItem(rows.collected_leads, params), params), limit, options) as T[];
    }
    if (normalized.includes(' from lead_sync_logs')) {
      return applyLimit(filterByCustomer(filterByWorkItem(rows.replay_evidence, params), params), limit, options) as T[];
    }
    if (normalized.includes(' from lead_import_rows')) {
      return applyLimit(filterByImportTargets(rows.import_rows, params), limit, options) as T[];
    }
    if (normalized.includes(' from lead_capture_events')) {
      return applyLimit(filterByWorkItem(rows.capture_events, params), limit, options) as T[];
    }
    return [];
  });

  return {
    select: select as DatabaseLike['select'],
    selectMock: select,
  };
}

function buildRows(options: { includeNullSources?: boolean }) {
  const [phone, tel, email, wechat, address, notes, rawText, rawDataJson, parsedJson] = LOADER_TEST_PII_VALUES;
  const maybeNullRows = options.includeNullSources
    ? {
        work_items: [{
          id: 'LOADER_TEST_WORK_ITEM_NULL',
          customer_id: null,
          company_name: null,
          status: 'TODO',
          priority: 1,
          updated_at: '2026-07-05T08:00:00.000Z',
          lookup_goal: null,
        }],
        collected_leads: [{
          id: 'LOADER_TEST_COLLECTED_NULL',
          work_item_id: null,
          customer_id: null,
          company_name: null,
          sync_status: 'UNSYNCED',
          mobile: phone,
          tel,
          email,
          raw_text: rawText,
          note: notes,
        }],
      }
    : { work_items: [], collected_leads: [] };

  return {
    customers: [
      {
        id: 'LOADER_TEST_CUSTOMER_A',
        name: 'Loader Customer A',
        customer_grade: 'A',
        intent_level: 'HIGH',
        phone_number: phone,
        email,
        wechat_id: wechat,
        address,
        notes,
      },
      {
        id: 'LOADER_TEST_CUSTOMER_B',
        name: 'Loader Customer B',
        customer_grade: 'C',
        intent_level: 'LOW',
        phone_number: '13900139000',
      },
    ],
    tasks: [
      {
        id: 'LOADER_TEST_TASK_A',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        title: 'Review loader task',
        due_at: '2026-07-06T00:00:00.000Z',
        status: 'OPEN',
        priority: 80,
      },
      {
        id: 'LOADER_TEST_TASK_B',
        customer_id: 'LOADER_TEST_CUSTOMER_B',
        title: 'Other loader task',
        due_at: '2026-07-07T00:00:00.000Z',
        status: 'DONE',
        priority: 10,
      },
    ],
    work_items: [
      {
        id: 'LOADER_TEST_WORK_ITEM_A',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        company_name: 'Loader Company A',
        status: 'SEARCHING',
        priority: 90,
        updated_at: '2026-07-05T08:30:00.000Z',
        lookup_goal: 'FIND_CONTACT',
        note: notes,
      },
      {
        id: 'LOADER_TEST_WORK_ITEM_B',
        customer_id: 'LOADER_TEST_CUSTOMER_B',
        company_name: 'Loader Company B',
        status: 'DONE',
        priority: 20,
        updated_at: '2026-07-04T08:30:00.000Z',
        lookup_goal: 'FIND_CONTACT',
      },
      ...maybeNullRows.work_items,
    ],
    collected_leads: [
      {
        id: 'LOADER_TEST_COLLECTED_A',
        work_item_id: 'LOADER_TEST_WORK_ITEM_A',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        company_name: 'Loader Company A',
        sync_status: 'UNSYNCED',
        mobile: phone,
        tel,
        email,
        raw_text: rawText,
        note: notes,
      },
      {
        id: 'LOADER_TEST_COLLECTED_B',
        work_item_id: 'LOADER_TEST_WORK_ITEM_B',
        customer_id: 'LOADER_TEST_CUSTOMER_B',
        company_name: 'Loader Company B',
        sync_status: 'SYNCED',
      },
      ...maybeNullRows.collected_leads,
    ],
    replay_evidence: [
      {
        log_id: 'LOADER_TEST_SYNC_LOG_A',
        collected_lead_id: 'LOADER_TEST_COLLECTED_A',
        action: 'CREATE_CUSTOMER',
        target_customer_id: 'LOADER_TEST_CUSTOMER_A',
        status: 'SUCCESS',
        message: 'Read-only replay summary',
        created_at: '2026-07-05T08:45:00.000Z',
        work_item_id: 'LOADER_TEST_WORK_ITEM_A',
        work_item_status: 'COLLECTED',
        import_row_id: 'LOADER_TEST_IMPORT_ROW_A',
        collected_sync_status: 'UNSYNCED',
        collected_raw_text: rawText,
      },
      {
        log_id: 'LOADER_TEST_SYNC_LOG_B',
        collected_lead_id: 'LOADER_TEST_COLLECTED_B',
        action: 'SKIP_DUPLICATE',
        target_customer_id: 'LOADER_TEST_CUSTOMER_B',
        status: 'SKIPPED',
        message: 'Read-only skipped summary',
        created_at: '2026-07-04T08:45:00.000Z',
        work_item_id: 'LOADER_TEST_WORK_ITEM_B',
        work_item_status: 'DONE',
        import_row_id: 'LOADER_TEST_IMPORT_ROW_B',
        collected_sync_status: 'SYNCED',
      },
    ],
    import_rows: [
      {
        id: 'LOADER_TEST_IMPORT_ROW_A',
        company_name: 'Loader Company A',
        decision: 'CRM_WITH_LOOKUP',
        decision_status: 'DONE',
        customer_id: 'LOADER_TEST_CUSTOMER_A',
        created_customer_id: 'LOADER_TEST_CUSTOMER_A',
        created_work_item_id: 'LOADER_TEST_WORK_ITEM_A',
        raw_data_json: rawDataJson,
        mobile: phone,
        tel,
        email,
      },
      {
        id: 'LOADER_TEST_IMPORT_ROW_B',
        company_name: 'Loader Company B',
        decision: 'RESERVE',
        decision_status: 'PENDING',
        customer_id: 'LOADER_TEST_CUSTOMER_B',
        created_customer_id: 'LOADER_TEST_CUSTOMER_B',
        created_work_item_id: 'LOADER_TEST_WORK_ITEM_B',
      },
    ],
    capture_events: [
      {
        id: 'LOADER_TEST_CAPTURE_A',
        work_item_id: 'LOADER_TEST_WORK_ITEM_A',
        action: 'CAPTURE_SAVED',
        created_at: '2026-07-05T08:40:00.000Z',
        summary: 'CAPTURE_SAVED',
        raw_text: rawText,
        parsed_json: parsedJson,
      },
      {
        id: 'LOADER_TEST_CAPTURE_B',
        work_item_id: 'LOADER_TEST_WORK_ITEM_B',
        action: 'CAPTURE_SAVED',
        created_at: '2026-07-04T08:40:00.000Z',
        summary: 'CAPTURE_SAVED',
      },
    ],
  };
}

function filterById<T extends { id?: unknown }>(rows: T[], params: unknown[]): T[] {
  if (!params.includes('LOADER_TEST_CUSTOMER_A')) return rows;
  return rows.filter(row => row.id === 'LOADER_TEST_CUSTOMER_A');
}

function filterByCustomer<T extends { customer_id?: unknown; target_customer_id?: unknown }>(
  rows: T[],
  params: unknown[],
): T[] {
  if (!params.includes('LOADER_TEST_CUSTOMER_A')) return rows;
  return rows.filter(row => (
    row.customer_id === 'LOADER_TEST_CUSTOMER_A' || row.target_customer_id === 'LOADER_TEST_CUSTOMER_A'
  ));
}

function filterByWorkItem<T extends { id?: unknown; work_item_id?: unknown }>(rows: T[], params: unknown[]): T[] {
  if (!params.includes('LOADER_TEST_WORK_ITEM_A')) return rows;
  return rows.filter(row => row.id === 'LOADER_TEST_WORK_ITEM_A' || row.work_item_id === 'LOADER_TEST_WORK_ITEM_A');
}

function filterByImportTargets<T extends { customer_id?: unknown; created_work_item_id?: unknown }>(
  rows: T[],
  params: unknown[],
): T[] {
  let filtered = rows;
  if (params.includes('LOADER_TEST_CUSTOMER_A')) {
    filtered = filtered.filter(row => row.customer_id === 'LOADER_TEST_CUSTOMER_A');
  }
  if (params.includes('LOADER_TEST_WORK_ITEM_A')) {
    filtered = filtered.filter(row => row.created_work_item_id === 'LOADER_TEST_WORK_ITEM_A');
  }
  return filtered;
}

function applyLimit<T>(rows: T[], limit: number, options: { ignoreSelectLimit?: boolean }): T[] {
  return options.ignoreSelectLimit ? rows : rows.slice(0, limit);
}
