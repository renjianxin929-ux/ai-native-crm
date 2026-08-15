import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildFullBackupPayload, restoreBackupPayloadWithDb } from '../lib/backupRestore';
import { createDraftFromCallAnalysis } from '../lib/aiDraft';
import { ensureBaseSchema, ensureCustomerSchema, type DatabaseLike } from '../lib/db';
import { ensureEvidenceSchema } from '../lib/evidence';
import { insertLeadCaptureEvent, listLeadCaptureEventsByWorkItemId } from '../lib/leadWorkbench/captureEvents';
import {
  getCollectedLeadById,
  insertCollectedLeadDraft,
  listCollectedLeadsByWorkItemId,
} from '../lib/leadWorkbench/collectedLeads';
import { executeLeadImportBatchDecisions } from '../lib/leadWorkbench/decision';
import {
  ensureLeadWorkbenchSchema,
  listLeadImportRowsByBatchId,
  listLeadWorkItems,
  listLeadWorkItemsByBatchId,
  listLeadWorkItemsByStatus,
} from '../lib/leadWorkbench/db';
import { importLeadRowsToBatch } from '../lib/leadWorkbench/importer';
import { parseLeadContactText } from '../lib/leadWorkbench/parser';
import { syncCollectedLeadCreateCustomer } from '../lib/leadWorkbench/syncAdapter';
import { updateLeadWorkItemStatus } from '../lib/leadWorkbench/workItemActions';
import { buildTodaySummary } from '../lib/rules';
import type { Customer, FollowUpRecord, Task } from '../lib/types';
import { buildCustomerActionAnalysis, formatCustomerAnalysisTextForDraft } from '../pages/CustomerDetail';
import {
  buildFinalImportPreviewRows,
  getDuplicateMappingErrors,
  normalizeImportPreviewSourceColumns,
} from '../pages/DataImportPage';

type ReleaseGateDb = DatabaseLike & {
  path: string;
  close(): void;
};

const tempDirectories: string[] = [];

afterEach(() => {
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('CRM full release gate with independent on-disk SQLite connections', () => {
  it('initializes all core tables idempotently on a real persisted database', async () => {
    const db = createIndependentConnectionDb();
    try {
      await initializeReleaseGateDb(db);
      await initializeReleaseGateDb(db);

      const tables = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );

      expect(tables.map(row => row.name)).toEqual(expect.arrayContaining([
        'customers',
        'follow_up_records',
        'visit_records',
        'tasks',
        'settings',
        'ai_drafts',
        'lead_import_batches',
        'lead_import_rows',
        'lead_work_items',
        'lead_capture_events',
        'collected_leads',
        'lead_sync_logs',
      ]));
    } finally {
      db.close();
    }
  });

  it('persists and executes three independent 80-row rounds without stale state or duplicate work items', async () => {
    const db = createIndependentConnectionDb();
    try {
      await initializeReleaseGateDb(db);
      const roundResults: Array<{
        batchId: string;
        rowsCount: number;
        workItemsCount: number;
      }> = [];

      for (let round = 1; round <= 3; round += 1) {
        const imported = await importLeadRowsToBatch(
          db,
          {
            batch_name: `release-gate-round-${round}`,
            batch_type: 'AI_DAILY',
            source_label: 'release-gate',
          },
          createSparse80Rows(round),
        );
        const persistedRows = await listLeadImportRowsByBatchId(db, imported.batch.id);
        const decisionCounts = countBy(persistedRows.map(row => row.decision));

        expect(persistedRows).toHaveLength(80);
        expect(decisionCounts).toMatchObject({
          CRM_WITH_LOOKUP: 59,
          LOOKUP_FIRST: 21,
        });

        const firstExecution = await executeLeadImportBatchDecisions(db, imported.batch.id);
        const workItems = await listLeadWorkItemsByBatchId(db, imported.batch.id);
        const secondExecution = await executeLeadImportBatchDecisions(db, imported.batch.id);
        const workItemsAfterRepeat = await listLeadWorkItemsByBatchId(db, imported.batch.id);

        expect(firstExecution).toHaveLength(80);
        expect(firstExecution.every(result => result.status === 'DONE')).toBe(true);
        expect(workItems).toHaveLength(80);
        expect(secondExecution).toHaveLength(80);
        expect(secondExecution.every(result => result.status === 'ALREADY_DONE')).toBe(true);
        expect(workItemsAfterRepeat).toHaveLength(80);

        roundResults.push({
          batchId: imported.batch.id,
          rowsCount: persistedRows.length,
          workItemsCount: workItems.length,
        });
      }

      expect(new Set(roundResults.map(result => result.batchId)).size).toBe(3);
      expect(roundResults).toEqual([
        expect.objectContaining({ rowsCount: 80, workItemsCount: 80 }),
        expect.objectContaining({ rowsCount: 80, workItemsCount: 80 }),
        expect.objectContaining({ rowsCount: 80, workItemsCount: 80 }),
      ]);
      expect(await db.select<{ count: number }>('SELECT COUNT(*) as count FROM lead_import_rows'))
        .toEqual([{ count: 240 }]);
      expect(await db.select<{ count: number }>('SELECT COUNT(*) as count FROM lead_work_items'))
        .toEqual([{ count: 240 }]);
    } finally {
      db.close();
    }
  }, 30_000);

  it('runs the full CRM-to-workbench-to-backup lifecycle without silent data loss', async () => {
    const sourceDb = createIndependentConnectionDb();
    const restoredDb = createIndependentConnectionDb();
    try {
      await initializeReleaseGateDb(sourceDb);
      await initializeReleaseGateDb(restoredDb);

      const customer = createReleaseGateCustomer();
      await insertCustomer(sourceDb, customer);
      await insertFollowUp(sourceDb, customer.id);
      await insertVisit(sourceDb, customer.id);
      await insertTask(sourceDb, customer.id);

      const callDraft = createDraftFromCallAnalysis({
        summary: '客户愿意继续了解',
        phone_feedback: 'CAN_LEARN',
        intent_level: 'MEDIUM',
        grade_suggestion: 'B',
        next_action: '继续跟进',
        next_follow_up_text: '下周',
        risk: '需要确认预算',
        confidence: 0.78,
      }, customer.id);
      await insertAiDraft(sourceDb, 'release-gate-ai-draft', callDraft);

      const storedCustomers = await sourceDb.select<Customer>('SELECT * FROM customers');
      const storedFollowUps = await sourceDb.select<FollowUpRecord>('SELECT * FROM follow_up_records');
      const storedTasks = await sourceDb.select<Task>('SELECT * FROM tasks');
      const todaySummary = buildTodaySummary(storedCustomers, storedTasks);
      expect(storedCustomers).toContainEqual(expect.objectContaining({
        id: customer.id,
        name: 'Release Gate 中文客户 / English Co.',
        phone_number: '13800138000',
        wechat_id: 'release_gate_wx',
        notes: 'release gate notes',
      }));
      expect(storedFollowUps).toHaveLength(1);
      expect(await sourceDb.select('SELECT * FROM visit_records')).toHaveLength(1);
      expect(todaySummary.tasks_due_today).toHaveLength(1);
      expect(await sourceDb.select<{ customer_id: string }>('SELECT customer_id FROM ai_drafts'))
        .toEqual([{ customer_id: customer.id }]);

      const analysisText = formatCustomerAnalysisTextForDraft(
        buildCustomerActionAnalysis(customer, storedFollowUps),
      );
      expect(analysisText).toContain('线索判断');
      expect(analysisText).not.toContain('###');
      expect(analysisText).not.toContain('**');

      const normalizedPreview = normalizeImportPreviewSourceColumns({
        headers: ['客户名称', '', ''],
        rows: [['映射客户', '13900139000', '映射备注']],
        autoMapping: [],
      });
      const mapping = [
        { sourceColumn: '客户名称', crmField: 'name' as const },
        { sourceColumn: '第2列', crmField: 'phone_number' as const },
        { sourceColumn: '第3列', crmField: 'notes' as const },
      ];
      expect(buildFinalImportPreviewRows(
        normalizedPreview.rows,
        normalizedPreview.headers,
        mapping,
      )[0].values).toEqual({
        name: '映射客户',
        phone_number: '13900139000',
        notes: '映射备注',
      });
      expect(getDuplicateMappingErrors([
        mapping[0],
        mapping[1],
        { sourceColumn: '第3列', crmField: 'phone_number' },
      ])).toHaveLength(1);

      const imported = await importLeadRowsToBatch(
        sourceDb,
        { batch_name: 'release-gate-full-flow', batch_type: 'AI_DAILY' },
        [{ company_name: 'Release Gate Lookup Lead', score: 75 }],
      );
      await executeLeadImportBatchDecisions(sourceDb, imported.batch.id);
      const workItem = (await listLeadWorkItemsByBatchId(sourceDb, imported.batch.id))[0];
      expect(workItem.status).toBe('TODO');
      await updateLeadWorkItemStatus(sourceDb, workItem.id, 'SEARCHING');
      expect((await listLeadWorkItemsByStatus(sourceDb, 'SEARCHING')).map(item => item.id))
        .toContain(workItem.id);

      const rawText = [
        '王经理',
        '手机 13877770001',
        '官网 https://release-gate.example.com',
        '邮箱 sales@release-gate.example.com',
      ].join('\n');
      const parsed = parseLeadContactText(rawText);
      const capture = await insertLeadCaptureEvent(sourceDb, {
        work_item_id: workItem.id,
        raw_text: rawText,
        parsed_json: parsed,
        action: 'PARSED',
      });
      const collected = await insertCollectedLeadDraft(sourceDb, {
        work_item_id: workItem.id,
        import_row_id: workItem.import_row_id,
        customer_id: null,
        company_name: workItem.company_name,
        contact_name: parsed.possibleContacts[0] ?? '王经理',
        position: '经理',
        mobile: parsed.mobiles[0] ?? null,
        tel: parsed.tels[0] ?? null,
        website: parsed.urls[0] ?? null,
        email: parsed.emails[0] ?? null,
        raw_text: rawText,
        note: 'release gate collected lead',
      });
      const syncResult = await syncCollectedLeadCreateCustomer(sourceDb, collected.id);
      expect(syncResult.status).toBe('SUCCESS');
      expect((await getCollectedLeadById(sourceDb, collected.id))?.sync_status).toBe('SYNCED');
      expect(await listLeadCaptureEventsByWorkItemId(sourceDb, workItem.id))
        .toContainEqual(expect.objectContaining({ id: capture.id }));
      expect(await listCollectedLeadsByWorkItemId(sourceDb, workItem.id))
        .toContainEqual(expect.objectContaining({ id: collected.id, sync_status: 'SYNCED' }));

      const repeatedExecution = await executeLeadImportBatchDecisions(sourceDb, imported.batch.id);
      expect(repeatedExecution.every(result => result.status === 'ALREADY_DONE')).toBe(true);
      expect(await listLeadWorkItemsByBatchId(sourceDb, imported.batch.id)).toHaveLength(1);

      const backup = await buildFullBackupPayload(sourceDb, {
        version: '0.4.0',
        exportedAt: '2026-06-18T05:00:00.000Z',
      });
      const restoreResult = await restoreBackupPayloadWithDb(restoredDb, backup);

      expect(restoreResult.ok).toBe(true);
      expect(await restoredDb.select('SELECT * FROM customers')).toHaveLength(2);
      expect(await restoredDb.select('SELECT * FROM follow_up_records')).toHaveLength(1);
      expect(await restoredDb.select('SELECT * FROM visit_records')).toHaveLength(1);
      expect(await restoredDb.select('SELECT * FROM ai_drafts')).toHaveLength(1);
      expect(await restoredDb.select('SELECT * FROM lead_import_batches')).toHaveLength(1);
      expect(await restoredDb.select('SELECT * FROM lead_import_rows')).toHaveLength(1);
      expect(await listLeadWorkItems(restoredDb)).toHaveLength(1);
      expect(await restoredDb.select('SELECT * FROM lead_capture_events')).toHaveLength(1);
      expect(await restoredDb.select('SELECT * FROM collected_leads')).toHaveLength(1);
      expect(await restoredDb.select('SELECT * FROM lead_sync_logs')).toHaveLength(1);
    } finally {
      sourceDb.close();
      restoredDb.close();
    }
  }, 30_000);
});

function createIndependentConnectionDb(): ReleaseGateDb {
  const directory = mkdtempSync(join(tmpdir(), 'crm-release-gate-'));
  const path = join(directory, 'release-gate.db');
  tempDirectories.push(directory);

  return {
    path,
    async execute(sql: string, bindings: unknown[] = []) {
      const sqlite = new Database(path);
      try {
        sqlite.pragma('foreign_keys = ON');
        const result = sqlite.prepare(sql).run(bindings as never[]);
        return { rowsAffected: Number(result.changes) };
      } finally {
        sqlite.close();
      }
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      const sqlite = new Database(path, { readonly: true, fileMustExist: true });
      try {
        return sqlite.prepare(sql).all(bindings as never[]) as T[];
      } finally {
        sqlite.close();
      }
    },
    close() {
      // Each operation owns and closes its connection.
    },
  };
}

async function initializeReleaseGateDb(db: DatabaseLike): Promise<void> {
  await ensureBaseSchema(db);
  await ensureCustomerSchema(db);
  await ensureLeadWorkbenchSchema(db);
  await ensureEvidenceSchema(db);
}

function createSparse80Rows(round: number) {
  return [
    ...Array.from({ length: 59 }, (_, index) => ({
      company_name: `Round ${round} CRM Lookup ${index + 1}`,
      score: 85,
    })),
    ...Array.from({ length: 21 }, (_, index) => ({
      company_name: `Round ${round} Lookup First ${index + 1}`,
      score: 75,
    })),
  ];
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function createReleaseGateCustomer(): Customer {
  const now = new Date().toISOString();
  return {
    id: 'release-gate-customer',
    name: 'Release Gate 中文客户 / English Co.',
    customer_grade: 'B',
    stage: 'CONTACTED',
    contact_method: 'WECHAT_AND_PHONE',
    wechat_id: 'release_gate_wx',
    phone_number: '13800138000',
    wechat_search_status: 'FOUND',
    is_key_decision_maker: 1,
    wechat_add_status: 'PASSED',
    has_replied: 1,
    intent_level: 'MEDIUM',
    phone_feedback: 'CAN_LEARN',
    can_schedule_visit: 1,
    visit_scheduled_at: null,
    rough_visit_time_text: null,
    parsed_visit_reminder_at: null,
    time_parse_status: 'NOT_PARSED',
    time_parse_note: null,
    next_follow_up_at: now,
    last_contacted_at: now,
    last_feedback_type: 'POSITIVE',
    next_action: 'CONTACT_AGAIN',
    no_show_count: 0,
    lost_reason: null,
    payment_status: 'NOT_STARTED',
    deal_amount: null,
    paid_at: null,
    closed_at: null,
    website: 'https://customer.example.com',
    region: '广州',
    industry: '包装设备',
    contact_person: '李经理',
    email: 'customer@example.com',
    address: '广州',
    pitch_angle: '效率提升',
    qualification_reason: '有明确联系方式',
    source: 'release-gate',
    notes: 'release gate notes',
    created_at: now,
    updated_at: now,
  };
}

async function insertCustomer(db: DatabaseLike, customer: Customer): Promise<void> {
  const columns = Object.keys(customer);
  await db.execute(
    `INSERT INTO customers (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map(column => customer[column as keyof Customer]),
  );
}

async function insertFollowUp(db: DatabaseLike, customerId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO follow_up_records (
      id, customer_id, title, contact_channel, contact_result, feedback_notes,
      intent_assessment, suggested_grade, next_action, next_follow_up_at,
      is_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'release-gate-follow-up',
      customerId,
      '微信跟进',
      'wechat',
      'positive',
      '客户愿意继续了解',
      'MEDIUM',
      'B',
      '继续跟进',
      now,
      0,
      now,
      now,
    ],
  );
}

async function insertVisit(db: DatabaseLike, customerId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO visit_records (
      id, customer_id, title, visited_at, visit_notes, customer_concerns,
      intent_after_visit, visit_outcome, next_action, expected_contract_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'release-gate-visit',
      customerId,
      '首次面访',
      now,
      '讨论方案',
      '预算',
      'MEDIUM',
      'CONSIDERING',
      '发送方案',
      null,
      now,
      now,
    ],
  );
}

async function insertTask(db: DatabaseLike, customerId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO tasks (
      id, customer_id, title, due_at, status, priority, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['release-gate-task', customerId, '今日跟进', now, 'OPEN', 'HIGH', 'MANUAL', now, now],
  );
}

async function insertAiDraft(
  db: DatabaseLike,
  id: string,
  draft: ReturnType<typeof createDraftFromCallAnalysis>,
): Promise<void> {
  await db.execute(
    `INSERT INTO ai_drafts (
      id, source_type, customer_id, raw_input_summary, ai_result_json,
      status, confidence, created_at, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      draft.source_type,
      draft.customer_id,
      draft.raw_input_summary,
      draft.ai_result_json,
      'DRAFT',
      draft.confidence,
      new Date().toISOString(),
      null,
    ],
  );
}
