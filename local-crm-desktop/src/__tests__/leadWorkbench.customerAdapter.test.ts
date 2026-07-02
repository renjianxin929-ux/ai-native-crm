import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { ensureLeadWorkbenchSchema } from '../lib/leadWorkbench/db';
import {
  buildCustomerInputFromCollectedLead,
  buildCustomerInputFromImportRow,
  findCustomerByPhoneNumber,
  findCustomersByName,
  insertCustomerWithDb,
} from '../lib/leadWorkbench/customerAdapter';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import type { LeadImportRow } from '../lib/leadWorkbench/types';
import { getActiveVerticalProfile, type VerticalRuleProfile } from '../lib/verticalProfiles';

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

function makeImportRow(overrides: Partial<LeadImportRow> = {}): LeadImportRow {
  const now = '2026-06-14T00:00:00.000Z';
  return {
    id: 'row-1',
    batch_id: 'batch-1',
    row_index: 0,
    raw_data_json: JSON.stringify({ source: 'raw-row', extra: 'evidence' }),
    company_name: 'Acme Manufacturing',
    city: 'Foshan',
    industry: 'Equipment',
    website: 'https://acme.example',
    contact_name: 'Alice',
    mobile: '13800138000',
    tel: '0757-88889999',
    email: 'sales@acme.example',
    score: 90,
    grade: 'S',
    tanji_search_keyword: 'Acme',
    matching_reason: 'High fit',
    priority_contact_role: null,
    source_evidence: 'Expo booth card',
    decision: 'DIRECT_TO_CRM',
    decision_status: 'PENDING',
    created_customer_id: null,
    created_work_item_id: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('lead workbench customer adapter', () => {
  it('buildCustomerInputFromImportRow maps stable customer fields from an import row', () => {
    const input = buildCustomerInputFromImportRow(makeImportRow(), {
      batchType: 'EXPO',
      sourceLabel: 'June fair',
    });

    expect(input).toMatchObject({
      name: 'Acme Manufacturing',
      phone_number: '13800138000',
      website: 'https://acme.example',
      region: 'Foshan',
      industry: 'Equipment',
      contact_person: 'Alice',
      email: 'sales@acme.example',
      source: 'EXPO / June fair',
      qualification_reason: 'High fit',
      customer_grade: 'B',
      stage: 'NEW_LEAD',
      contact_method: 'PHONE',
      next_follow_up_at: null,
      wechat_add_status: 'NOT_ADDED',
      intent_level: 'UNKNOWN',
      payment_status: 'NOT_STARTED',
      time_parse_status: 'NOT_PARSED',
      last_feedback_type: 'UNKNOWN',
    });
    expect(input.notes).toContain('Expo booth card');
    expect(input.notes).toContain('"source":"raw-row"');
  });

  it('prefers mobile over tel and falls back to tel when mobile is missing', () => {
    expect(buildCustomerInputFromImportRow(makeImportRow()).phone_number).toBe('13800138000');
    expect(buildCustomerInputFromImportRow(makeImportRow({ mobile: null })).phone_number).toBe('0757-88889999');
  });

  it('maps lead grades conservatively instead of promoting directly to CRM A', () => {
    expect(buildCustomerInputFromImportRow(makeImportRow({ grade: 'S' })).customer_grade).toBe('B');
    expect(buildCustomerInputFromImportRow(makeImportRow({ grade: 'A' })).customer_grade).toBe('C');
    expect(buildCustomerInputFromImportRow(makeImportRow({ grade: 'B' })).customer_grade).toBe('C');
    expect(buildCustomerInputFromImportRow(makeImportRow({ grade: null })).customer_grade).toBe('C');
  });

  it('uses supplied vertical profile customer adapter policy instead of fixed GEO/export defaults', () => {
    const dummyProfile: VerticalRuleProfile = {
      ...getActiveVerticalProfile(),
      key: 'dummy_customer_adapter_profile',
      customerAdapter: {
        ...getActiveVerticalProfile().customerAdapter,
        importRowFallbackName: 'Profile unnamed import',
        collectedLeadFallbackName: 'Profile unnamed collected',
        collectedLeadDefaultSource: 'Profile collected source',
        defaultContactMethod: 'WECHAT',
        gradeMapping: {
          S: 'A',
          A: 'B',
          B: 'D',
          default: 'D',
        },
      },
    };

    const importInput = buildCustomerInputFromImportRow(
      makeImportRow({ company_name: '', grade: 'S' }),
      { profile: dummyProfile },
    );

    expect(importInput).toMatchObject({
      name: 'Profile unnamed import',
      customer_grade: 'A',
      contact_method: 'WECHAT',
    });

    const collectedInput = buildCustomerInputFromCollectedLead(
      {
        id: 'collected-1',
        work_item_id: 'work-1',
        import_row_id: null,
        customer_id: null,
        company_name: null,
        contact_name: null,
        position: null,
        mobile: null,
        tel: null,
        website: null,
        email: null,
        raw_text: null,
        note: null,
        sync_status: 'UNSYNCED',
        created_customer_id: null,
        updated_customer_id: null,
        created_at: '2026-06-14T00:00:00.000Z',
        updated_at: '2026-06-14T00:00:00.000Z',
      },
      { profile: dummyProfile },
    );

    expect(collectedInput).toMatchObject({
      name: 'Profile unnamed collected',
      source: 'Profile collected source',
      contact_method: 'WECHAT',
    });
  });

  it('insertCustomerWithDb creates a customer through the provided db and lookup helpers can find it', async () => {
    const db = await createReadyDb();
    try {
      const customerInput = buildCustomerInputFromImportRow(makeImportRow());
      const customerId = await insertCustomerWithDb(db, customerInput);

      const customers = await db.select<{ id: string; name: string; phone_number: string; customer_grade: string }>(
        'SELECT id, name, phone_number, customer_grade FROM customers',
      );
      expect(customers).toEqual([{
        id: customerId,
        name: 'Acme Manufacturing',
        phone_number: '13800138000',
        customer_grade: 'B',
      }]);

      await insertCustomerWithDb(db, {
        ...customerInput,
        name: 'Acme Manufacturing',
        phone_number: '13900139000',
      });

      expect(await findCustomerByPhoneNumber(db, '13800138000')).toMatchObject({ id: customerId });
      expect(await findCustomerByPhoneNumber(db, null)).toBeNull();
      expect(await findCustomersByName(db, 'Acme Manufacturing')).toHaveLength(2);
      expect(await findCustomersByName(db, '')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('does not modify lead import rows or create lead work items', async () => {
    const db = await createReadyDb();
    try {
      const imported = await importLeadRowsToBatch(
        db,
        { batch_name: 'Adapter side effect check', batch_type: 'MANUAL', source_label: null },
        [{ company_name: 'Side Effect Co', mobile: '13800138000', score: 90 }],
      );

      const beforeRows = await db.select('SELECT * FROM lead_import_rows');
      await insertCustomerWithDb(db, buildCustomerInputFromImportRow(imported.rows[0]));
      const afterRows = await db.select('SELECT * FROM lead_import_rows');
      const workItems = await db.select('SELECT * FROM lead_work_items');

      expect(afterRows).toEqual(beforeRows);
      expect(workItems).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('does not depend on legacy importer, DataImportPage, getDb, or createCustomer', () => {
    const source = readFileSync(new URL('../lib/leadWorkbench/customerAdapter.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('../importer');
    expect(source).not.toContain('DataImportPage');
    expect(source).not.toContain('getDb(');
    expect(source).not.toContain('createCustomer(');
  });
});
