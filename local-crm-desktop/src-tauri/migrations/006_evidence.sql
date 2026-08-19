-- Migration 006: First-Class Evidence Foundation (V0.2B / B1)
-- 一等 Evidence 实体：外部/导入信息的有界观察快照。
-- 与 src/lib/evidence/schema.ts 的 ensureEvidenceSchema 保持同一契约。
-- 运行时迁移由前端 ensure* 幂等函数驱动（与 001-005 一致）；本文件为惯例对齐与审计用途。
--
-- 不变量（B1）：
--   EVIDENCE != CRM_FACT / HYPOTHESIS / AUDIT_EVENT / AGENT_MEMORY
--   EVIDENCE_AUTO_PROMOTES_TO_CRM_FACT = false（本表无任何写 customers 的路径）
--   仅 CUSTOMER-linked（customer_id NOT NULL），无 GLOBAL / UNASSIGNED

CREATE TABLE IF NOT EXISTS evidence (
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
);

CREATE INDEX IF NOT EXISTS idx_evidence_customer ON evidence(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_evidence_dedup ON evidence(customer_id, source_type, content_hash);
