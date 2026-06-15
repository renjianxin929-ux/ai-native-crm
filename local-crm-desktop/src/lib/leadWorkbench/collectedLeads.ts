import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import type { CollectedLeadSyncStatus } from './types';

export interface CollectedLead {
  id: string;
  work_item_id: string | null;
  import_row_id: string | null;
  customer_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  position: string | null;
  mobile: string | null;
  tel: string | null;
  website: string | null;
  email: string | null;
  raw_text: string | null;
  note: string | null;
  sync_status: CollectedLeadSyncStatus;
  created_customer_id: string | null;
  updated_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertCollectedLeadDraftInput {
  work_item_id: string;
  import_row_id: string | null;
  customer_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  position: string | null;
  mobile: string | null;
  tel: string | null;
  website: string | null;
  email: string | null;
  raw_text: string;
  note: string | null;
}

export async function insertCollectedLeadDraft(
  db: DatabaseLike,
  input: InsertCollectedLeadDraftInput,
): Promise<CollectedLead> {
  const workItemId = input.work_item_id.trim();
  const companyName = input.company_name?.trim() || '';
  const rawText = input.raw_text.trim();
  const mobile = normalizeOptional(input.mobile);
  const tel = normalizeOptional(input.tel);
  const usefulFields = [
    input.contact_name,
    mobile,
    tel,
    input.website,
    input.email,
    input.note,
  ].map(value => value?.trim() || '');

  if (!workItemId) {
    throw new Error('work_item_id is required');
  }
  if (!companyName) {
    throw new Error('company_name is required');
  }
  if (!rawText) {
    throw new Error('raw_text is required');
  }
  if (usefulFields.every(value => !value)) {
    throw new Error('At least one collected lead field is required');
  }

  if (mobile) {
    const duplicates = await db.select<{ id: string }>(
      'SELECT id FROM collected_leads WHERE work_item_id = ? AND mobile = ? LIMIT 1',
      [workItemId, mobile],
    );
    if (duplicates.length > 0) {
      throw new Error('Duplicate collected lead mobile for this work item');
    }
  } else if (tel) {
    const duplicates = await db.select<{ id: string }>(
      `SELECT id FROM collected_leads
       WHERE work_item_id = ? AND tel = ? AND (mobile IS NULL OR mobile = '')
       LIMIT 1`,
      [workItemId, tel],
    );
    if (duplicates.length > 0) {
      throw new Error('Duplicate collected lead tel for this work item');
    }
  }

  const now = new Date().toISOString();
  const draft: CollectedLead = {
    id: uuidv4(),
    work_item_id: workItemId,
    import_row_id: input.import_row_id,
    customer_id: input.customer_id,
    company_name: companyName,
    contact_name: normalizeOptional(input.contact_name),
    position: normalizeOptional(input.position),
    mobile,
    tel,
    website: normalizeOptional(input.website),
    email: normalizeOptional(input.email),
    raw_text: input.raw_text,
    note: normalizeOptional(input.note),
    sync_status: 'UNSYNCED',
    created_customer_id: null,
    updated_customer_id: null,
    created_at: now,
    updated_at: now,
  };

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

  return draft;
}

export async function listCollectedLeadsByWorkItemId(
  db: DatabaseLike,
  workItemId: string,
): Promise<CollectedLead[]> {
  return db.select<CollectedLead>(
    'SELECT * FROM collected_leads WHERE work_item_id = ? ORDER BY created_at DESC, rowid DESC',
    [workItemId],
  );
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() || '';
  return normalized || null;
}
