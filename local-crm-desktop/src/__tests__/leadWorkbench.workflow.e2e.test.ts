import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import {
  ensureLeadWorkbenchSchema,
  getLeadWorkItemById,
  getLeadWorkItemStatusCounts,
  insertLeadWorkItem,
} from '../lib/leadWorkbench/db';
import type { LeadWorkItem } from '../lib/leadWorkbench/types';
import {
  readLeadClipboard,
  saveCollectedLeadWorkflow,
  saveLeadCaptureWorkflow,
  startLeadQueryWorkflow,
} from '../lib/leadWorkbench/workflow';

type DiskDb = DatabaseLike & {
  close(): void;
  path: string;
};

describe('Phase 6M lead workbench workflow', () => {
  it('moves SEARCHING to STAGED after saving a valid capture event', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'capture-work', status: 'SEARCHING', company_name: 'Capture Co' });
      await insertLeadWorkItem(fixture.db, item);

      const result = await saveLeadCaptureWorkflow(fixture.db, {
        workItemId: item.id,
        rawText: '手机 13071897630',
      });

      expect(result.new_status).toBe('STAGED');
      expect((await getLeadWorkItemById(fixture.db, item.id))?.status).toBe('STAGED');
      expect(await fixture.db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(await fixture.db.select('SELECT * FROM collected_leads')).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('returns complete persistence evidence after saving a capture event', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'evidence-work', status: 'SEARCHING', company_name: 'Evidence Co' });
      await insertLeadWorkItem(fixture.db, item);

      const result = await saveLeadCaptureWorkflow(fixture.db, {
        workItemId: item.id,
        rawText: '手机 13071897630 邮箱 sales@example.com',
      });

      expect(result).toMatchObject({
        saved_to: 'lead_capture_events',
        work_item_id: item.id,
        company_name: 'Evidence Co',
        phone: '13071897630',
        email: 'sales@example.com',
        new_status: 'STAGED',
        next_actions: ['保存为采集线索草稿', '继续下一条'],
      });
      expect(result.capture_event_id).toBeTruthy();
    } finally {
      fixture.cleanup();
    }
  });

  it('saves a collected lead linked to capture_event_id and moves STAGED to COLLECTED', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'draft-work', status: 'SEARCHING', company_name: 'Draft Co' });
      await insertLeadWorkItem(fixture.db, item);
      const capture = await saveLeadCaptureWorkflow(fixture.db, {
        workItemId: item.id,
        rawText: '手机 13071897630 邮箱 sales@example.com',
      });

      const result = await saveCollectedLeadWorkflow(fixture.db, {
        workItemId: item.id,
        captureEventId: capture.capture_event_id,
      });
      const rows = await fixture.db.select<Record<string, unknown>>(
        'SELECT * FROM collected_leads WHERE id = ?',
        [result.collected_lead_id],
      );

      expect(result).toMatchObject({
        capture_event_id: capture.capture_event_id,
        saved_to: 'collected_leads',
        new_status: 'COLLECTED',
        existing: false,
      });
      expect(rows[0]).toMatchObject({
        work_item_id: item.id,
        company_name: 'Draft Co',
        mobile: '13071897630',
        email: 'sales@example.com',
        capture_event_id: capture.capture_event_id,
      });
      expect((await getLeadWorkItemById(fixture.db, item.id))?.status).toBe('COLLECTED');
      expect(await fixture.db.select('SELECT * FROM customers')).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('deduplicates repeated collected lead saves for the same work item and mobile', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'dedupe-work', status: 'SEARCHING', company_name: 'Dedupe Co' });
      await insertLeadWorkItem(fixture.db, item);
      const capture = await saveLeadCaptureWorkflow(fixture.db, {
        workItemId: item.id,
        rawText: '手机 13071897630',
      });

      const first = await saveCollectedLeadWorkflow(fixture.db, {
        workItemId: item.id,
        captureEventId: capture.capture_event_id,
      });
      const second = await saveCollectedLeadWorkflow(fixture.db, {
        workItemId: item.id,
        captureEventId: capture.capture_event_id,
      });

      expect(first.existing).toBe(false);
      expect(second).toMatchObject({
        collected_lead_id: first.collected_lead_id,
        existing: true,
      });
      expect(await fixture.db.select('SELECT * FROM collected_leads')).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('copies the search keyword before changing TODO to SEARCHING', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({
        id: 'start-work',
        status: 'TODO',
        tanji_search_keyword: 'Start Co procurement phone',
      });
      await insertLeadWorkItem(fixture.db, item);
      const writeText = vi.fn().mockResolvedValue(undefined);

      const result = await startLeadQueryWorkflow(fixture.db, item.id, { writeText });

      expect(writeText).toHaveBeenCalledWith('Start Co procurement phone');
      expect(result).toMatchObject({
        ok: true,
        message: '已复制搜索词，并将任务标记为查询中',
        new_status: 'SEARCHING',
      });
      expect((await getLeadWorkItemById(fixture.db, item.id))?.status).toBe('SEARCHING');
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps TODO when clipboard copy fails', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'copy-fail-work', status: 'TODO' });
      await insertLeadWorkItem(fixture.db, item);

      const result = await startLeadQueryWorkflow(fixture.db, item.id, {
        writeText: vi.fn().mockRejectedValue(new Error('permission denied')),
      });

      expect(result).toMatchObject({
        ok: false,
        message: '复制失败，请手动复制后重试',
        new_status: 'TODO',
      });
      expect((await getLeadWorkItemById(fixture.db, item.id))?.status).toBe('TODO');
    } finally {
      fixture.cleanup();
    }
  });

  it('reports a database update failure after copying without pretending the status changed', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'db-fail-work', status: 'TODO' });
      await insertLeadWorkItem(fixture.db, item);
      const writeText = vi.fn().mockResolvedValue(undefined);
      const failingDb: DatabaseLike = {
        select: fixture.db.select,
        async execute(sql, bindings) {
          if (sql.startsWith('UPDATE lead_work_items SET status')) {
            throw new Error('disk unavailable');
          }
          return fixture.db.execute(sql, bindings);
        },
      };

      const result = await startLeadQueryWorkflow(failingDb, item.id, { writeText });

      expect(writeText).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        ok: false,
        message: '搜索词已复制，但任务状态更新失败',
        new_status: 'TODO',
      });
      expect((await getLeadWorkItemById(fixture.db, item.id))?.status).toBe('TODO');
    } finally {
      fixture.cleanup();
    }
  });

  it('reads clipboard text and parses it without automatically saving', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'clipboard-work', status: 'SEARCHING' });
      await insertLeadWorkItem(fixture.db, item);

      const result = await readLeadClipboard({
        readText: vi.fn().mockResolvedValue('联系人 王经理 手机 13071897630 邮箱 wang@example.com'),
      });

      expect(result.text).toContain('13071897630');
      expect(result.preview.mobiles).toEqual(['13071897630']);
      expect(result.preview.emails).toEqual(['wang@example.com']);
      expect(await fixture.db.select('SELECT * FROM lead_capture_events')).toHaveLength(0);
      expect(await fixture.db.select('SELECT * FROM collected_leads')).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('reports clipboard read failure without saving or changing the work item', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'clipboard-read-fail', status: 'SEARCHING' });
      await insertLeadWorkItem(fixture.db, item);

      const result = await readLeadClipboard({
        readText: vi.fn().mockRejectedValue(new Error('read denied')),
      });

      expect(result).toMatchObject({
        ok: false,
        text: '',
      });
      expect(result.message).not.toBe('');
      expect((await getLeadWorkItemById(fixture.db, item.id))?.status).toBe('SEARCHING');
      expect(await fixture.db.select('SELECT * FROM lead_capture_events')).toHaveLength(0);
      expect(await fixture.db.select('SELECT * FROM collected_leads')).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('keeps persisted status and counts consistent after closing and reopening the on-disk DB', async () => {
    const fixture = await createDiskFixture();
    try {
      const item = createWorkItem({ id: 'reload-work', status: 'SEARCHING', company_name: 'Reload Co' });
      await insertLeadWorkItem(fixture.db, item);
      const before = await getLeadWorkItemStatusCounts(fixture.db);

      await saveLeadCaptureWorkflow(fixture.db, {
        workItemId: item.id,
        rawText: '手机 13071897630',
      });
      const staged = await getLeadWorkItemStatusCounts(fixture.db);

      const reopened = createDiskDb(fixture.path);
      const afterReload = await getLeadWorkItemStatusCounts(reopened);
      const reloadedItem = await getLeadWorkItemById(reopened, item.id);
      reopened.close();

      expect(staged.SEARCHING).toBe(before.SEARCHING - 1);
      expect(staged.STAGED).toBe(before.STAGED + 1);
      expect(afterReload).toEqual(staged);
      expect(reloadedItem?.status).toBe('STAGED');
    } finally {
      fixture.cleanup();
    }
  });
});

async function createDiskFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'local-crm-6m-'));
  const path = join(directory, 'workflow.db');
  const db = createDiskDb(path);
  await ensureBaseSchema(db);
  await ensureLeadWorkbenchSchema(db);
  let closed = false;

  return {
    db,
    path,
    cleanup(close = true) {
      if (close && !closed) {
        db.close();
        closed = true;
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createDiskDb(path: string): DiskDb {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');

  return {
    path,
    async execute(sql: string, bindings: unknown[] = []) {
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: Number(result.changes) };
    },
    async select<T>(sql: string, bindings: unknown[] = []) {
      return sqlite.prepare(sql).all(bindings as never[]) as T[];
    },
    close() {
      sqlite.close();
    },
  };
}

function createWorkItem(overrides: Partial<LeadWorkItem> = {}): LeadWorkItem {
  return {
    id: 'work-1',
    import_row_id: null,
    customer_id: null,
    work_type: 'NEW_CUSTOMER_LOOKUP',
    company_name: 'Lead Work Co',
    city: 'Foshan',
    industry: 'Lighting',
    priority: 80,
    lookup_goal: 'FIND_PHONE',
    tanji_search_keyword: 'Lead Work Co',
    status: 'TODO',
    note: null,
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}
