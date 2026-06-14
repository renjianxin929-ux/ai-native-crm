import type { DatabaseLike } from '../db';
import { LEAD_WORKBENCH_INDEX_SQL, LEAD_WORKBENCH_TABLE_SQL } from './schema';
import type { LeadDecisionStatus, LeadImportBatch, LeadImportRow, LeadWorkItem } from './types';

export async function ensureLeadWorkbenchSchema(db: DatabaseLike): Promise<void> {
  for (const sql of LEAD_WORKBENCH_TABLE_SQL) {
    await db.execute(sql);
  }

  for (const sql of LEAD_WORKBENCH_INDEX_SQL) {
    await db.execute(sql);
  }
}

export async function insertLeadImportBatch(db: DatabaseLike, batch: LeadImportBatch): Promise<void> {
  await db.execute(
    `INSERT INTO lead_import_batches (
      id, batch_name, batch_type, source_label, total_rows, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      batch.id,
      batch.batch_name,
      batch.batch_type,
      batch.source_label,
      batch.total_rows,
      batch.created_at,
      batch.updated_at,
    ],
  );
}

export async function insertLeadImportRows(db: DatabaseLike, rows: LeadImportRow[]): Promise<void> {
  for (const row of rows) {
    await db.execute(
      `INSERT INTO lead_import_rows (
        id, batch_id, row_index, raw_data_json, company_name, city, industry, website,
        contact_name, mobile, tel, email, score, grade, tanji_search_keyword,
        matching_reason, priority_contact_role, source_evidence, decision,
        decision_status, created_customer_id, created_work_item_id, error_message,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.batch_id,
        row.row_index,
        row.raw_data_json,
        row.company_name,
        row.city,
        row.industry,
        row.website,
        row.contact_name,
        row.mobile,
        row.tel,
        row.email,
        row.score,
        row.grade,
        row.tanji_search_keyword,
        row.matching_reason,
        row.priority_contact_role,
        row.source_evidence,
        row.decision,
        row.decision_status,
        row.created_customer_id,
        row.created_work_item_id,
        row.error_message,
        row.created_at,
        row.updated_at,
      ],
    );
  }
}

export async function getLeadImportBatchById(
  db: DatabaseLike,
  id: string,
): Promise<LeadImportBatch | null> {
  const rows = await db.select<LeadImportBatch>(
    'SELECT * FROM lead_import_batches WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

export async function listLeadImportBatches(
  db: DatabaseLike,
  limit = 50,
): Promise<LeadImportBatch[]> {
  return db.select<LeadImportBatch>(
    'SELECT * FROM lead_import_batches ORDER BY created_at DESC, rowid DESC LIMIT ?',
    [limit],
  );
}

export async function listLeadImportRowsByBatchId(
  db: DatabaseLike,
  batchId: string,
): Promise<LeadImportRow[]> {
  return db.select<LeadImportRow>(
    'SELECT * FROM lead_import_rows WHERE batch_id = ? ORDER BY row_index ASC',
    [batchId],
  );
}

export async function getLeadImportRowById(
  db: DatabaseLike,
  id: string,
): Promise<LeadImportRow | null> {
  const rows = await db.select<LeadImportRow>(
    'SELECT * FROM lead_import_rows WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

export async function updateLeadImportRowDecisionStatus(
  db: DatabaseLike,
  id: string,
  decisionStatus: LeadDecisionStatus,
  options: {
    createdWorkItemId?: string | null;
    createdCustomerId?: string | null;
    errorMessage?: string | null;
  } = {},
): Promise<void> {
  const now = new Date().toISOString();

  if ('createdCustomerId' in options && 'createdWorkItemId' in options) {
    await db.execute(
      `UPDATE lead_import_rows
       SET decision_status = ?, created_customer_id = ?, created_work_item_id = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
      [
        decisionStatus,
        options.createdCustomerId ?? null,
        options.createdWorkItemId ?? null,
        options.errorMessage ?? null,
        now,
        id,
      ],
    );
    return;
  }

  if ('createdCustomerId' in options) {
    await db.execute(
      `UPDATE lead_import_rows
       SET decision_status = ?, created_customer_id = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
      [decisionStatus, options.createdCustomerId ?? null, options.errorMessage ?? null, now, id],
    );
    return;
  }

  if ('createdWorkItemId' in options) {
    await db.execute(
      `UPDATE lead_import_rows
       SET decision_status = ?, created_work_item_id = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
      [decisionStatus, options.createdWorkItemId ?? null, options.errorMessage ?? null, now, id],
    );
    return;
  }

  await db.execute(
    `UPDATE lead_import_rows
     SET decision_status = ?, error_message = ?, updated_at = ?
     WHERE id = ?`,
    [decisionStatus, options.errorMessage ?? null, now, id],
  );
}

export async function insertLeadWorkItem(db: DatabaseLike, item: LeadWorkItem): Promise<void> {
  await db.execute(
    `INSERT INTO lead_work_items (
      id, import_row_id, customer_id, work_type, company_name, city, industry, priority,
      lookup_goal, tanji_search_keyword, status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.import_row_id,
      item.customer_id,
      item.work_type,
      item.company_name,
      item.city,
      item.industry,
      item.priority,
      item.lookup_goal,
      item.tanji_search_keyword,
      item.status,
      item.note,
      item.created_at,
      item.updated_at,
    ],
  );
}

export async function getLeadWorkItemById(
  db: DatabaseLike,
  id: string,
): Promise<LeadWorkItem | null> {
  const rows = await db.select<LeadWorkItem>(
    'SELECT * FROM lead_work_items WHERE id = ?',
    [id],
  );
  return rows[0] || null;
}

export async function listLeadWorkItemsByImportRowId(
  db: DatabaseLike,
  importRowId: string,
): Promise<LeadWorkItem[]> {
  return db.select<LeadWorkItem>(
    'SELECT * FROM lead_work_items WHERE import_row_id = ? ORDER BY created_at ASC',
    [importRowId],
  );
}

export async function listLeadWorkItemsByBatchId(
  db: DatabaseLike,
  batchId: string,
): Promise<LeadWorkItem[]> {
  return db.select<LeadWorkItem>(
    `SELECT wi.*
     FROM lead_work_items wi
     INNER JOIN lead_import_rows ir ON wi.import_row_id = ir.id
     WHERE ir.batch_id = ?
     ORDER BY wi.created_at ASC`,
    [batchId],
  );
}
