import { v4 as uuidv4 } from 'uuid';

import type { DatabaseLike } from '../db';
import { getActiveVerticalProfile, type VerticalRuleProfile } from '../verticalProfiles';
import {
  countLeadImportRowsByBatchId,
  deleteLeadImportBatchById,
  deleteLeadImportRowsByBatchId,
  getLeadImportBatchById,
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

export interface LeadImportProfileOptions {
  profile?: VerticalRuleProfile;
}

export function normalizeLeadImportRows(
  inputRows: LeadImportInputRow[],
  options: LeadImportProfileOptions = {},
): Omit<LeadImportRow, 'batch_id'>[] {
  const profile = options.profile ?? getActiveVerticalProfile();

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
      decision: decideLeadImportRow({ companyName, mobile, tel, score }, profile),
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
  const batch = buildLeadImportBatch(input);
  await insertLeadImportBatch(db, batch);
  return batch;
}

function buildLeadImportBatch(
  input: LeadImportBatchInput & { total_rows: number },
): LeadImportBatch {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    batch_name: input.batch_name,
    batch_type: input.batch_type,
    source_label: input.source_label ?? null,
    total_rows: input.total_rows,
    created_at: now,
    updated_at: now,
  };
}

export async function importLeadRowsToBatch(
  db: DatabaseLike,
  batchInput: LeadImportBatchInput,
  rows: LeadImportInputRow[],
  options: LeadImportProfileOptions = {},
): Promise<ImportedLeadBatch> {
  const normalizedRows = normalizeLeadImportRows(rows, options);
  const batch = buildLeadImportBatch({
    ...batchInput,
    total_rows: normalizedRows.length,
  });
  const rowsWithBatchId = normalizedRows.map(row => ({ ...row, batch_id: batch.id }));
  let observedRowsCount: number | null = null;

  try {
    await insertLeadImportBatch(db, batch);
    await insertLeadImportRows(db, rowsWithBatchId);
    observedRowsCount = await countLeadImportRowsByBatchId(db, batch.id);
    if (observedRowsCount !== normalizedRows.length) {
      throw new Error(
        `数据库行数校验失败：预览 ${normalizedRows.length} 行，实际明细 ${observedRowsCount} 行`,
      );
    }

    const savedRows = await listLeadImportRowsByBatchId(db, batch.id);
    if (savedRows.length !== observedRowsCount) {
      throw new Error(
        `数据库明细读取不一致：COUNT(*)=${observedRowsCount}，实际读取 ${savedRows.length} 行`,
      );
    }

    return {
      batch,
      rows: savedRows,
    };
  } catch (error) {
    const originalError = error instanceof Error ? error.message : String(error);
    if (observedRowsCount === null) {
      try {
        observedRowsCount = await countLeadImportRowsByBatchId(db, batch.id);
      } catch {
        observedRowsCount = 0;
      }
    }

    const cleanupErrors: string[] = [];
    try {
      await deleteLeadImportRowsByBatchId(db, batch.id);
    } catch (cleanupError) {
      cleanupErrors.push(`清理 rows 失败：${formatError(cleanupError)}`);
    }
    try {
      await deleteLeadImportBatchById(db, batch.id);
    } catch (cleanupError) {
      cleanupErrors.push(`清理 batch 失败：${formatError(cleanupError)}`);
    }

    let cleanupSucceeded = cleanupErrors.length === 0;
    if (cleanupSucceeded) {
      try {
        const remainingRows = await countLeadImportRowsByBatchId(db, batch.id);
        const remainingBatch = await getLeadImportBatchById(db, batch.id);
        cleanupSucceeded = remainingRows === 0 && remainingBatch === null;
        if (!cleanupSucceeded) {
          cleanupErrors.push(`清理后仍残留 batch=${remainingBatch ? 1 : 0}、rows=${remainingRows}`);
        }
      } catch (cleanupError) {
        cleanupSucceeded = false;
        cleanupErrors.push(`清理结果校验失败：${formatError(cleanupError)}`);
      }
    }

    const cleanupMessage = cleanupSucceeded
      ? '已清理本次失败残留数据。'
      : `检测到残留损坏批次，禁止执行。清理错误：${cleanupErrors.join('；')}`;
    throw new Error(
      `保存失败：预览 ${normalizedRows.length} 行，但数据库仅保存 ${observedRowsCount} 行。`
      + `已阻止执行，请重新导入或查看错误详情。${cleanupMessage}`
      + ` 原始错误：${originalError}；batch_id=${batch.id}`,
      { cause: error },
    );
  }
}

function decideLeadImportRow(input: {
  companyName: string;
  mobile: string | null;
  tel: string | null;
  score: number | null;
}, profile: VerticalRuleProfile): LeadImportDecision {
  const thresholds = profile.leadImport.scoreThresholds;

  if (!input.companyName) return 'IGNORE';
  if (input.mobile || input.tel) return 'DIRECT_TO_CRM';
  if (input.score !== null && input.score >= thresholds.crmWithLookup) return 'CRM_WITH_LOOKUP';
  if (input.score !== null && input.score >= thresholds.lookupFirst) return 'LOOKUP_FIRST';
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
