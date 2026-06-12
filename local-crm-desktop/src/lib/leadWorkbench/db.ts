import type { DatabaseLike } from '../db';
import { LEAD_WORKBENCH_INDEX_SQL, LEAD_WORKBENCH_TABLE_SQL } from './schema';
import type { LeadImportBatch, LeadImportRow } from './types';

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

export async function listLeadImportRowsByBatchId(
  db: DatabaseLike,
  batchId: string,
): Promise<LeadImportRow[]> {
  return db.select<LeadImportRow>(
    'SELECT * FROM lead_import_rows WHERE batch_id = ? ORDER BY row_index ASC',
    [batchId],
  );
}
