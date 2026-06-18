import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import {
  insertLeadImportBatch,
  insertLeadImportRows,
  listLeadImportRowsByBatchId,
} from './db';
import type {
  LeadBatchType,
  LeadImportBatch,
  LeadImportDecision,
  LeadImportRow,
} from './types';

export interface LeadImportBatchInput {
  batch_name: string;
  batch_type: LeadBatchType;
  source_label?: string | null;
}

export interface LeadImportInputRow {
  company_name?: unknown;
  city?: unknown;
  industry?: unknown;
  website?: unknown;
  contact_name?: unknown;
  mobile?: unknown;
  tel?: unknown;
  email?: unknown;
  score?: unknown;
  grade?: unknown;
  tanji_search_keyword?: unknown;
  matching_reason?: unknown;
  priority_contact_role?: unknown;
  source_evidence?: unknown;
  [key: string]: unknown;
}

export interface ImportedLeadBatch {
  batch: LeadImportBatch;
  rows: LeadImportRow[];
}

export function normalizeLeadImportRows(inputRows: LeadImportInputRow[]): Omit<LeadImportRow, 'batch_id'>[] {
  return inputRows.map((inputRow, rowIndex) => {
    const companyName = stringOrNull(inputRow.company_name);
    if (!companyName) {
      throw new Error(`company_name is required for lead import row ${rowIndex}`);
    }

    const mobile = stringOrNull(inputRow.mobile);
    const tel = stringOrNull(inputRow.tel);
    const score = numberOrNull(inputRow.score);
    const now = new Date().toISOString();

    return {
      id: uuidv4(),
      row_index: rowIndex,
      raw_data_json: JSON.stringify(inputRow),
      company_name: companyName,
      city: stringOrNull(inputRow.city),
      industry: stringOrNull(inputRow.industry),
      website: stringOrNull(inputRow.website),
      contact_name: stringOrNull(inputRow.contact_name),
      mobile,
      tel,
      email: stringOrNull(inputRow.email),
      score,
      grade: stringOrNull(inputRow.grade),
      tanji_search_keyword: stringOrNull(inputRow.tanji_search_keyword),
      matching_reason: stringOrNull(inputRow.matching_reason),
      priority_contact_role: stringOrNull(inputRow.priority_contact_role),
      source_evidence: stringOrNull(inputRow.source_evidence),
      decision: decideLeadImportRow({ companyName, mobile, tel, score }),
      decision_status: 'PENDING',
      created_customer_id: null,
      created_work_item_id: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    };
  });
}

export async function createLeadImportBatch(
  db: DatabaseLike,
  input: LeadImportBatchInput & { total_rows: number },
): Promise<LeadImportBatch> {
  const now = new Date().toISOString();
  const batch: LeadImportBatch = {
    id: uuidv4(),
    batch_name: input.batch_name,
    batch_type: input.batch_type,
    source_label: input.source_label ?? null,
    total_rows: input.total_rows,
    created_at: now,
    updated_at: now,
  };

  await insertLeadImportBatch(db, batch);
  return batch;
}

export async function importLeadRowsToBatch(
  db: DatabaseLike,
  batchInput: LeadImportBatchInput,
  rows: LeadImportInputRow[],
): Promise<ImportedLeadBatch> {
  const normalizedRows = normalizeLeadImportRows(rows);
  let batch: LeadImportBatch | null = null;
  let savedRows: LeadImportRow[] = [];

  await db.execute('BEGIN');
  try {
    batch = await createLeadImportBatch(db, {
      ...batchInput,
      total_rows: normalizedRows.length,
    });
    const rowsWithBatchId = normalizedRows.map(row => ({ ...row, batch_id: batch!.id }));

    await insertLeadImportRows(db, rowsWithBatchId);
    savedRows = await listLeadImportRowsByBatchId(db, batch.id);
    if (savedRows.length !== normalizedRows.length) {
      throw new Error(`保存失败：预览 ${normalizedRows.length} 行，但数据库仅保存 ${savedRows.length} 行，请勿执行分流。`);
    }
    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }

  return {
    batch,
    rows: savedRows,
  };
}

function decideLeadImportRow(input: {
  companyName: string;
  mobile: string | null;
  tel: string | null;
  score: number | null;
}): LeadImportDecision {
  if (!input.companyName) return 'IGNORE';
  if (input.mobile || input.tel) return 'DIRECT_TO_CRM';
  if (input.score !== null && input.score >= 80) return 'CRM_WITH_LOOKUP';
  if (input.score !== null && input.score >= 70) return 'LOOKUP_FIRST';
  return 'RESERVE';
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
