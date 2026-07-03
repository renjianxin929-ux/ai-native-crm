import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  insertLeadWorkItem,
} from '../lib/leadWorkbench/db';
import {
  getCollectedLeadSyncStatusCounts,
  insertCollectedLeadDraft,
  updateCollectedLeadSyncState,
} from '../lib/leadWorkbench/collectedLeads';
import {
  getLeadSyncLogStatusCounts,
  insertLeadSyncLog,
} from '../lib/leadWorkbench/syncAdapter';
import type { LeadWorkItem, LeadWorkStatus } from '../lib/leadWorkbench/types';
import { buildLeadWorkbenchRealityStatRows } from '../pages/LeadWorkbenchPage';

function createSqliteDb(): DatabaseLike & { close(): void } {
  const sqlite = new Database(':memory:');

  return {
    async execute(sql: string, bindings: unknown[] = []) {
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: Number(result.changes) };
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      return sqlite.prepare(sql).all(bindings as never[]) as T[];
    },
    close() {
      sqlite.close();
    },
  };
}

async function createReadyDb() {
  const db = createSqliteDb();
  await ensureBaseSchema(db);
  await ensureLeadWorkbenchSchema(db);
  return db;
}

describe('lead workbench real stats reality gate', () => {
  it('counts collected_leads sync statuses from the real database and returns zeros for an empty DB', async () => {
    const emptyDb = await createReadyDb();
    try {
      await expect(getCollectedLeadSyncStatusCounts(emptyDb)).resolves.toEqual({
        UNSYNCED: 0,
        SYNCED: 0,
        FAILED: 0,
        IGNORED: 0,
      });
    } finally {
      emptyDb.close();
    }

    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-real-stats' }));
      const unsynced = await insertCollectedLeadDraft(db, createCollectedLeadDraftInput('work-real-stats', 'unsynced', '13800138001'));
      const synced = await insertCollectedLeadDraft(db, createCollectedLeadDraftInput('work-real-stats', 'synced', '13800138002'));
      const failed = await insertCollectedLeadDraft(db, createCollectedLeadDraftInput('work-real-stats', 'failed', '13800138003'));

      await updateCollectedLeadSyncState(db, {
        id: synced.id,
        fromStatus: 'UNSYNCED',
        toStatus: 'SYNCED',
        created_customer_id: 'customer-synced',
        updated_at: '2026-06-19T00:00:00.000Z',
      });
      await updateCollectedLeadSyncState(db, {
        id: failed.id,
        fromStatus: 'UNSYNCED',
        toStatus: 'FAILED',
        updated_at: '2026-06-19T00:01:00.000Z',
      });

      await expect(getCollectedLeadSyncStatusCounts(db)).resolves.toEqual({
        UNSYNCED: 1,
        SYNCED: 1,
        FAILED: 1,
        IGNORED: 0,
      });
      expect(unsynced.id).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('counts lead_sync_logs statuses from the real database', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-sync-stats' }));
      const collected = await insertCollectedLeadDraft(db, createCollectedLeadDraftInput('work-sync-stats', 'sync-log', '13800138004'));

      await insertLeadSyncLog(db, {
        collected_lead_id: collected.id,
        action: 'CREATE_CUSTOMER',
        target_customer_id: null,
        status: 'SUCCESS',
        message: 'Created customer from collected lead',
      });
      await insertLeadSyncLog(db, {
        collected_lead_id: collected.id,
        action: 'ENRICH_CUSTOMER',
        target_customer_id: null,
        status: 'FAILED',
        message: 'No enrichable fields for collected lead',
      });
      await insertLeadSyncLog(db, {
        collected_lead_id: collected.id,
        action: 'SKIP_DUPLICATE',
        target_customer_id: null,
        status: 'SKIPPED',
        message: 'Duplicate customer phone_number',
      });

      await expect(getLeadSyncLogStatusCounts(db)).resolves.toEqual({
        SUCCESS: 1,
        FAILED: 1,
        SKIPPED: 1,
      });
    } finally {
      db.close();
    }
  });

  it('keeps the workbench page wired to real collected lead and sync log summary queries', () => {
    const pageSource = readFileSync(resolve(__dirname, '../pages/LeadWorkbenchPage.tsx'), 'utf8');
    const rows = buildLeadWorkbenchRealityStatRows({
      collectedLeadSyncCounts: {
        UNSYNCED: 2,
        SYNCED: 1,
        FAILED: 0,
        IGNORED: 0,
      },
      syncLogStatusCounts: {
        SUCCESS: 3,
        FAILED: 1,
        SKIPPED: 0,
      },
    });

    expect(pageSource).toContain('getCollectedLeadSyncStatusCounts');
    expect(pageSource).toContain('getLeadSyncLogStatusCounts');
    expect(rows).toContainEqual({ label: 'collected_leads UNSYNCED', count: 2 });
    expect(rows).toContainEqual({ label: 'lead_sync_logs SUCCESS', count: 3 });
    expect(pageSource).not.toContain('LEAD_IMPORT_SAMPLE');
    expect(pageSource).not.toContain('sampleRows');
  });
});

function createCollectedLeadDraftInput(
  workItemId: string,
  suffix: string,
  mobile: string,
): Parameters<typeof insertCollectedLeadDraft>[1] {
  return {
    work_item_id: workItemId,
    capture_event_id: null,
    import_row_id: null,
    customer_id: null,
    company_name: `Real Stats ${suffix}`,
    contact_name: null,
    position: null,
    mobile,
    tel: null,
    website: null,
    email: null,
    raw_text: `mobile ${mobile}`,
    note: `real stats ${suffix}`,
  };
}

function createWorkItem(overrides: Partial<LeadWorkItem> = {}): LeadWorkItem {
  return {
    id: 'work-1',
    import_row_id: null,
    customer_id: null,
    work_type: 'NEW_CUSTOMER_LOOKUP',
    company_name: 'Real Stats Work Co',
    city: 'Foshan',
    industry: 'Lighting',
    priority: 80,
    lookup_goal: 'FIND_PHONE',
    tanji_search_keyword: 'Real Stats Work Co',
    status: 'COLLECTED' as LeadWorkStatus,
    note: null,
    created_at: '2026-06-19T00:00:00.000Z',
    updated_at: '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}
