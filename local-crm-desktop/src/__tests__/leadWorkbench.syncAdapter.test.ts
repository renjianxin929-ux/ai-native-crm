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
import {
  insertLeadSyncLog,
  syncCollectedLeadCreateCustomer,
  syncCollectedLeadEnrichCustomer,
} from '../lib/leadWorkbench/syncAdapter';
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
    expect(result.patch.notes).toContain('Collected Contact');
    expect(result.message).toContain('notes');
  });

  it('Phase 4C-3 sync adapter stays out of legacy db, decision execution, and UI pages', () => {
    const syncSource = readFileSync(new URL('../lib/leadWorkbench/syncAdapter.ts', import.meta.url), 'utf8');

    expect(syncSource).toContain('insertCustomerWithDb');
    expect(syncSource).toContain('buildCustomerEnrichmentPatchFromCollectedLead');
    expect(syncSource).not.toContain('getDb(');
    expect(syncSource).not.toContain('createCustomer(');
    expect(syncSource).not.toContain('updateCustomer');
    expect(syncSource).not.toContain('DataImportPage');
    expect(syncSource).not.toContain('LeadImportCenterPage');
    expect(syncSource).not.toContain('executeLeadImportRowDecision');
  });
});

describe('lead workbench collected lead CREATE_CUSTOMER sync', () => {
  it('syncs an UNSYNCED collected lead into one new customer and writes SYNCED state and success log', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-sync-1',
        company_name: 'Sync Co',
        contact_name: 'Sync Contact',
        mobile: '13800138000',
        tel: '0757-88889999',
        website: 'https://sync.example',
        email: 'sales@sync.example',
        note: 'confirmed lead',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-sync-1');
      const customers = await db.select<Customer>('SELECT * FROM customers');
      const draft = await getCollectedLeadById(db, 'draft-sync-1');
      const logs = await db.select('SELECT * FROM lead_sync_logs');

      expect(result.status).toBe('SUCCESS');
      expect(result.collectedLeadId).toBe('draft-sync-1');
      expect(result.targetCustomerId).toBe(customers[0].id);
      expect(customers).toHaveLength(1);
      expect(customers[0]).toMatchObject({
        name: 'Sync Co',
        phone_number: '13800138000',
        contact_person: 'Sync Contact',
        website: 'https://sync.example',
        email: 'sales@sync.example',
        customer_grade: 'C',
        stage: 'NEW_LEAD',
      });
      expect(draft).toMatchObject({
        sync_status: 'SYNCED',
        created_customer_id: customers[0].id,
        updated_customer_id: null,
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        collected_lead_id: 'draft-sync-1',
        action: 'CREATE_CUSTOMER',
        status: 'SUCCESS',
        target_customer_id: customers[0].id,
      });
      expect(String((logs[0] as { message: string }).message)).toContain('Created customer from collected lead');
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('normal sync does not modify existing customers', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'existing-customer',
        name: 'Existing Co',
        phone_number: '13900139000',
      });
      const beforeExisting = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['existing-customer']);
      await insertStoredDraft(db, {
        id: 'draft-new-customer',
        company_name: 'Brand New Co',
        mobile: '13800138000',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-new-customer');
      const afterExisting = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['existing-customer']);
      const customers = await db.select<Customer>('SELECT * FROM customers ORDER BY name ASC');

      expect(result.status).toBe('SUCCESS');
      expect(afterExisting).toEqual(beforeExisting);
      expect(customers).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('rejects CREATE_CUSTOMER when collected_lead.customer_id is already set', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'existing-customer',
        name: 'Existing Co',
        phone_number: '13900139000',
      });
      await insertStoredDraft(db, {
        id: 'draft-enrich-mode',
        customer_id: 'existing-customer',
        company_name: 'Needs Enrich Co',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-enrich-mode');

      expect(result.status).toBe('INVALID_MODE');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('returns ALREADY_SYNCED for SYNCED leads without creating another customer', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'already-created',
        name: 'Already Co',
        phone_number: '13800138000',
      });
      await insertStoredDraft(db, {
        id: 'draft-already-synced',
        company_name: 'Already Co',
        mobile: '13800138000',
        sync_status: 'SYNCED',
        created_customer_id: 'already-created',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-already-synced');

      expect(result).toMatchObject({
        collectedLeadId: 'draft-already-synced',
        targetCustomerId: 'already-created',
        status: 'ALREADY_SYNCED',
      });
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('allows FAILED leads to retry and sync successfully', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-retry',
        company_name: 'Retry Co',
        mobile: '13800138000',
        sync_status: 'FAILED',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-retry');
      const draft = await getCollectedLeadById(db, 'draft-retry');

      expect(result.status).toBe('SUCCESS');
      expect(draft?.sync_status).toBe('SYNCED');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('rejects IGNORED leads without creating customers', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-ignored',
        company_name: 'Ignored Co',
        sync_status: 'IGNORED',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-ignored');

      expect(result.status).toBe('INVALID_STATUS');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('blocks duplicate phone creation and commits FAILED status with a skipped log', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'duplicate-phone-customer',
        name: 'Phone Owner Co',
        phone_number: '13800138000',
      });
      await insertStoredDraft(db, {
        id: 'draft-duplicate-phone',
        company_name: 'Duplicate Phone Co',
        mobile: '13800138000',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-duplicate-phone');
      const draft = await getCollectedLeadById(db, 'draft-duplicate-phone');
      const logs = await db.select<{ action: string; status: string; target_customer_id: string; message: string }>(
        'SELECT action, status, target_customer_id, message FROM lead_sync_logs',
      );

      expect(result).toMatchObject({
        status: 'DUPLICATE_PHONE',
        targetCustomerId: 'duplicate-phone-customer',
      });
      expect(draft?.sync_status).toBe('FAILED');
      expect(logs).toEqual([{
        action: 'SKIP_DUPLICATE',
        status: 'SKIPPED',
        target_customer_id: 'duplicate-phone-customer',
        message: 'Duplicate customer phone_number: 13800138000',
      }]);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('blocks duplicate company name creation after phone check and commits FAILED status with a skipped log', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'duplicate-name-customer',
        name: 'Duplicate Name Co',
        phone_number: '13900139000',
      });
      await insertStoredDraft(db, {
        id: 'draft-duplicate-name',
        company_name: 'Duplicate Name Co',
        mobile: '13800138000',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-duplicate-name');
      const draft = await getCollectedLeadById(db, 'draft-duplicate-name');
      const logs = await db.select<{ action: string; status: string; target_customer_id: string; message: string }>(
        'SELECT action, status, target_customer_id, message FROM lead_sync_logs',
      );

      expect(result).toMatchObject({
        status: 'DUPLICATE_NAME',
        targetCustomerId: 'duplicate-name-customer',
      });
      expect(draft?.sync_status).toBe('FAILED');
      expect(logs).toEqual([{
        action: 'SKIP_DUPLICATE',
        status: 'SKIPPED',
        target_customer_id: 'duplicate-name-customer',
        message: 'Duplicate customer name: Duplicate Name Co',
      }]);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('uses mobile before tel and falls back to tel when mobile is absent', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-mobile-first',
        company_name: 'Mobile First Co',
        mobile: '13800138000',
        tel: '0757-88889999',
      });
      await insertStoredDraft(db, {
        id: 'draft-tel-fallback',
        company_name: 'Tel Fallback Co',
        mobile: null,
        tel: '0757-77778888',
      });

      await syncCollectedLeadCreateCustomer(db, 'draft-mobile-first');
      await syncCollectedLeadCreateCustomer(db, 'draft-tel-fallback');
      const customers = await db.select<{ name: string; phone_number: string }>(
        'SELECT name, phone_number FROM customers ORDER BY name ASC',
      );

      expect(customers).toEqual([
        { name: 'Mobile First Co', phone_number: '13800138000' },
        { name: 'Tel Fallback Co', phone_number: '0757-77778888' },
      ]);
    } finally {
      db.close();
    }
  });

  it('creates a customer without phone when other useful fields exist and still checks duplicate company name', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-no-phone',
        company_name: 'No Phone Co',
        mobile: null,
        tel: null,
        website: 'https://no-phone.example',
        email: 'sales@no-phone.example',
        contact_name: 'No Phone Contact',
        note: 'has useful fields',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-no-phone');
      const customers = await db.select<Customer>('SELECT * FROM customers');

      expect(result.status).toBe('SUCCESS');
      expect(customers).toHaveLength(1);
      expect(customers[0]).toMatchObject({
        name: 'No Phone Co',
        phone_number: null,
        website: 'https://no-phone.example',
        email: 'sales@no-phone.example',
        contact_person: 'No Phone Contact',
      });
    } finally {
      db.close();
    }
  });

  it('blocks duplicate company name even when the collected lead has no phone', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'duplicate-no-phone-name',
        name: 'No Phone Duplicate Co',
        phone_number: null,
      });
      await insertStoredDraft(db, {
        id: 'draft-no-phone-duplicate',
        company_name: 'No Phone Duplicate Co',
        mobile: null,
        tel: null,
        website: 'https://duplicate.example',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-no-phone-duplicate');

      expect(result.status).toBe('DUPLICATE_NAME');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('rejects leads with no useful collected fields', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-empty-fields',
        company_name: 'Empty Fields Co',
        mobile: null,
        tel: null,
        website: null,
        email: null,
        contact_name: null,
        note: null,
        raw_text: 'raw evidence alone is not enough',
      });

      const result = await syncCollectedLeadCreateCustomer(db, 'draft-empty-fields');

      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('At least one collected lead field is required');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rolls back if customer creation succeeds but collected_lead writeback fails', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-rollback-writeback',
        company_name: 'Rollback Writeback Co',
        mobile: '13800138000',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('UPDATE collected_leads'));

      await expect(syncCollectedLeadCreateCustomer(throwingDb, 'draft-rollback-writeback')).rejects.toThrow('simulated db failure');
      const draft = await getCollectedLeadById(db, 'draft-rollback-writeback');

      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect(draft?.sync_status).toBe('UNSYNCED');
      expect(draft?.created_customer_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it('rolls back if collected_lead writeback succeeds but sync log insert fails', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-rollback-log',
        company_name: 'Rollback Log Co',
        mobile: '13800138000',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('INSERT INTO lead_sync_logs'));

      await expect(syncCollectedLeadCreateCustomer(throwingDb, 'draft-rollback-log')).rejects.toThrow('simulated db failure');
      const draft = await getCollectedLeadById(db, 'draft-rollback-log');

      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect(draft?.sync_status).toBe('UNSYNCED');
      expect(draft?.created_customer_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it('rejects blank and missing collected lead ids without writes', async () => {
    const db = await createReadyDb();
    try {
      const blank = await syncCollectedLeadCreateCustomer(db, '   ');
      const missing = await syncCollectedLeadCreateCustomer(db, 'missing-draft');

      expect(blank.status).toBe('FAILED');
      expect(missing.status).toBe('FAILED');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('lead workbench collected lead ENRICH_CUSTOMER sync', () => {
  it('enriches an UNSYNCED collected lead into an existing customer and writes SYNCED state and success log', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'enrich-customer-1',
        name: 'Existing Enrich Co',
        phone_number: null,
        contact_person: null,
        website: null,
        email: null,
        notes: 'existing notes',
        customer_grade: 'B',
        stage: 'CONTACTED',
        source: 'manual source',
      });
      await insertStoredDraft(db, {
        id: 'draft-enrich-1',
        customer_id: 'enrich-customer-1',
        company_name: 'Existing Enrich Co',
        contact_name: 'New Contact',
        position: 'Manager',
        mobile: '13800138000',
        tel: '0757-88889999',
        website: 'https://enrich.example',
        email: 'sales@enrich.example',
        note: 'verified by operator',
        raw_text: 'raw enrich evidence',
      });

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-enrich-1');
      const customers = await db.select<Customer>('SELECT * FROM customers');
      const draft = await getCollectedLeadById(db, 'draft-enrich-1');
      const logs = await db.select<{ action: string; status: string; target_customer_id: string; message: string }>(
        'SELECT action, status, target_customer_id, message FROM lead_sync_logs',
      );

      expect(result).toMatchObject({
        collectedLeadId: 'draft-enrich-1',
        targetCustomerId: 'enrich-customer-1',
        status: 'SUCCESS',
      });
      expect(customers).toHaveLength(1);
      expect(customers[0]).toMatchObject({
        id: 'enrich-customer-1',
        phone_number: '13800138000',
        contact_person: 'New Contact',
        website: 'https://enrich.example',
        email: 'sales@enrich.example',
        customer_grade: 'B',
        stage: 'CONTACTED',
        source: 'manual source',
      });
      expect(customers[0].notes).toContain('existing notes');
      expect(customers[0].notes).toContain('获客作业台采集线索');
      expect(customers[0].notes).toContain('Manager');
      expect(customers[0].notes).toContain('raw enrich evidence');
      expect(draft).toMatchObject({
        sync_status: 'SYNCED',
        created_customer_id: null,
        updated_customer_id: 'enrich-customer-1',
      });
      expect(logs).toEqual([{
        action: 'ENRICH_CUSTOMER',
        status: 'SUCCESS',
        target_customer_id: 'enrich-customer-1',
        message: 'Enriched customer from collected lead',
      }]);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rejects ENRICH when collected_lead.customer_id is empty without creating customers', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-create-mode',
        customer_id: null,
        company_name: 'Create Mode Co',
        mobile: '13800138000',
      });

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-create-mode');

      expect(result.status).toBe('INVALID_MODE');
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('marks FAILED and writes a failed log when customer_id does not exist', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'draft-missing-customer',
        customer_id: 'missing-customer',
        company_name: 'Missing Customer Co',
        mobile: '13800138000',
      }, { skipForeignKeys: true });

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-missing-customer');
      const draft = await getCollectedLeadById(db, 'draft-missing-customer');
      const logs = await db.select<{ action: string; status: string; target_customer_id: string | null; message: string }>(
        'SELECT action, status, target_customer_id, message FROM lead_sync_logs',
      );

      expect(result.status).toBe('CUSTOMER_NOT_FOUND');
      expect(draft?.sync_status).toBe('FAILED');
      expect(logs).toEqual([{
        action: 'ENRICH_CUSTOMER',
        status: 'FAILED',
        target_customer_id: null,
        message: 'Customer not found: missing-customer',
      }]);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('returns ALREADY_SYNCED for SYNCED enrich leads without modifying customers again', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'already-enriched-customer',
        name: 'Already Enriched Co',
        phone_number: '13900139000',
        notes: 'stable notes',
      });
      await insertStoredDraft(db, {
        id: 'draft-already-enriched',
        customer_id: 'already-enriched-customer',
        company_name: 'Already Enriched Co',
        mobile: '13800138000',
        sync_status: 'SYNCED',
        updated_customer_id: 'already-enriched-customer',
      });
      const before = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['already-enriched-customer']);

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-already-enriched');
      const after = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['already-enriched-customer']);

      expect(result).toMatchObject({
        collectedLeadId: 'draft-already-enriched',
        targetCustomerId: 'already-enriched-customer',
        status: 'ALREADY_SYNCED',
      });
      expect(after).toEqual(before);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('allows FAILED enrich leads to retry successfully', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'retry-enrich-customer',
        name: 'Retry Enrich Co',
        phone_number: null,
      });
      await insertStoredDraft(db, {
        id: 'draft-enrich-retry',
        customer_id: 'retry-enrich-customer',
        company_name: 'Retry Enrich Co',
        mobile: '13800138000',
        sync_status: 'FAILED',
      });

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-enrich-retry');
      const customer = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['retry-enrich-customer']);
      const draft = await getCollectedLeadById(db, 'draft-enrich-retry');

      expect(result.status).toBe('SUCCESS');
      expect(customer[0].phone_number).toBe('13800138000');
      expect(draft?.sync_status).toBe('SYNCED');
    } finally {
      db.close();
    }
  });

  it('rejects IGNORED enrich leads without modifying customers', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'ignored-enrich-customer',
        name: 'Ignored Enrich Co',
        phone_number: null,
      });
      await insertStoredDraft(db, {
        id: 'draft-enrich-ignored',
        customer_id: 'ignored-enrich-customer',
        company_name: 'Ignored Enrich Co',
        mobile: '13800138000',
        sync_status: 'IGNORED',
      });

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-enrich-ignored');
      const customer = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['ignored-enrich-customer']);

      expect(result.status).toBe('INVALID_STATUS');
      expect(customer[0].phone_number).toBeNull();
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('fills empty phone/contact/website/email but never overwrites existing values', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'protected-enrich-customer',
        name: 'Protected Co',
        phone_number: '13900139000',
        contact_person: 'Existing Contact',
        website: 'https://existing.example',
        email: 'existing@example.com',
        notes: 'existing notes',
        customer_grade: 'A',
        stage: 'VISITED',
        source: 'trusted source',
      });
      await insertStoredDraft(db, {
        id: 'draft-protected-enrich',
        customer_id: 'protected-enrich-customer',
        company_name: 'Protected Co',
        contact_name: 'Collected Contact',
        mobile: '13800138000',
        tel: '0757-88889999',
        website: 'https://collected.example',
        email: 'collected@example.com',
        note: 'append-only note',
      });

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-protected-enrich');
      const customer = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['protected-enrich-customer']);

      expect(result.status).toBe('SUCCESS');
      expect(customer[0]).toMatchObject({
        phone_number: '13900139000',
        contact_person: 'Existing Contact',
        website: 'https://existing.example',
        email: 'existing@example.com',
        customer_grade: 'A',
        stage: 'VISITED',
        source: 'trusted source',
        name: 'Protected Co',
      });
      expect(customer[0].notes).toContain('existing notes');
      expect(customer[0].notes).toContain('append-only note');
    } finally {
      db.close();
    }
  });

  it('fails with No enrichable fields when no safe patch can be produced', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'no-fields-customer',
        name: 'No Fields Co',
        phone_number: '13900139000',
        contact_person: 'Existing Contact',
        website: 'https://existing.example',
        email: 'existing@example.com',
        notes: 'existing notes',
      });
      await insertStoredDraft(db, {
        id: 'draft-no-enrichable-fields',
        customer_id: 'no-fields-customer',
        company_name: 'No Fields Co',
        contact_name: null,
        position: null,
        mobile: null,
        tel: null,
        website: null,
        email: null,
        note: null,
        raw_text: null,
      });
      const before = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['no-fields-customer']);

      const result = await syncCollectedLeadEnrichCustomer(db, 'draft-no-enrichable-fields');
      const after = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['no-fields-customer']);
      const draft = await getCollectedLeadById(db, 'draft-no-enrichable-fields');
      const logs = await db.select<{ action: string; status: string; target_customer_id: string; message: string }>(
        'SELECT action, status, target_customer_id, message FROM lead_sync_logs',
      );

      expect(result.status).toBe('NO_ENRICHABLE_FIELDS');
      expect(after).toEqual(before);
      expect(draft?.sync_status).toBe('FAILED');
      expect(logs).toEqual([{
        action: 'ENRICH_CUSTOMER',
        status: 'FAILED',
        target_customer_id: 'no-fields-customer',
        message: 'No enrichable fields for collected lead',
      }]);
    } finally {
      db.close();
    }
  });

  it('rolls back if customer update succeeds but collected_lead writeback fails', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'rollback-enrich-customer',
        name: 'Rollback Enrich Co',
        phone_number: null,
      });
      await insertStoredDraft(db, {
        id: 'draft-enrich-rollback-writeback',
        customer_id: 'rollback-enrich-customer',
        company_name: 'Rollback Enrich Co',
        mobile: '13800138000',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('UPDATE collected_leads'));

      await expect(syncCollectedLeadEnrichCustomer(throwingDb, 'draft-enrich-rollback-writeback')).rejects.toThrow('simulated db failure');
      const customer = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['rollback-enrich-customer']);
      const draft = await getCollectedLeadById(db, 'draft-enrich-rollback-writeback');

      expect(customer[0].phone_number).toBeNull();
      expect(draft?.sync_status).toBe('UNSYNCED');
      expect(draft?.updated_customer_id).toBeNull();
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('rolls back if collected_lead writeback succeeds but sync log insert fails', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'rollback-enrich-log-customer',
        name: 'Rollback Enrich Log Co',
        phone_number: null,
      });
      await insertStoredDraft(db, {
        id: 'draft-enrich-rollback-log',
        customer_id: 'rollback-enrich-log-customer',
        company_name: 'Rollback Enrich Log Co',
        mobile: '13800138000',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('INSERT INTO lead_sync_logs'));

      await expect(syncCollectedLeadEnrichCustomer(throwingDb, 'draft-enrich-rollback-log')).rejects.toThrow('simulated db failure');
      const customer = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', ['rollback-enrich-log-customer']);
      const draft = await getCollectedLeadById(db, 'draft-enrich-rollback-log');

      expect(customer[0].phone_number).toBeNull();
      expect(draft?.sync_status).toBe('UNSYNCED');
      expect(draft?.updated_customer_id).toBeNull();
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
    } finally {
      db.close();
    }
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

async function insertExistingCustomer(
  db: DatabaseLike,
  input: Pick<Customer, 'id' | 'name'> & Partial<Customer>,
) {
  const customer = makeCustomer(input);

  await db.execute(
    `INSERT INTO customers (
      id, name, customer_grade, stage, phone_number, contact_person,
      website, email, source, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customer.id,
      customer.name,
      customer.customer_grade,
      customer.stage,
      customer.phone_number,
      customer.contact_person,
      customer.website,
      customer.email,
      customer.source,
      customer.notes,
      customer.created_at,
      customer.updated_at,
    ],
  );
}

function createThrowingDb(
  db: DatabaseLike,
  shouldThrow: (sql: string) => boolean,
): DatabaseLike {
  return {
    async execute(sql: string, bindings: unknown[] = []) {
      if (shouldThrow(sql)) {
        throw new Error('simulated db failure');
      }
      return db.execute(sql, bindings);
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      return db.select<T>(sql, bindings);
    },
  };
}

async function insertStoredDraft(
  db: DatabaseLike,
  overrides: Partial<CollectedLead> = {},
  options: { skipForeignKeys?: boolean } = {},
) {
  const draft = makeCollectedLead(overrides);

  if (options.skipForeignKeys) {
    await db.execute('PRAGMA foreign_keys = OFF');
  }
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
  if (options.skipForeignKeys) {
    await db.execute('PRAGMA foreign_keys = ON');
  }
}
