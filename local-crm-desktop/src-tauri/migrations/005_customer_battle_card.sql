-- Migration 005: Customer Battle Card Backend V1
-- 与 src/lib/battleCard/schema.ts 的 ensureBattleCardSchema 保持同一契约。
-- 运行时迁移由前端 ensure* 幂等函数驱动（与 001-004 一致）；本文件为惯例对齐与审计用途。

CREATE TABLE IF NOT EXISTS intelligence_imports (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  source_system TEXT NOT NULL,
  source_label TEXT,
  raw_content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (parse_status IN ('PENDING', 'DRAFTED', 'CONFIRMED', 'CANCELLED')),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS reviewed_facts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  source_import_id TEXT NOT NULL,
  fact_category TEXT NOT NULL,
  statement TEXT NOT NULL,
  normalized_value_json TEXT,
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING', 'VERIFIED', 'CONFLICTED', 'SUPERSEDED')),
  confidence REAL NOT NULL DEFAULT 0.5
    CHECK (confidence >= 0 AND confidence <= 1),
  applicability TEXT NOT NULL DEFAULT 'GLOBAL'
    CHECK (applicability IN ('GLOBAL', 'PARTIAL', 'CONDITIONAL', 'UNSUPPORTED')),
  observed_at TEXT,
  valid_until TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (source_import_id) REFERENCES intelligence_imports(id)
);

CREATE TABLE IF NOT EXISTS customer_hypotheses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  source_import_id TEXT,
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'REJECTED', 'EXPIRED')),
  applicability TEXT NOT NULL DEFAULT 'CONDITIONAL'
    CHECK (applicability IN ('GLOBAL', 'PARTIAL', 'CONDITIONAL', 'UNSUPPORTED')),
  why_it_matters TEXT,
  validation_question TEXT,
  disconfirm_condition TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  status_audit_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (source_import_id) REFERENCES intelligence_imports(id)
);

CREATE TABLE IF NOT EXISTS customer_stage_cards (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  stage_code TEXT NOT NULL,
  version INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  card_status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (card_status IN ('DRAFT', 'CONFIRMED')),
  source_import_id TEXT,
  supersedes_card_id TEXT,
  payload_json TEXT NOT NULL,
  evidence_snapshot_hash TEXT NOT NULL,
  generated_by TEXT NOT NULL
    CHECK (generated_by IN ('DETERMINISTIC', 'MODEL_ENHANCED', 'MANUAL')),
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (supersedes_card_id) REFERENCES customer_stage_cards(id),
  UNIQUE (customer_id, stage_code, version)
);

CREATE INDEX IF NOT EXISTS idx_intelligence_imports_customer ON intelligence_imports(customer_id);
CREATE INDEX IF NOT EXISTS idx_intelligence_imports_dedup ON intelligence_imports(customer_id, source_system, content_hash);
CREATE INDEX IF NOT EXISTS idx_reviewed_facts_customer ON reviewed_facts(customer_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_customer_hypotheses_customer ON customer_hypotheses(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_stage_cards_customer ON customer_stage_cards(customer_id, stage_code, version DESC);

-- customers 主表指针字段由 001 的新库基线一次性创建。
-- 旧库由运行时 ensureBattleCardCustomerPointers 先 PRAGMA table_info 再逐列补齐；
-- 此处绝不执行无条件 ALTER TABLE，以免第二次启动或并发初始化重复添加列。
