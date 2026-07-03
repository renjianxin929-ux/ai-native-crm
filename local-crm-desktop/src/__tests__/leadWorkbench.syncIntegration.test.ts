import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { getCollectedLeadById, type CollectedLead } from '../lib/leadWorkbench/collectedLeads';
import {
  ensureLeadWorkbenchSchema,
  getLeadWorkItemById,
  insertLeadWorkItem,
} from '../lib/leadWorkbench/db';
import {
  syncCollectedLeadCreateCustomer,
  syncCollectedLeadEnrichCustomer,
} from '../lib/leadWorkbench/syncAdapter';
import type { LeadWorkItem } from '../lib/leadWorkbench/types';
import type { Customer } from '../lib/types';

type SyncLogRow = {
  collected_lead_id: string;
  action: string;
  target_customer_id: string | null;
  status: string;
  message: string;
};

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

describe('lead workbench collected lead CRM sync integration', () => {
  it('syncs mixed CREATE_CUSTOMER and ENRICH_CUSTOMER batches with logs, idempotency, and failures isolated', async () => {
    const db = await createReadyDb();
    try {
      await seedMixedScenario(db);

      const createSuccessIds = ['create-1', 'create-2', 'create-3', 'create-4', 'create-5'];
      const enrichSuccessIds = ['enrich-1', 'enrich-2', 'enrich-3'];
      const duplicatePhoneIds = ['duplicate-phone-1', 'duplicate-phone-2'];
      const duplicateNameIds = ['duplicate-name-1', 'duplicate-name-2'];

      for (const id of createSuccessIds) {
        expect((await syncCollectedLeadCreateCustomer(db, id)).status).toBe('SUCCESS');
      }
      for (const id of enrichSuccessIds) {
        expect((await syncCollectedLeadEnrichCustomer(db, id)).status).toBe('SUCCESS');
      }
      for (const id of duplicatePhoneIds) {
        expect((await syncCollectedLeadCreateCustomer(db, id)).status).toBe('DUPLICATE_PHONE');
      }
      for (const id of duplicateNameIds) {
        expect((await syncCollectedLeadCreateCustomer(db, id)).status).toBe('DUPLICATE_NAME');
      }

      expect((await syncCollectedLeadEnrichCustomer(db, 'missing-customer-enrich')).status).toBe('CUSTOMER_NOT_FOUND');
      expect((await syncCollectedLeadCreateCustomer(db, 'ignored-create')).status).toBe('INVALID_STATUS');
      expect((await syncCollectedLeadCreateCustomer(db, 'already-synced-create')).status).toBe('ALREADY_SYNCED');

      const customers = await db.select<Customer>('SELECT * FROM customers ORDER BY name ASC');
      const logs = await db.select<SyncLogRow>(
        'SELECT collected_lead_id, action, target_customer_id, status, message FROM lead_sync_logs ORDER BY rowid ASC',
      );

      expect(customers).toHaveLength(13);
      expect(await db.select('SELECT * FROM lead_work_items')).toHaveLength(0);

      for (const id of createSuccessIds) {
        const draft = await getCollectedLeadById(db, id);
        expect(draft?.sync_status).toBe('SYNCED');
        expect(draft?.created_customer_id).toBeTruthy();
        expect(customers.some(customer => customer.id === draft?.created_customer_id)).toBe(true);
      }

      for (const id of enrichSuccessIds) {
        const draft = await getCollectedLeadById(db, id);
        expect(draft?.sync_status).toBe('SYNCED');
        expect(draft?.updated_customer_id).toBe(draft?.customer_id);
      }

      const enrichedEmpty = await getCustomer(db, 'enrich-empty-customer');
      expect(enrichedEmpty).toMatchObject({
        phone_number: '13810001001',
        contact_person: 'Collected Contact One',
        website: 'https://enrich-one.example',
        email: 'one@enrich.example',
        customer_grade: 'B',
        stage: 'CONTACTED',
        source: 'trusted-source',
      });
      expect(enrichedEmpty?.notes).toContain('existing empty notes');
      expect(enrichedEmpty?.notes).toContain('note one');

      const protectedCustomer = await getCustomer(db, 'enrich-protected-customer');
      expect(protectedCustomer).toMatchObject({
        phone_number: '13900009999',
        contact_person: 'Existing Contact',
        website: 'https://existing.example',
        email: 'existing@example.com',
        customer_grade: 'A',
        stage: 'VISITED',
        source: 'manual-source',
      });
      expect(protectedCustomer?.notes).toContain('protected notes');
      expect(protectedCustomer?.notes).toContain('append protected note');

      const partialCustomer = await getCustomer(db, 'enrich-partial-customer');
      expect(partialCustomer).toMatchObject({
        phone_number: '13911112222',
        contact_person: 'Partial Existing Contact',
        website: 'https://partial.example',
        email: 'partial@enrich.example',
        customer_grade: 'C',
        stage: 'NEW_LEAD',
        source: 'partial-source',
      });

      for (const id of duplicatePhoneIds) {
        const draft = await getCollectedLeadById(db, id);
        expect(draft?.sync_status).toBe('FAILED');
        expect(draft?.created_customer_id).toBeNull();
      }
      for (const id of duplicateNameIds) {
        const draft = await getCollectedLeadById(db, id);
        expect(draft?.sync_status).toBe('FAILED');
        expect(draft?.created_customer_id).toBeNull();
      }

      const missingCustomerDraft = await getCollectedLeadById(db, 'missing-customer-enrich');
      expect(missingCustomerDraft?.sync_status).toBe('FAILED');
      expect(missingCustomerDraft?.updated_customer_id).toBeNull();
      expect(await getCustomer(db, 'missing-customer')).toBeNull();

      expect((await getCollectedLeadById(db, 'ignored-create'))?.sync_status).toBe('IGNORED');
      expect((await getCollectedLeadById(db, 'already-synced-create'))?.created_customer_id).toBe('already-synced-customer');
      expect(customers.filter(customer => customer.id === 'already-synced-customer')).toHaveLength(1);

      expect(logs.filter(log => log.action === 'CREATE_CUSTOMER' && log.status === 'SUCCESS')).toHaveLength(5);
      expect(logs.filter(log => log.action === 'ENRICH_CUSTOMER' && log.status === 'SUCCESS')).toHaveLength(3);
      expect(logs.filter(log => log.action === 'SKIP_DUPLICATE' && log.status === 'SKIPPED')).toHaveLength(4);
      expect(logs.filter(log => log.action === 'ENRICH_CUSTOMER' && log.status === 'FAILED')).toHaveLength(1);
      expect(logs).toHaveLength(13);

      expect(logFor(logs, 'duplicate-phone-1')).toMatchObject({
        target_customer_id: 'duplicate-phone-customer-1',
        message: 'Duplicate customer phone_number: 13890000001',
      });
      expect(logFor(logs, 'duplicate-name-1')).toMatchObject({
        target_customer_id: 'duplicate-name-customer-1',
        message: 'Duplicate customer name: Duplicate Name One',
      });
      expect(logFor(logs, 'missing-customer-enrich')).toMatchObject({
        target_customer_id: null,
        message: 'Customer not found: missing-customer',
      });
      expect(logs.every(log => log.message.trim().length > 8)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('rolls back CREATE when customer insert succeeds but collected lead writeback fails', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'create-rollback-writeback',
        company_name: 'Create Rollback Writeback Co',
        mobile: '13820002001',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('UPDATE collected_leads'));

      await expect(syncCollectedLeadCreateCustomer(throwingDb, 'create-rollback-writeback')).rejects.toThrow('simulated db failure');

      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect((await getCollectedLeadById(db, 'create-rollback-writeback'))?.sync_status).toBe('UNSYNCED');
    } finally {
      db.close();
    }
  });

  it('rolls back CREATE when collected lead writeback succeeds but sync log insert fails', async () => {
    const db = await createReadyDb();
    try {
      await insertStoredDraft(db, {
        id: 'create-rollback-log',
        company_name: 'Create Rollback Log Co',
        mobile: '13820002002',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('INSERT INTO lead_sync_logs'));

      await expect(syncCollectedLeadCreateCustomer(throwingDb, 'create-rollback-log')).rejects.toThrow('simulated db failure');

      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect((await getCollectedLeadById(db, 'create-rollback-log'))?.created_customer_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it('rolls back ENRICH when customer update succeeds but collected lead writeback fails', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'enrich-rollback-writeback-customer',
        name: 'Enrich Rollback Writeback Co',
        phone_number: null,
      });
      await insertStoredDraft(db, {
        id: 'enrich-rollback-writeback',
        customer_id: 'enrich-rollback-writeback-customer',
        company_name: 'Enrich Rollback Writeback Co',
        mobile: '13830003001',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('UPDATE collected_leads'));

      await expect(syncCollectedLeadEnrichCustomer(throwingDb, 'enrich-rollback-writeback')).rejects.toThrow('simulated db failure');

      expect((await getCustomer(db, 'enrich-rollback-writeback-customer'))?.phone_number).toBeNull();
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect((await getCollectedLeadById(db, 'enrich-rollback-writeback'))?.updated_customer_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it('rolls back ENRICH when collected lead writeback succeeds but sync log insert fails', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'enrich-rollback-log-customer',
        name: 'Enrich Rollback Log Co',
        phone_number: null,
      });
      await insertStoredDraft(db, {
        id: 'enrich-rollback-log',
        customer_id: 'enrich-rollback-log-customer',
        company_name: 'Enrich Rollback Log Co',
        mobile: '13830003002',
      });
      const throwingDb = createThrowingDb(db, sql => sql.includes('INSERT INTO lead_sync_logs'));

      await expect(syncCollectedLeadEnrichCustomer(throwingDb, 'enrich-rollback-log')).rejects.toThrow('simulated db failure');

      expect((await getCustomer(db, 'enrich-rollback-log-customer'))?.phone_number).toBeNull();
      expect(await db.select('SELECT * FROM lead_sync_logs')).toHaveLength(0);
      expect((await getCollectedLeadById(db, 'enrich-rollback-log'))?.sync_status).toBe('UNSYNCED');
    } finally {
      db.close();
    }
  });

  it('closes only the synced collected lead work item after successful create and enrich', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'work-close-enrich-customer',
        name: 'Work Close Enrich Co',
        phone_number: null,
      });
      await insertStoredWorkItem(db, {
        id: 'create-work',
        import_row_id: 'create-import',
        status: 'COLLECTED',
      });
      await insertStoredWorkItem(db, {
        id: 'enrich-work',
        import_row_id: 'enrich-import',
        customer_id: 'work-close-enrich-customer',
        status: 'COLLECTED',
      });
      await insertStoredWorkItem(db, {
        id: 'unrelated-work',
        import_row_id: 'unrelated-import',
        status: 'COLLECTED',
      });
      await insertStoredDraft(db, {
        id: 'create-work-draft',
        work_item_id: 'create-work',
        import_row_id: 'create-import',
        company_name: 'Work Close Create Co',
        mobile: '13840004001',
      }, { skipForeignKeys: true });
      await insertStoredDraft(db, {
        id: 'enrich-work-draft',
        work_item_id: 'enrich-work',
        import_row_id: 'enrich-import',
        customer_id: 'work-close-enrich-customer',
        company_name: 'Work Close Enrich Co',
        mobile: '13840004002',
      }, { skipForeignKeys: true });

      expect((await syncCollectedLeadCreateCustomer(db, 'create-work-draft')).status).toBe('SUCCESS');
      expect((await syncCollectedLeadEnrichCustomer(db, 'enrich-work-draft')).status).toBe('SUCCESS');

      expect((await getLeadWorkItemById(db, 'create-work'))?.status).toBe('DONE');
      expect((await getLeadWorkItemById(db, 'enrich-work'))?.status).toBe('DONE');
      expect((await getLeadWorkItemById(db, 'unrelated-work'))?.status).toBe('COLLECTED');
    } finally {
      db.close();
    }
  });

  it('does not close work items when sync fails, log insert rolls back, or the item is not collected', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'failure-phone-owner',
        name: 'Failure Phone Owner',
        phone_number: '13850005001',
      });
      await insertStoredWorkItem(db, {
        id: 'failed-work',
        import_row_id: 'failed-import',
        status: 'COLLECTED',
      });
      await insertStoredWorkItem(db, {
        id: 'rollback-work',
        import_row_id: 'rollback-import',
        status: 'COLLECTED',
      });
      await insertStoredWorkItem(db, {
        id: 'todo-work',
        import_row_id: 'todo-import',
        status: 'TODO',
      });
      await insertStoredDraft(db, {
        id: 'failed-work-draft',
        work_item_id: 'failed-work',
        import_row_id: 'failed-import',
        company_name: 'Failure Phone Draft',
        mobile: '13850005001',
      }, { skipForeignKeys: true });
      await insertStoredDraft(db, {
        id: 'rollback-work-draft',
        work_item_id: 'rollback-work',
        import_row_id: 'rollback-import',
        company_name: 'Rollback Work Draft',
        mobile: '13850005002',
      }, { skipForeignKeys: true });
      await insertStoredDraft(db, {
        id: 'todo-work-draft',
        work_item_id: 'todo-work',
        import_row_id: 'todo-import',
        company_name: 'Todo Work Draft',
        mobile: '13850005003',
      }, { skipForeignKeys: true });

      expect((await syncCollectedLeadCreateCustomer(db, 'failed-work-draft')).status).toBe('DUPLICATE_PHONE');
      const throwingDb = createThrowingDb(db, sql => sql.includes('INSERT INTO lead_sync_logs'));
      await expect(syncCollectedLeadCreateCustomer(throwingDb, 'rollback-work-draft')).rejects.toThrow('simulated db failure');
      expect((await syncCollectedLeadCreateCustomer(db, 'todo-work-draft')).status).toBe('SUCCESS');

      expect((await getLeadWorkItemById(db, 'failed-work'))?.status).toBe('COLLECTED');
      expect((await getLeadWorkItemById(db, 'rollback-work'))?.status).toBe('COLLECTED');
      expect((await getLeadWorkItemById(db, 'todo-work'))?.status).toBe('TODO');
    } finally {
      db.close();
    }
  });

  it('does not close a collected work item when the collected lead linkage does not match it', async () => {
    const db = await createReadyDb();
    try {
      await insertExistingCustomer(db, {
        id: 'mismatch-enrich-customer',
        name: 'Mismatch Enrich Co',
        phone_number: null,
      });
      await insertExistingCustomer(db, {
        id: 'other-enrich-customer',
        name: 'Other Enrich Co',
        phone_number: null,
      });
      await insertStoredWorkItem(db, {
        id: 'mismatch-create-work',
        import_row_id: 'work-import',
        status: 'COLLECTED',
      });
      await insertStoredWorkItem(db, {
        id: 'mismatch-enrich-work',
        import_row_id: 'enrich-import',
        customer_id: 'other-enrich-customer',
        status: 'COLLECTED',
      });
      await insertStoredDraft(db, {
        id: 'mismatch-create-draft',
        work_item_id: 'mismatch-create-work',
        import_row_id: 'draft-import',
        company_name: 'Mismatch Create Co',
        mobile: '13860006001',
      }, { skipForeignKeys: true });
      await insertStoredDraft(db, {
        id: 'mismatch-enrich-draft',
        work_item_id: 'mismatch-enrich-work',
        import_row_id: 'enrich-import',
        customer_id: 'mismatch-enrich-customer',
        company_name: 'Mismatch Enrich Co',
        mobile: '13860006002',
      }, { skipForeignKeys: true });

      expect((await syncCollectedLeadCreateCustomer(db, 'mismatch-create-draft')).status).toBe('SUCCESS');
      expect((await syncCollectedLeadEnrichCustomer(db, 'mismatch-enrich-draft')).status).toBe('SUCCESS');

      expect((await getLeadWorkItemById(db, 'mismatch-create-work'))?.status).toBe('COLLECTED');
      expect((await getLeadWorkItemById(db, 'mismatch-enrich-work'))?.status).toBe('COLLECTED');
    } finally {
      db.close();
    }
  });

  it('keeps sync integration boundaries away from UI, importers, work item creation, clipboard, and Tanji automation', () => {
    const syncSource = readFileSync(new URL('../lib/leadWorkbench/syncAdapter.ts', import.meta.url), 'utf8');
    const customerSource = readFileSync(new URL('../lib/leadWorkbench/customerAdapter.ts', import.meta.url), 'utf8');
    const combined = `${syncSource}\n${customerSource}`;

    expect(combined).not.toContain('Data' + 'ImportPage');
    expect(combined).not.toContain('../' + 'importer');
    expect(combined).not.toContain('Lead' + 'ImportCenterPage');
    expect(combined).not.toContain('executeLead' + 'ImportRowDecision');
    expect(combined).not.toContain('navigator.' + 'clipboard');
    expect(combined).not.toContain('clip' + 'board');
    expect(combined).not.toContain('tan' + 'ji');
    expect(combined).not.toContain('insertLead' + 'WorkItem');
    expect(syncSource).toContain('updateLead' + 'WorkItemStatus');
  });
});

async function seedMixedScenario(db: DatabaseLike): Promise<void> {
  await insertExistingCustomer(db, { id: 'duplicate-phone-customer-1', name: 'Phone Owner One', phone_number: '13890000001' });
  await insertExistingCustomer(db, { id: 'duplicate-phone-customer-2', name: 'Phone Owner Two', phone_number: '13890000002' });
  await insertExistingCustomer(db, { id: 'duplicate-name-customer-1', name: 'Duplicate Name One', phone_number: '13990000001' });
  await insertExistingCustomer(db, { id: 'duplicate-name-customer-2', name: 'Duplicate Name Two', phone_number: '13990000002' });
  await insertExistingCustomer(db, { id: 'already-synced-customer', name: 'Already Synced Co', phone_number: '13890000003' });
  await insertExistingCustomer(db, {
    id: 'enrich-empty-customer',
    name: 'Enrich Empty Co',
    phone_number: null,
    contact_person: null,
    website: null,
    email: null,
    notes: 'existing empty notes',
    customer_grade: 'B',
    stage: 'CONTACTED',
    source: 'trusted-source',
  });
  await insertExistingCustomer(db, {
    id: 'enrich-protected-customer',
    name: 'Enrich Protected Co',
    phone_number: '13900009999',
    contact_person: 'Existing Contact',
    website: 'https://existing.example',
    email: 'existing@example.com',
    notes: 'protected notes',
    customer_grade: 'A',
    stage: 'VISITED',
    source: 'manual-source',
  });
  await insertExistingCustomer(db, {
    id: 'enrich-partial-customer',
    name: 'Enrich Partial Co',
    phone_number: '13911112222',
    contact_person: 'Partial Existing Contact',
    website: null,
    email: null,
    notes: null,
    customer_grade: 'C',
    stage: 'NEW_LEAD',
    source: 'partial-source',
  });

  for (let index = 1; index <= 5; index += 1) {
    await insertStoredDraft(db, {
      id: `create-${index}`,
      company_name: `Create Success ${index}`,
      contact_name: `Create Contact ${index}`,
      mobile: `1381000000${index}`,
      website: `https://create-${index}.example`,
      email: `create-${index}@example.test`,
      note: `create note ${index}`,
    });
  }

  await insertStoredDraft(db, {
    id: 'enrich-1',
    customer_id: 'enrich-empty-customer',
    company_name: 'Enrich Empty Co',
    contact_name: 'Collected Contact One',
    position: 'Director',
    mobile: '13810001001',
    tel: '0757-1001001',
    website: 'https://enrich-one.example',
    email: 'one@enrich.example',
    note: 'note one',
    raw_text: 'raw one',
  });
  await insertStoredDraft(db, {
    id: 'enrich-2',
    customer_id: 'enrich-protected-customer',
    company_name: 'Enrich Protected Co',
    contact_name: 'Should Not Replace',
    mobile: '13810001002',
    website: 'https://should-not-replace.example',
    email: 'replace@example.test',
    note: 'append protected note',
  });
  await insertStoredDraft(db, {
    id: 'enrich-3',
    customer_id: 'enrich-partial-customer',
    company_name: 'Enrich Partial Co',
    contact_name: 'Ignored Contact',
    mobile: '13810001003',
    website: 'https://partial.example',
    email: 'partial@enrich.example',
  });

  await insertStoredDraft(db, { id: 'duplicate-phone-1', company_name: 'Duplicate Phone Draft One', mobile: '13890000001' });
  await insertStoredDraft(db, { id: 'duplicate-phone-2', company_name: 'Duplicate Phone Draft Two', mobile: '13890000002' });
  await insertStoredDraft(db, { id: 'duplicate-name-1', company_name: 'Duplicate Name One', mobile: '13890000011' });
  await insertStoredDraft(db, { id: 'duplicate-name-2', company_name: 'Duplicate Name Two', mobile: '13890000012' });
  await insertStoredDraft(db, {
    id: 'missing-customer-enrich',
    customer_id: 'missing-customer',
    company_name: 'Missing Customer Draft',
    mobile: '13890000021',
  }, { skipForeignKeys: true });
  await insertStoredDraft(db, {
    id: 'ignored-create',
    company_name: 'Ignored Create Co',
    mobile: '13890000031',
    sync_status: 'IGNORED',
  });
  await insertStoredDraft(db, {
    id: 'already-synced-create',
    company_name: 'Already Synced Co',
    mobile: '13890000003',
    sync_status: 'SYNCED',
    created_customer_id: 'already-synced-customer',
  });
}

async function insertExistingCustomer(
  db: DatabaseLike,
  input: Pick<Customer, 'id' | 'name'> & Partial<Customer>,
): Promise<void> {
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

async function insertStoredDraft(
  db: DatabaseLike,
  overrides: Partial<CollectedLead> = {},
  options: { skipForeignKeys?: boolean } = {},
): Promise<void> {
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

async function insertStoredWorkItem(
  db: DatabaseLike,
  overrides: Partial<LeadWorkItem> = {},
): Promise<void> {
  await db.execute('PRAGMA foreign_keys = OFF');
  await insertLeadWorkItem(db, makeWorkItem(overrides));
  await db.execute('PRAGMA foreign_keys = ON');
}

function makeWorkItem(overrides: Partial<LeadWorkItem> = {}): LeadWorkItem {
  return {
    id: 'work-1',
    import_row_id: null,
    customer_id: null,
    work_type: 'NEW_CUSTOMER_LOOKUP',
    company_name: 'Work Co',
    city: null,
    industry: null,
    priority: 50,
    lookup_goal: 'FIND_PHONE',
    tanji_search_keyword: null,
    status: 'COLLECTED',
    note: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

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

async function getCustomer(db: DatabaseLike, id: string): Promise<Customer | null> {
  const rows = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', [id]);
  return rows[0] || null;
}

function logFor(logs: SyncLogRow[], collectedLeadId: string): SyncLogRow | undefined {
  return logs.find(log => log.collected_lead_id === collectedLeadId);
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
