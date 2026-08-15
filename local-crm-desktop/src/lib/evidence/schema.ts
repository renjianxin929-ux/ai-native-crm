/**
 * V0.2B / B1 — First-Class Evidence Schema（幂等 ensure）。
 * 与 src-tauri/migrations/006_evidence.sql 保持同一契约；
 * 运行时迁移由 ensureEvidenceSchema 驱动（与现有 ensure* 惯例一致）。
 */

import type { DatabaseLike } from '../db';

export const EVIDENCE_SCHEMA_VERSION = 'evidence-v1';

export const EVIDENCE_TABLE_SQL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    source_type TEXT NOT NULL
      CHECK (source_type IN ('URL', 'IMPORT', 'MANUAL')),
    source_url TEXT,
    source_title TEXT,
    source_ref TEXT,
    captured_at TEXT NOT NULL,
    summary TEXT NOT NULL,
    excerpt TEXT,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE'
      CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'RETIRED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`,
];

export const EVIDENCE_INDEX_SQL: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_evidence_customer ON evidence(customer_id, status)',
  'CREATE INDEX IF NOT EXISTS idx_evidence_dedup ON evidence(customer_id, source_type, content_hash)',
];

export async function ensureEvidenceSchema(db: DatabaseLike): Promise<void> {
  for (const sql of EVIDENCE_TABLE_SQL) {
    await db.execute(sql);
  }
  for (const sql of EVIDENCE_INDEX_SQL) {
    await db.execute(sql);
  }
}
