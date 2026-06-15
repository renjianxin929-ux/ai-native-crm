import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  getCollectedLeadById,
  updateCollectedLeadSyncState,
  type CollectedLead,
} from '../lib/leadWorkbench/collectedLeads';
import {
  buildCustomerEnrichmentPatchFromCollectedLead,
  buildCustomerInputFromCollectedLead,
} from '../lib/leadWorkbench/customerAdapter';
import { ensureLeadWorkbenchSchema } from '../lib/leadWorkbench/db';
import { insertLeadSyncLog } from '../lib/leadWorkbench/syncAdapter';
import type { Customer } from '../lib/types';

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

describe('lead workbench sync adapter foundations', () => {
  it('getCollectedLeadById reads a collected lead without writing customers', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, { id: 'draft-read-1', company_name: 'Read Co' });

      const beforeCustomers = await db.select('SELECT * FROM customers');
      const draft = await getCollectedLeadById(db, 'draft-read-1');
      const afterCustomers = await db.select('SELECT * FROM customers');

      expect(draft).toMatchObject({
        id: 'draft-read-1',
        company_name: 'Read Co',
        sync_status: 'UNSYNCED',
      });
      expect(afterCustomers).toEqual(beforeCustomers);
    } finally {
      db.close();
    }
  });

  it('getCollectedLeadById returns null for a blank id', async () => {
    const db = await createReadyDb();
    try {
      await expect(getCollectedLeadById(db, '   ')).resolves.toBeNull();
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('updateCollectedLeadSyncState allows legal non-synced transitions and only updates collected_leads allowed fields', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-update-1',
        company_name: 'Original Co',
        contact_name: 'Original Contact',
        sync_status: 'UNSYNCED',
      });

      const updated = await updateCollectedLeadSyncState(db, {
        id: 'draft-update-1',
        fromStatus: 'UNSYNCED',
        toStatus: 'FAILED',
        created_customer_id: 'should-not-create-customer',
        updated_customer_id: 'should-not-update-customer',
        message: 'validation failed before sync',
        updated_at: '2026-06-15T01:00:00.000Z',
      });
      const rows = await db.select<CollectedLead>('SELECT * FROM collected_leads WHERE id = ?', ['draft-update-1']);

      expect(updated).toMatchObject({
        id: 'draft-update-1',
        company_name: 'Original Co',
        contact_name: 'Original Contact',
        sync_status: 'FAILED',
        created_customer_id: 'should-not-create-customer',
        updated_customer_id: 'should-not-update-customer',
        updated_at: '2026-06-15T01:00:00.000Z',
      });
      expect(rows[0]).toMatchObject(updated);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('updateCollectedLeadSyncState rejects illegal transitions and mismatched fromStatus', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-invalid-1',
        sync_status: 'IGNORED',
      });
      await insertStoredDraft(db, {
        id: 'draft-invalid-2',
        sync_status: 'FAILED',
      });

      await expect(updateCollectedLeadSyncState(db, {
        id: 'draft-invalid-1',
        toStatus: 'UNSYNCED',
        updated_at: '2026-06-15T01:00:00.000Z',
      })).rejects.toThrow('Invalid collected lead sync status transition');
      await expect(updateCollectedLeadSyncState(db, {
        id: 'draft-invalid-2',
        fromStatus: 'UNSYNCED',
        toStatus: 'FAILED',
        updated_at: '2026-06-15T01:00:00.000Z',
      })).rejects.toThrow('Collected lead sync status mismatch');

      const ignored = await getCollectedLeadById(db, 'draft-invalid-1');
      const failed = await getCollectedLeadById(db, 'draft-invalid-2');
      expect(ignored?.sync_status).toBe('IGNORED');
      expect(failed?.sync_status).toBe('FAILED');
    } finally {
      db.close();
    }
  });

  it('insertLeadSyncLog writes only lead_sync_logs', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, { id: 'draft-log-1', sync_status: 'UNSYNCED' });
      const beforeDrafts = await db.select<CollectedLead>('SELECT * FROM collected_leads');

      const log = await insertLeadSyncLog(db, {
        collected_lead_id: 'draft-log-1',
        action: 'SKIP_DUPLICATE',
        target_customer_id: null,
        status: 'SKIPPED',
        message: 'Duplicate phone found before customer creation',
      });

      const logs = await db.select('SELECT * FROM lead_sync_logs');
      const afterDrafts = await db.select<CollectedLead>('SELECT * FROM collected_leads');
      expect(logs).toEqual([log]);
      expect(log).toMatchObject({
        collected_lead_id: 'draft-log-1',
        action: 'SKIP_DUPLICATE',
        target_customer_id: null,
        status: 'SKIPPED',
        message: 'Duplicate phone found before customer creation',
      });
      expect(afterDrafts).toEqual(beforeDrafts);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('insertLeadSyncLog rejects blank collected_lead_id and blank message', async () => {
    const db = await createReadyDb();
    try {
      await expect(insertLeadSyncLog(db, {
        collected_lead_id: '',
        action: 'FAILED',
        target_customer_id: null,
        status: 'FAILED',
        message: 'missing collected lead',
      })).rejects.toThrow('collected_lead_id is required');

      await expect(insertLeadSyncLog(db, {
        collected_lead_id: 'draft-log-2',
        action: 'FAILED',
        target_customer_id: null,
        status: 'FAILED',
        message: '   ',
      })).rejects.toThrow('message is required');
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('buildCustomerInputFromCollectedLead maps safe customer fields without promoting to A', () => {
    const input = buildCustomerInputFromCollectedLead(makeCollectedLead({
      company_name: 'Collected Co',
      contact_name: 'Alice',
      mobile: '13800138000',
      tel: '0757-88889999',
      website: 'https://collected.example',
      email: 'sales@collected.example',
      note: 'manual note',
      raw_text: 'raw pasted text',
    }));

    expect(input).toMatchObject({
      name: 'Collected Co',
      phone_number: '13800138000',
      website: 'https://collected.example',
      email: 'sales@collected.example',
      contact_person: 'Alice',
      source: '获客作业台/采集线索',
      customer_grade: 'C',
      stage: 'NEW_LEAD',
      contact_method: 'PHONE',
      wechat_add_status: 'NOT_ADDED',
      intent_level: 'UNKNOWN',
      payment_status: 'NOT_STARTED',
      time_parse_status: 'NOT_PARSED',
      last_feedback_type: 'UNKNOWN',
    });
    expect(input.customer_grade).not.toBe('A');
    expect(input.notes).toContain('manual note');
    expect(input.notes).toContain('raw pasted text');
  });

  it('buildCustomerInputFromCollectedLead prefers mobile and falls back to tel', () => {
    expect(buildCustomerInputFromCollectedLead(makeCollectedLead({
      mobile: '13800138000',
      tel: '0757-88889999',
    })).phone_number).toBe('13800138000');
    expect(buildCustomerInputFromCollectedLead(makeCollectedLead({
      mobile: null,
      tel: '0757-88889999',
    })).phone_number).toBe('0757-88889999');
  });

  it('buildCustomerEnrichmentPatchFromCollectedLead only fills empty fields and appends notes', () => {
    const existing = makeCustomer({
      phone_number: null,
      contact_person: null,
      website: null,
      email: null,
      notes: 'existing notes',
      customer_grade: 'B',
      stage: 'CONTACTED',
      source: 'manual source',
    });

    const result = buildCustomerEnrichmentPatchFromCollectedLead(existing, makeCollectedLead({
      mobile: '13800138000',
      contact_name: 'Alice',
      website: 'https://collected.example',
      email: 'sales@collected.example',
      note: 'new note',
      raw_text: 'raw evidence',
    }));

    expect(result.patch).toMatchObject({
      phone_number: '13800138000',
      contact_person: 'Alice',
      website: 'https://collected.example',
      email: 'sales@collected.example',
    });
    expect(result.patch.notes).toContain('existing notes');
    expect(result.patch.notes).toContain('new note');
    expect(result.patch.notes).toContain('raw evidence');
    expect(result.patch.notes).not.toBe('existing notes');
    expect(result.patch).not.toHaveProperty('customer_grade');
    expect(result.patch).not.toHaveProperty('stage');
    expect(result.patch).not.toHaveProperty('source');
    expect(result.message).toContain('phone_number');
    expect(result.message).toContain('notes');
  });

  it('buildCustomerEnrichmentPatchFromCollectedLead does not overwrite existing phone or contact person', () => {
    const result = buildCustomerEnrichmentPatchFromCollectedLead(
      makeCustomer({
        phone_number: '13900139000',
        contact_person: 'Existing Contact',
        website: 'https://existing.example',
        email: 'existing@example.com',
        customer_grade: 'A',
        stage: 'VISITED',
        source: 'trusted source',
      }),
      makeCollectedLead({
        mobile: '13800138000',
        tel: '0757-88889999',
        contact_name: 'Collected Contact',
        website: 'https://collected.example',
        email: 'sales@collected.example',
        note: null,
        raw_text: null,
      }),
    );

    expect(result.patch).not.toHaveProperty('phone_number');
    expect(result.patch).not.toHaveProperty('contact_person');
    expect(result.patch).not.toHaveProperty('website');
    expect(result.patch).not.toHaveProperty('email');
    expect(result.patch).not.toHaveProperty('customer_grade');
    expect(result.patch).not.toHaveProperty('stage');
    expect(result.patch).not.toHaveProperty('source');
    expect(result.message).toContain('No empty customer fields');
  });

  it('Phase 4C-1 sync adapter does not implement full sync, create customers, or import UI pages', () => {
    const syncSource = readFileSync(new URL('../lib/leadWorkbench/syncAdapter.ts', import.meta.url), 'utf8');

    expect(syncSource).not.toContain('insertCustomerWithDb');
    expect(syncSource).not.toContain('updateCustomer');
    expect(syncSource).not.toContain('DataImportPage');
    expect(syncSource).not.toContain('LeadImportCenterPage');
    expect(syncSource).not.toContain('executeLeadImportRowDecision');
  });
});

function makeCollectedLead(overrides: Partial<CollectedLead> = {}): CollectedLead {
  return {
    id: 'draft-1',
    work_item_id: null,
    import_row_id: null,
    customer_id: null,
    company_name: 'Draft Co',
    contact_name: 'Draft Contact',
    position: null,
    mobile: '13800138000',
    tel: null,
    website: null,
    email: null,
    raw_text: 'raw text',
    note: 'note text',
    sync_status: 'UNSYNCED',
    created_customer_id: null,
    updated_customer_id: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    name: 'Existing Customer',
    customer_grade: 'C',
    stage: 'NEW_LEAD',
    contact_method: 'PHONE',
    wechat_id: null,
    phone_number: null,
    wechat_search_status: null,
    is_key_decision_maker: 0,
    wechat_add_status: 'NOT_ADDED',
    has_replied: 0,
    intent_level: 'UNKNOWN',
    phone_feedback: null,
    can_schedule_visit: 0,
    visit_scheduled_at: null,
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    next_follow_up_at: null,
    last_contacted_at: null,
    last_feedback_type: 'UNKNOWN',
    next_action: null,
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    paid_at: null,
    closed_at: null,
    website: null,
    region: null,
    industry: null,
    contact_person: null,
    email: null,
    address: null,
    pitch_angle: null,
    qualification_reason: null,
    source: null,
    notes: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

async function insertStoredDraft(
  db: DatabaseLike,
  overrides: Partial<CollectedLead> = {},
) {
  const draft = makeCollectedLead(overrides);

  await db.execute(
    `INSERT INTO collected_leads (
      id, work_item_id, import_row_id, customer_id, company_name, contact_name,
      position, mobile, tel, website, email, raw_text, note, sync_status,
      created_customer_id, updated_customer_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id,
      draft.work_item_id,
      draft.import_row_id,
      draft.customer_id,
      draft.company_name,
      draft.contact_name,
      draft.position,
      draft.mobile,
      draft.tel,
      draft.website,
      draft.email,
      draft.raw_text,
      draft.note,
      draft.sync_status,
      draft.created_customer_id,
      draft.updated_customer_id,
      draft.created_at,
      draft.updated_at,
    ],
  );
}
