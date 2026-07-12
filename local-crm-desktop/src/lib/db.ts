import type { Customer, FollowUpRecord, VisitRecord, Task, AIDraft, AIDraftInput } from './types';
import { ensureLeadWorkbenchSchema } from './leadWorkbench/db';
import { ensureCustomerMemorySchema } from './customerMemory/migration';
import { v4 as uuidv4 } from 'uuid';

// 数据库抽象层 - 包装 @tauri-apps/plugin-sql
// 生产环境下必须使用真实 SQLite，不允许静默回退到内存存储

export interface DatabaseLike {
  execute(sql: string, bindings?: unknown[]): Promise<{ rowsAffected: number }>;
  select<T>(sql: string, bindings?: unknown[]): Promise<T[]>;
}

let dbInstance: DatabaseLike | null = null;
let dbInitError: string | null = null;

async function getDb(): Promise<DatabaseLike> {
  if (dbInstance) return dbInstance;

  try {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    const loadedDb = await Database.load('sqlite:personal-crm.db');
    await initializeDatabaseSchema(loadedDb);
    dbInstance = loadedDb;
    return loadedDb;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);

    // 仅测试环境允许显式启用内存 DB
    if (import.meta.env.VITE_ALLOW_MEMORY_DB === 'true') {
      console.warn('Tauri SQL 不可用，测试环境使用内存存储');
      dbInstance = createMemoryDb();
      return dbInstance;
    }

    dbInitError = `数据库初始化失败: ${errMsg}`;
    throw new Error(dbInitError, { cause: e });
  }
}

export async function initializeDatabaseSchema(db: DatabaseLike): Promise<void> {
  await ensureBaseSchema(db);
  await ensureCustomerSchema(db);
  await ensureLeadWorkbenchSchema(db);
  await ensureCustomerMemorySchema(db);
}

const BASE_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS customers (
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
    website TEXT,
    region TEXT,
    industry TEXT,
    contact_person TEXT,
    email TEXT,
    address TEXT,
    pitch_angle TEXT,
    qualification_reason TEXT,
    source TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS follow_up_records (
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
  )`,
  `CREATE TABLE IF NOT EXISTS visit_records (
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
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
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
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_drafts (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL DEFAULT 'MANUAL',
    customer_id TEXT,
    raw_input_summary TEXT NOT NULL DEFAULT '',
    ai_result_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    confidence REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    applied_at TEXT
  )`,
];

export async function ensureBaseSchema(db: DatabaseLike): Promise<void> {
  for (const sql of BASE_SCHEMA_SQL) {
    await db.execute(sql);
  }
}

export async function ensureCustomerSchema(db: DatabaseLike): Promise<void> {
  const columns = await db.select<{ name?: string }>('PRAGMA table_info(customers)');
  const hasPhoneNumber = columns.some((column) => column.name === 'phone_number');

  if (!hasPhoneNumber) {
    await db.execute('ALTER TABLE customers ADD COLUMN phone_number TEXT');
  }

  const newColumns = ['website', 'region', 'industry', 'contact_person', 'email',
    'address', 'pitch_angle', 'qualification_reason', 'source'];
  for (const col of newColumns) {
    if (!columns.some(c => c.name === col)) {
      await db.execute(`ALTER TABLE customers ADD COLUMN ${col} TEXT`);
    }
  }
}

export function getDbError(): string | null {
  return dbInitError;
}

export async function getDbPath(): Promise<string> {
  try {
    await import('@tauri-apps/plugin-sql');
    // Tauri SQL plugin 中 sqlite:xxx 对应 app data 目录
    // 尝试获取实际路径
    const { appDataDir } = await import('@tauri-apps/api/path');
    const dir = await appDataDir();
    return `${dir}personal-crm.db`;
  } catch {
    // 回退：Tauri app data 下
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      const dir = await appDataDir();
      return `${dir}personal-crm.db`;
    } catch {
      return '%APPDATA%/com.localcrm.desktop/personal-crm.db';
    }
  }
}

function createMemoryDb(): DatabaseLike {
  const store: Record<string, Record<string, unknown>[]> = {
    customers: [],
    follow_up_records: [],
    visit_records: [],
    tasks: [],
    settings: [],
    ai_drafts: [],
    schema_migrations: [],
  };

  return {
    async execute(sql: string, bindings: unknown[] = []) {
      const trimmed = sql.trim().toLowerCase();
      if (trimmed.startsWith('insert')) {
        const table = extractTable(sql);
        if (table && store[table]) {
          store[table].push(buildRow(table, bindings));
        }
      } else if (trimmed.startsWith('update')) {
        const table = extractTable(sql);
        if (table && store[table]) {
          const idx = store[table].findIndex((r: Record<string, unknown>) =>
            bindings.length > 0 && r.id === bindings[bindings.length - 1]
          );
          if (idx >= 0) {
            const row = { ...store[table][idx] };
            // 从原始 SQL 解析 SET 子句列名（修复 memory DB UPDATE part字段）
            const setMatch = sql.match(/SET\s+([\s\S]*?)\s+WHERE\s/i);
            if (setMatch) {
              const setCols = setMatch[1].split(',').map(s => s.trim().split(/\s+/)[0]);
              setCols.forEach((col, i) => {
                if (col && i < bindings.length - 1) {
                  row[col] = bindings[i];
                }
              });
            }
            store[table][idx] = row;
          }
        }
      } else if (trimmed.startsWith('delete')) {
        const table = extractTable(sql);
        if (table && store[table] && bindings.length > 0) {
          store[table] = store[table].filter((r: Record<string, unknown>) => r.id !== bindings[0]);
        }
      }
      return { rowsAffected: 1 };
    },
    async select<T>(sql: string, bindings: unknown[] = []): Promise<T[]> {
      const trimmed = sql.trim().toLowerCase();
      const table = extractTable(trimmed);
      if (table && store[table]) {
        let rows = [...store[table]] as unknown[];
        if (bindings.length > 0 && trimmed.includes('where') && trimmed.includes('customer_id')) {
          rows = rows.filter((r: unknown) =>
            (r as Record<string, unknown>).customer_id === bindings[0]
          );
        }
        // WHERE id = ?
        if (bindings.length > 0 && trimmed.includes('where') && trimmed.includes('id')) {
          rows = rows.filter((r: unknown) =>
            (r as Record<string, unknown>).id === bindings[0]
          );
        }
        return rows as T[];
      }
      return [];
    },
  };
}

function extractTable(sql: string): string {
  const lowered = sql.toLowerCase();
  const match = lowered.match(/(?:from|into|update)\s+(\w+)/);
  return match ? match[1] : '';
}

function buildRow(table: string, bindings: unknown[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const cols = getColumnsForTable(table);
  cols.forEach((col, i) => {
    if (i < bindings.length) row[col] = bindings[i];
  });
  return row;
}

function getColumnsForTable(table: string): string[] {
  switch (table) {
    case 'customers':
      return ['id', 'name', 'customer_grade', 'stage', 'contact_method', 'wechat_id',
        'phone_number', 'wechat_search_status', 'is_key_decision_maker', 'wechat_add_status', 'has_replied',
        'intent_level', 'phone_feedback', 'can_schedule_visit', 'visit_scheduled_at',
        'rough_visit_time_text', 'parsed_visit_reminder_at', 'time_parse_status',
        'time_parse_note', 'next_follow_up_at', 'last_contacted_at', 'last_feedback_type',
        'next_action', 'no_show_count', 'lost_reason', 'payment_status', 'deal_amount',
        'paid_at', 'closed_at',
        'website', 'region', 'industry',
        'contact_person', 'email', 'address', 'pitch_angle', 'qualification_reason', 'source',
        'notes', 'created_at', 'updated_at'];
    case 'follow_up_records':
      return ['id', 'customer_id', 'title', 'contact_channel', 'contact_result',
        'feedback_notes', 'intent_assessment', 'suggested_grade', 'next_action',
        'next_follow_up_at', 'is_completed', 'created_at', 'updated_at'];
    case 'visit_records':
      return ['id', 'customer_id', 'title', 'visited_at', 'visit_notes',
        'customer_concerns', 'intent_after_visit', 'visit_outcome', 'next_action',
        'expected_contract_at', 'created_at', 'updated_at'];
    case 'tasks':
      return ['id', 'customer_id', 'title', 'due_at', 'status', 'priority', 'source',
        'created_at', 'updated_at'];
    case 'ai_drafts':
      return ['id', 'source_type', 'customer_id', 'raw_input_summary',
        'ai_result_json', 'status', 'confidence', 'created_at', 'applied_at'];
    default: return [];
  }
}

// ── CRUD API ──

export async function createCustomer(
  id: string,
  name: string,
  contactMethod: string | null,
  wechatId: string | null,
  phoneNumber: string | null,
  wechatSearchStatus: string | null,
  isKeyDm: number,
  grade: string,
  wechatAddStatus: string,
  intentLevel: string,
  phoneFeedback: string | null,
  roughVisitTime: string | null,
  parsedReminder: string | null,
  parseStatus: string,
  parseNote: string | null,
  nextFollowUpAt: string | null,
  notes: string | null,
  website: string | null,
  region: string | null,
  industry: string | null,
  contactPerson: string | null,
  email: string | null,
  address: string | null,
  pitchAngle: string | null,
  qualificationReason: string | null,
  source: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const db = await getDb();
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, contact_method, wechat_id,
     phone_number, wechat_search_status, is_key_decision_maker, wechat_add_status, has_replied,
     intent_level, phone_feedback, can_schedule_visit, visit_scheduled_at,
     rough_visit_time_text, parsed_visit_reminder_at, time_parse_status,
     time_parse_note, next_follow_up_at, last_contacted_at, last_feedback_type,
     next_action, no_show_count, lost_reason, payment_status, deal_amount,
     paid_at, closed_at, website, region, industry,
     contact_person, email, address, pitch_angle, qualification_reason, source,
     notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, grade, 'NEW_LEAD', contactMethod, wechatId, phoneNumber, wechatSearchStatus,
     isKeyDm, wechatAddStatus, 0, intentLevel, phoneFeedback, 0, null,
     roughVisitTime, parsedReminder, parseStatus,
     parseNote, nextFollowUpAt, null, 'UNKNOWN',
     null, 0, null, 'NOT_STARTED', null,
     null, null, website, region, industry,
     contactPerson, email, address, pitchAngle, qualificationReason, source,
     notes, now, now],
  );
}

export async function listCustomers(): Promise<Customer[]> {
  const db = await getDb();
  return db.select<Customer>('SELECT * FROM customers ORDER BY updated_at DESC');
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const db = await getDb();
  const rows = await db.select<Customer>('SELECT * FROM customers WHERE id = ?', [id]);
  return rows[0] || null;
}

const CUSTOMER_UPDATE_FIELDS = new Set([
  'name',
  'customer_grade',
  'stage',
  'contact_method',
  'wechat_id',
  'phone_number',
  'wechat_search_status',
  'is_key_decision_maker',
  'wechat_add_status',
  'has_replied',
  'intent_level',
  'phone_feedback',
  'can_schedule_visit',
  'visit_scheduled_at',
  'rough_visit_time_text',
  'parsed_visit_reminder_at',
  'time_parse_status',
  'time_parse_note',
  'next_follow_up_at',
  'last_contacted_at',
  'last_feedback_type',
  'next_action',
  'no_show_count',
  'lost_reason',
  'payment_status',
  'deal_amount',
  'paid_at',
  'closed_at',
  'website',
  'region',
  'industry',
  'contact_person',
  'email',
  'address',
  'pitch_angle',
  'qualification_reason',
  'source',
  'notes',
  'created_at',
  'updated_at',
]);

export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<void> {
  await createCrmRepository(await getDb()).updateCustomer(id, updates);
}

export async function deleteCustomer(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM follow_up_records WHERE customer_id = ?', [id]);
  await db.execute('DELETE FROM visit_records WHERE customer_id = ?', [id]);
  await db.execute('DELETE FROM tasks WHERE customer_id = ?', [id]);
  await db.execute('DELETE FROM customers WHERE id = ?', [id]);
}

export async function createFollowUp(record: FollowUpRecord): Promise<void> {
  await createCrmRepository(await getDb()).createFollowUp(record);
}

/** Shared production repository policy. Test transports must use this adapter rather than reimplement its mapping. */
export function createCrmRepository(db: DatabaseLike, now: () => string = () => new Date().toISOString()) {
  return {
    async updateCustomer(id: string, updates: Partial<Customer> | Record<string, unknown>): Promise<void> {
      const requestedFields = Object.keys(updates).filter(k => k !== 'id');
      const fields = requestedFields.filter(k => CUSTOMER_UPDATE_FIELDS.has(k));
      const unknownFields = requestedFields.filter(k => !CUSTOMER_UPDATE_FIELDS.has(k));
      if (unknownFields.length > 0) console.warn('updateCustomer ignored unknown customer fields', unknownFields);
      if (fields.length === 0) return;
      const sets = fields.map(f => `${f} = ?`).join(', ');
      const values = fields.map(f => (updates as Record<string, unknown>)[f]);
      await db.execute(`UPDATE customers SET ${sets}, updated_at = ? WHERE id = ?`, [...values, now(), id]);
    },
    async createFollowUp(record: FollowUpRecord): Promise<void> {
      await db.execute(
    `INSERT INTO follow_up_records (id, customer_id, title, contact_channel, contact_result,
     feedback_notes, intent_assessment, suggested_grade, next_action,
     next_follow_up_at, is_completed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.customer_id, record.title, record.contact_channel, record.contact_result,
     record.feedback_notes, record.intent_assessment, record.suggested_grade, record.next_action,
     record.next_follow_up_at, record.is_completed, record.created_at, record.updated_at],
      );
    },
    async createTask(task: Task): Promise<void> {
      await db.execute(
        `INSERT INTO tasks (id, customer_id, title, due_at, status, priority, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [task.id, task.customer_id, task.title, task.due_at, task.status, task.priority, task.source,
         task.created_at, task.updated_at],
      );
    },
  };
}

export async function listFollowUps(customerId: string): Promise<FollowUpRecord[]> {
  const db = await getDb();
  return db.select<FollowUpRecord>(
    'SELECT * FROM follow_up_records WHERE customer_id = ? ORDER BY created_at DESC',
    [customerId],
  );
}

export async function listAllFollowUps(): Promise<FollowUpRecord[]> {
  const db = await getDb();
  return db.select<FollowUpRecord>('SELECT * FROM follow_up_records ORDER BY created_at DESC');
}

export async function createVisit(record: VisitRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO visit_records (id, customer_id, title, visited_at, visit_notes,
     customer_concerns, intent_after_visit, visit_outcome, next_action,
     expected_contract_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.customer_id, record.title, record.visited_at, record.visit_notes,
     record.customer_concerns, record.intent_after_visit, record.visit_outcome, record.next_action,
     record.expected_contract_at, record.created_at, record.updated_at],
  );
}

export async function listVisits(customerId: string): Promise<VisitRecord[]> {
  const db = await getDb();
  return db.select<VisitRecord>(
    'SELECT * FROM visit_records WHERE customer_id = ? ORDER BY created_at DESC',
    [customerId],
  );
}

export async function listAllVisits(): Promise<VisitRecord[]> {
  const db = await getDb();
  return db.select<VisitRecord>('SELECT * FROM visit_records ORDER BY created_at DESC');
}

export async function createTask(task: Task): Promise<void> {
  await createCrmRepository(await getDb()).createTask(task);
}

export async function listTasks(): Promise<Task[]> {
  const db = await getDb();
  return db.select<Task>('SELECT * FROM tasks ORDER BY due_at ASC');
}

// ── v0.4.0 AI Drafts CRUD ──

export async function createAIDraft(input: AIDraftInput): Promise<AIDraft> {
  const now = new Date().toISOString();
  const draft: AIDraft = {
    id: uuidv4(),
    source_type: input.source_type,
    customer_id: input.customer_id,
    raw_input_summary: input.raw_input_summary,
    ai_result_json: input.ai_result_json,
    status: 'DRAFT',
    confidence: input.confidence,
    created_at: now,
    applied_at: null,
  };
  const db = await getDb();
  await db.execute(
    `INSERT INTO ai_drafts (id, source_type, customer_id, raw_input_summary,
     ai_result_json, status, confidence, created_at, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [draft.id, draft.source_type, draft.customer_id, draft.raw_input_summary,
     draft.ai_result_json, draft.status, draft.confidence, draft.created_at, draft.applied_at],
  );
  return draft;
}

export async function listAIDrafts(customerId?: string): Promise<AIDraft[]> {
  const db = await getDb();
  if (customerId) {
    return db.select<AIDraft>(
      'SELECT * FROM ai_drafts WHERE customer_id = ? ORDER BY created_at DESC',
      [customerId],
    );
  }
  return db.select<AIDraft>('SELECT * FROM ai_drafts ORDER BY created_at DESC');
}

export async function getAIDraft(id: string): Promise<AIDraft | null> {
  const db = await getDb();
  const rows = await db.select<AIDraft>('SELECT * FROM ai_drafts WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function discardAIDraft(id: string): Promise<void> {
  const draft = await getAIDraft(id);
  if (!draft) throw new Error(`草稿 ${id} 不存在`);
  if (draft.status !== 'DRAFT') {
    throw new Error(`草稿状态为 ${draft.status}，无法丢弃`);
  }
  const db = await getDb();
  await db.execute(
    `UPDATE ai_drafts SET status = ? WHERE id = ?`,
    ['DISCARDED', id],
  );
}

export async function applyAIDraftToCustomer(id: string): Promise<{
  customer: Customer;
  followUpRecord?: FollowUpRecord;
}> {
  const draft = await getAIDraft(id);
  if (!draft) throw new Error(`草稿 ${id} 不存在`);
  if (draft.status !== 'DRAFT') {
    throw new Error(`草稿状态为 ${draft.status}，无法应用`);
  }

  const aiResult = JSON.parse(draft.ai_result_json);
  const now = new Date().toISOString();

  // MANUAL / deepseek_next_action → 跟进建议草稿，不修改客户字段
  if (draft.source_type === 'MANUAL' || aiResult.source === 'deepseek_next_action') {
    if (!draft.customer_id) {
      throw new Error('跟进建议草稿必须关联客户后才能应用');
    }

    const followUp: FollowUpRecord = {
      id: uuidv4(),
      customer_id: draft.customer_id,
      title: 'AI 跟进建议',
      contact_channel: null,
      contact_result: null,
      feedback_notes: aiResult.suggestion || aiResult.rawResponse || '',
      intent_assessment: null,
      suggested_grade: null,
      next_action: null,
      next_follow_up_at: null,
      is_completed: 0,
      created_at: now,
      updated_at: now,
    };
    await createFollowUp(followUp);

    const db = await getDb();
    await db.execute(
      `UPDATE ai_drafts SET status = ?, applied_at = ? WHERE id = ?`,
      ['APPLIED', now, id],
    );

    const customer = await getCustomer(draft.customer_id);
    return { customer: customer!, followUpRecord: followUp };
  }

  if (draft.source_type === 'SCREENSHOT') {
    // 截图识别 → 创建新客户（如果无关联）或更新现有客户
    const customerName = aiResult.customer_name || '未命名客户';
    const customerId = draft.customer_id || uuidv4();

    if (draft.customer_id) {
      // 更新现有客户
      const updates: Partial<Customer> = {
        intent_level: aiResult.intent_level || 'UNKNOWN',
        updated_at: now,
      };
      if (aiResult.wechat_id) updates.wechat_id = aiResult.wechat_id;
      if (aiResult.phone_number) updates.phone_number = aiResult.phone_number;
      if (aiResult.next_follow_up_text) {
        updates.rough_visit_time_text = aiResult.next_follow_up_text;
      }
      if (aiResult.summary) updates.notes = (aiResult.summary || '');

      // AI 只能建议，不自动升 A
      if (aiResult.grade_suggestion && aiResult.grade_suggestion !== 'A' && aiResult.grade_suggestion !== 'UNKNOWN') {
        updates.customer_grade = aiResult.grade_suggestion;
      }

      await updateCustomer(draft.customer_id, updates);
    } else {
      // 创建新客户
      await createCustomer(
        customerId,
        customerName,
        'WECHAT',
        aiResult.wechat_id || null,
        aiResult.phone_number || null,
        null, // wechatSearchStatus
        0, // isKeyDm
        aiResult.grade_suggestion && aiResult.grade_suggestion !== 'A' && aiResult.grade_suggestion !== 'UNKNOWN'
          ? aiResult.grade_suggestion : 'C',
        'NOT_ADDED',
        aiResult.intent_level || 'UNKNOWN',
        null,
        aiResult.next_follow_up_text || null,
        null, 'NOT_PARSED', null, null,
        aiResult.summary || null,
        null, null, null, null, null, null, null, null, null,
      );
    }

    // 创建跟进记录
    const followUpId = uuidv4();
    const followUp: FollowUpRecord = {
      id: followUpId,
      customer_id: customerId,
      title: `AI 截图识别 - ${customerName}`,
      contact_channel: 'wechat',
      contact_result: aiResult.follow_up_result?.toLowerCase() || null,
      feedback_notes: aiResult.evidence || aiResult.summary || null,
      intent_assessment: aiResult.intent_level || null,
      suggested_grade: aiResult.grade_suggestion || null,
      next_action: aiResult.next_action || null,
      next_follow_up_at: null,
      is_completed: 0,
      created_at: now,
      updated_at: now,
    };
    await createFollowUp(followUp);

    // 标记已应用
    const db = await getDb();
    await db.execute(
      `UPDATE ai_drafts SET status = ?, applied_at = ? WHERE id = ?`,
      ['APPLIED', now, id],
    );

    const customer = await getCustomer(customerId);
    return { customer: customer!, followUpRecord: followUp };
  }

  // CALL_TEXT / 其他 → 更新或创建
  const customerIdForDraft = draft.customer_id || uuidv4();

  if (draft.customer_id) {
    const updates: Partial<Customer> = {
      phone_feedback: aiResult.phone_feedback || null,
      intent_level: aiResult.intent_level || 'UNKNOWN',
      updated_at: now,
    };
    if (aiResult.grade_suggestion && aiResult.grade_suggestion !== 'A' && aiResult.grade_suggestion !== 'UNKNOWN') {
      updates.customer_grade = aiResult.grade_suggestion;
    }
    if (aiResult.next_follow_up_text) {
      updates.rough_visit_time_text = aiResult.next_follow_up_text;
    }
    if (aiResult.summary) updates.notes = (aiResult.summary || '');
    await updateCustomer(draft.customer_id, updates);
  } else {
    const name = `AI 通话分析 - ${new Date().toLocaleDateString('zh-CN')}`;
    await createCustomer(
      customerIdForDraft, name, 'PHONE', null, null, null, 0,
      aiResult.grade_suggestion && aiResult.grade_suggestion !== 'A' && aiResult.grade_suggestion !== 'UNKNOWN'
        ? aiResult.grade_suggestion : 'C',
      'NOT_ADDED',
      aiResult.intent_level || 'UNKNOWN',
      aiResult.phone_feedback || null,
      aiResult.next_follow_up_text || null,
      null, 'NOT_PARSED', null, null,
      aiResult.summary || null,
      null, null, null, null, null, null, null, null, null,
    );
  }

  const followUp: FollowUpRecord = {
    id: uuidv4(),
    customer_id: customerIdForDraft,
    title: 'AI 通话文本分析',
    contact_channel: 'phone',
    contact_result: aiResult.phone_feedback === 'CAN_MEET' || aiResult.phone_feedback === 'INTERESTED'
      ? 'positive' : null,
    feedback_notes: aiResult.summary || null,
    intent_assessment: aiResult.intent_level || null,
    suggested_grade: aiResult.grade_suggestion || null,
    next_action: aiResult.next_action || null,
    next_follow_up_at: null,
    is_completed: 0,
    created_at: now,
    updated_at: now,
  };
  await createFollowUp(followUp);

  const db = await getDb();
  await db.execute(
    `UPDATE ai_drafts SET status = ?, applied_at = ? WHERE id = ?`,
    ['APPLIED', now, id],
  );

  const customer = await getCustomer(customerIdForDraft);
  return { customer: customer!, followUpRecord: followUp };
}

export { getDb };
