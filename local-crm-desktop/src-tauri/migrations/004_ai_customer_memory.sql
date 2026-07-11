-- Stage 8: dedicated trusted customer-memory storage. CRM tables remain unchanged.
CREATE TABLE IF NOT EXISTS ai_memory_entries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('FACT', 'EVENT', 'PREFERENCE', 'INTERACTION_PATTERN', 'HUMAN_CONFIRMED_INSIGHT')),
  content TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('CRM_FACT', 'CRM_INTERACTION', 'AI_REASONING_SUMMARY', 'HUMAN_INPUT')),
  source_reference TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('CANDIDATE', 'VALIDATED', 'ACTIVE', 'ARCHIVED')),
  validation_source TEXT,
  human_verified INTEGER NOT NULL DEFAULT 0 CHECK (human_verified IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_memory_evidence_links (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('CUSTOMER', 'FOLLOW_UP_RECORD', 'VISIT_RECORD', 'TASK')),
  evidence_id TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES ai_memory_entries(id) ON DELETE CASCADE,
  UNIQUE (memory_id, evidence_type, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_memory_entries_customer_status ON ai_memory_entries(customer_id, validation_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_memory_evidence_links_memory ON ai_memory_evidence_links(memory_id);
