CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  customer_grade TEXT DEFAULT 'C',
  stage TEXT DEFAULT 'NEW_LEAD',
  contact_method TEXT,
  wechat_id TEXT,
  phone_number TEXT,
  wechat_search_status TEXT,
  is_key_decision_maker INTEGER DEFAULT 0,
  wechat_add_status TEXT DEFAULT 'NOT_ADDED',
  has_replied INTEGER DEFAULT 0,
  intent_level TEXT DEFAULT 'UNKNOWN',
  phone_feedback TEXT,
  can_schedule_visit INTEGER DEFAULT 0,
  visit_scheduled_at TEXT,
  rough_visit_time_text TEXT,
  parsed_visit_reminder_at TEXT,
  time_parse_status TEXT DEFAULT 'NOT_PARSED',
  time_parse_note TEXT,
  next_follow_up_at TEXT,
  last_contacted_at TEXT,
  last_feedback_type TEXT DEFAULT 'UNKNOWN',
  next_action TEXT,
  no_show_count INTEGER DEFAULT 0,
  lost_reason TEXT,
  payment_status TEXT DEFAULT 'NOT_STARTED',
  deal_amount REAL,
  paid_at TEXT,
  closed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follow_up_records (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  contact_channel TEXT,
  contact_result TEXT,
  feedback_notes TEXT,
  intent_assessment TEXT,
  suggested_grade TEXT,
  next_action TEXT,
  next_follow_up_at TEXT,
  is_completed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS visit_records (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  visited_at TEXT,
  visit_notes TEXT,
  customer_concerns TEXT,
  intent_after_visit TEXT,
  visit_outcome TEXT,
  next_action TEXT,
  expected_contract_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT DEFAULT 'OPEN',
  priority TEXT DEFAULT 'MEDIUM',
  source TEXT DEFAULT 'MANUAL',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
