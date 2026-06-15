import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { ensureBaseSchema, type DatabaseLike } from '../lib/db';
import { insertLeadCaptureEvent, listLeadCaptureEventsByWorkItemId } from '../lib/leadWorkbench/captureEvents';
import { ensureLeadWorkbenchSchema, insertLeadWorkItem } from '../lib/leadWorkbench/db';
import type { LeadWorkItem, LeadWorkStatus } from '../lib/leadWorkbench/types';

function createSqliteDb(): DatabaseLike & { close(): void } {
  const sqlite = new Database(':memory:');

  return {
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

async function createReadyDb() {
  const db = createSqliteDb();
  await ensureBaseSchema(db);
  await ensureLeadWorkbenchSchema(db);
  return db;
}

describe('lead workbench capture events', () => {
  it('inserts a parsed capture event into lead_capture_events', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-1' }));

      const event = await insertLeadCaptureEvent(db, {
        work_item_id: 'work-1',
        raw_text: '手机 13800138000',
        parsed_json: { mobiles: ['13800138000'] },
        confidence_json: {},
        action: 'PARSED',
      });
      const events = await listLeadCaptureEventsByWorkItemId(db, 'work-1');

      expect(event).toMatchObject({
        work_item_id: 'work-1',
        raw_text: '手机 13800138000',
        action: 'PARSED',
      });
      expect(JSON.parse(event.parsed_json)).toEqual({ mobiles: ['13800138000'] });
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);
    } finally {
      db.close();
    }
  });

  it('rejects empty raw_text and empty work_item_id', async () => {
    const db = await createReadyDb();
    try {
      await expect(insertLeadCaptureEvent(db, {
        work_item_id: '',
        raw_text: '手机 13800138000',
        parsed_json: {},
        action: 'PARSED',
      })).rejects.toThrow('work_item_id is required');

      await expect(insertLeadCaptureEvent(db, {
        work_item_id: 'work-1',
        raw_text: '   ',
        parsed_json: {},
        action: 'PARSED',
      })).rejects.toThrow('raw_text is required');
    } finally {
      db.close();
    }
  });

  it('requires parsed_json to be serializable', async () => {
    const db = await createReadyDb();
    try {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      await expect(insertLeadCaptureEvent(db, {
        work_item_id: 'work-1',
        raw_text: 'raw',
        parsed_json: circular,
        action: 'PARSED',
      })).rejects.toThrow('parsed_json must be serializable');
    } finally {
      db.close();
    }
  });

  it('does not write collected_leads, customers, or mutate lead_work_items', async () => {
    const db = await createReadyDb();
    try {
      const original = createWorkItem({ id: 'safe-1', status: 'TODO' });
      await insertLeadWorkItem(db, original);

      await insertLeadCaptureEvent(db, {
        work_item_id: 'safe-1',
        raw_text: '电话 0757-88889999',
        parsed_json: { tels: ['0757-88889999'] },
        action: 'PARSED',
      });

      const workItems = await db.select<LeadWorkItem>('SELECT * FROM lead_work_items');
      expect(await db.select('SELECT * FROM collected_leads')).toHaveLength(0);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(workItems).toHaveLength(1);
      expect(workItems[0]).toMatchObject(original);
    } finally {
      db.close();
    }
  });

  it('lists capture events by work_item_id ordered by created_at descending with default limit 5', async () => {
    const db = await createReadyDb();
    try {
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-a' }));
      await insertLeadWorkItem(db, createWorkItem({ id: 'work-b' }));
      for (let index = 1; index <= 6; index += 1) {
        await seedCaptureEvent(db, {
          id: `a-${index}`,
          work_item_id: 'work-a',
          raw_text: `work a raw ${index}`,
          created_at: `2026-06-14T00:0${index}:00.000Z`,
        });
      }
      await seedCaptureEvent(db, {
        id: 'b-1',
        work_item_id: 'work-b',
        raw_text: 'work b raw',
        created_at: '2026-06-14T00:09:00.000Z',
      });

      const events = await listLeadCaptureEventsByWorkItemId(db, 'work-a');

      expect(events.map(event => event.id)).toEqual(['a-6', 'a-5', 'a-4', 'a-3', 'a-2']);
      expect(events.every(event => event.work_item_id === 'work-a')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('honors an explicit capture event limit without writing other lead domains', async () => {
    const db = await createReadyDb();
    try {
      const original = createWorkItem({ id: 'limited-work' });
      await insertLeadWorkItem(db, original);
      await seedCaptureEvent(db, {
        id: 'limited-1',
        work_item_id: 'limited-work',
        raw_text: 'older',
        created_at: '2026-06-14T00:01:00.000Z',
      });
      await seedCaptureEvent(db, {
        id: 'limited-2',
        work_item_id: 'limited-work',
        raw_text: 'newer',
        created_at: '2026-06-14T00:02:00.000Z',
      });

      const events = await listLeadCaptureEventsByWorkItemId(db, 'limited-work', 1);
      const workItems = await db.select<LeadWorkItem>('SELECT * FROM lead_work_items');

      expect(events.map(event => event.id)).toEqual(['limited-2']);
      expect(await db.select('SELECT * FROM collected_leads')).toHaveLength(0);
      expect(await db.select('SELECT * FROM customers')).toHaveLength(0);
      expect(workItems).toHaveLength(1);
      expect(workItems[0]).toMatchObject(original);
    } finally {
      db.close();
    }
  });
});

async function seedCaptureEvent(
  db: DatabaseLike,
  input: {
    id: string;
    work_item_id: string;
    raw_text: string;
    created_at: string;
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO lead_capture_events (
      id, work_item_id, raw_text, parsed_json, confidence_json, action, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.work_item_id,
      input.raw_text,
      JSON.stringify({ mobiles: ['13800138000'], possibleContact: ['张总'] }),
      '{}',
      'PARSED',
      input.created_at,
    ],
  );
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
    status: 'TODO' as LeadWorkStatus,
    note: null,
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}
