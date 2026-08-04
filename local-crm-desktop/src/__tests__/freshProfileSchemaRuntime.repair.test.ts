import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __setDatabaseLoaderForTests,
  __setDbInstanceForTests,
  createCustomer,
  CUSTOMER_ROW_DECODER_FIELDS,
  CUSTOMER_SELECT_PROJECTION,
  decodeCustomerRow,
  getDbError,
  initializeDatabaseSchema,
  listCustomers,
  type DatabaseLike,
} from '../lib/db';
import { ensureBattleCardCustomerPointers } from '../lib/battleCard/schema';

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

afterEach(() => {
  __setDatabaseLoaderForTests(null);
  __setDbInstanceForTests(null);
});

describe('fresh-profile schema and customer projection repair', () => {
  it('creates battle_card_status exactly once on a fresh database and repeated initialization is idempotent', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await initializeDatabaseSchema(db);

      const columns = await db.select<{ name: string }>('PRAGMA table_info(customers)');
      expect(columns.filter(column => column.name === 'battle_card_status')).toHaveLength(1);
      expect(columns.map(column => column.name)).toEqual(expect.arrayContaining([
        'current_stage_card_id', 'battle_card_status', 'last_battle_review_at',
      ]));
    } finally {
      db.close();
    }
  });

  it('migrates a pre-005 customer table only when each pointer column is absent and preserves business rows', async () => {
    const db = createSqliteDb();
    try {
      await db.execute(`CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await db.execute(
        "INSERT INTO customers (id, name, created_at, updated_at) VALUES ('legacy-1', '旧客户', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')",
      );

      await ensureBattleCardCustomerPointers(db);
      await ensureBattleCardCustomerPointers(db);

      const columns = await db.select<{ name: string }>('PRAGMA table_info(customers)');
      expect(columns.filter(column => column.name === 'battle_card_status')).toHaveLength(1);
      const preserved = await db.select<{ id: string; name: string }>('SELECT id, name FROM customers WHERE id = ?', ['legacy-1']);
      expect(preserved).toEqual([{ id: 'legacy-1', name: '旧客户' }]);
    } finally {
      db.close();
    }
  });

  it('skips ALTER TABLE when a legacy database already contains battle_card_status', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_stage_card_id TEXT,
      battle_card_status TEXT NOT NULL DEFAULT 'NONE',
      last_battle_review_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    const execute = vi.fn(async (sql: string, bindings: unknown[] = []) => {
      const result = sqlite.prepare(sql).run(bindings as never[]);
      return { rowsAffected: Number(result.changes) };
    });
    const db: DatabaseLike = {
      execute,
      async select<T>(sql: string, bindings: unknown[] = []) {
        return sqlite.prepare(sql).all(bindings as never[]) as T[];
      },
    };

    try {
      await ensureBattleCardCustomerPointers(db);
      expect(execute.mock.calls.map(([sql]) => String(sql))).not.toContain(expect.stringContaining('ALTER TABLE customers ADD COLUMN'));
    } finally {
      sqlite.close();
    }
  });

  it('uses one 44-field explicit customer projection and rejects a missing decoded field without positional access', () => {
    expect(CUSTOMER_ROW_DECODER_FIELDS).toHaveLength(44);
    expect(CUSTOMER_ROW_DECODER_FIELDS.at(-1)).toBe('updated_at');
    expect(CUSTOMER_SELECT_PROJECTION.split(', ')).toEqual([...CUSTOMER_ROW_DECODER_FIELDS]);

    const completeRow = Object.fromEntries(CUSTOMER_ROW_DECODER_FIELDS.map(field => [field, null]));
    completeRow.id = 'customer-1';
    completeRow.name = '投影客户';
    completeRow.created_at = '2026-08-04T00:00:00.000Z';
    completeRow.updated_at = '2026-08-04T00:00:00.000Z';
    expect(decodeCustomerRow(completeRow).name).toBe('投影客户');

    delete completeRow.updated_at;
    expect(() => decodeCustomerRow(completeRow)).toThrow('Customer row projection mismatch: missing updated_at');
  });

  it('reads a freshly initialized customer through the explicit projection', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      __setDbInstanceForTests(db);
      await createCustomer(
        'fresh-1', '新 Profile 客户', null, null, null, null, 0, 'C', 'NOT_ADDED', 'UNKNOWN',
        null, null, null, 'NOT_PARSED', null, null,
        null, null, null, null, null, null, null, null, null, null,
      );
      await expect(listCustomers()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'fresh-1', name: '新 Profile 客户', battle_card_status: 'NONE' }),
      ]));
    } finally {
      __setDbInstanceForTests(null);
      db.close();
    }
  });

  it('fails closed after initialization failure: concurrent callers share one attempt and no customer query runs', async () => {
    const select = vi.fn(async <T>() => [] as T[]);
    const failingDb: DatabaseLike = {
      execute: vi.fn(async () => {
        throw new Error('synthetic schema migration failure');
      }),
      select,
    };
    const load = vi.fn(async () => failingDb);
    __setDatabaseLoaderForTests(load);

    const results = await Promise.allSettled([listCustomers(), listCustomers()]);

    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(getDbError()).toBe('数据库初始化失败: synthetic schema migration failure');
    await expect(listCustomers()).rejects.toThrow('数据库初始化失败: synthetic schema migration failure');
    expect(select).not.toHaveBeenCalled();
  });

  it('keeps migration 005 free of unconditional customer ALTER statements and puts fresh pointers in the initial schema', () => {
    const migration001 = readFileSync(new URL('../../src-tauri/migrations/001_initial.sql', import.meta.url), 'utf8');
    const migration005 = readFileSync(new URL('../../src-tauri/migrations/005_customer_battle_card.sql', import.meta.url), 'utf8');

    expect(migration001).toMatch(/battle_card_status TEXT NOT NULL DEFAULT 'NONE'/);
    expect(migration005).not.toMatch(/ALTER TABLE customers ADD COLUMN battle_card_status/i);
    expect(migration005).not.toMatch(/ALTER TABLE customers ADD COLUMN current_stage_card_id/i);
    expect(migration005).not.toMatch(/ALTER TABLE customers ADD COLUMN last_battle_review_at/i);
  });
});
