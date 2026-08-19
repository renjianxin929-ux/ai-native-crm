/**
 * One-shot disposable-copy DB gate for V0.2 final closure.
 * Does not mutate the live production database.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  BACKUP_TABLES,
  buildFullBackupPayload,
  restoreBackupPayloadWithDb,
  type BackupTableName,
} from '../src/lib/backupRestore';
import { initializeDatabaseSchema, type DatabaseLike } from '../src/lib/db';

const LIVE = `${process.env.HOME}/Library/Application Support/com.localcrm.desktop/personal-crm.db`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const DIR = join(tmpdir(), `v02-db-gate-${STAMP}`);
const COPY = join(DIR, 'disposable.db');

type FileDb = DatabaseLike & { path: string; close(): void };

function openFileDb(path: string): FileDb {
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

function counts(sqlite: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    out[table] = Number(sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
  }
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(LIVE)) {
    throw new Error(`LIVE_DB_MISSING: ${LIVE}`);
  }
  mkdirSync(DIR, { recursive: true });
  copyFileSync(LIVE, COPY);
  console.log(`DISPOSABLE_COPY=${COPY}`);

  const probe = new Database(COPY);
  probe.pragma('foreign_keys = ON');
  const integrity = probe.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  const fk = probe.prepare('PRAGMA foreign_key_check').all();
  console.log(`INTEGRITY=${JSON.stringify(integrity)}`);
  console.log(`FOREIGN_KEY_CHECK_ROWS=${fk.length}`);
  if (integrity[0]?.integrity_check !== 'ok') throw new Error('HOLD_DATA integrity_check failed');
  if (fk.length !== 0) throw new Error(`HOLD_DATA foreign_key_check=${JSON.stringify(fk)}`);

  const tables = probe.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>;
  console.log(`ALL_TABLES=${tables.map(row => row.name).join(',')}`);
  console.log(`HAS_AI_PROVIDER_CREDENTIALS=${tables.some(row => row.name === 'ai_provider_credentials')}`);
  const before = counts(probe);
  console.log(`PRE_WIPE_COUNTS=${JSON.stringify(before)}`);
  const stagePointer = probe.prepare(
    `SELECT id, name, current_stage_card_id FROM customers WHERE current_stage_card_id IS NOT NULL`,
  ).all() as Array<{ id: string; name: string; current_stage_card_id: string }>;
  console.log(`STAGE_POINTERS=${JSON.stringify(stagePointer)}`);
  for (const row of stagePointer) {
    const card = probe.prepare('SELECT id, customer_id FROM customer_stage_cards WHERE id = ?').get(row.current_stage_card_id) as { id: string; customer_id: string } | undefined;
    if (!card) throw new Error(`STAGE_POINTER_ORPHAN customer=${row.id}`);
    if (card.customer_id !== row.id) throw new Error(`STAGE_POINTER_CUSTOMER_MISMATCH customer=${row.id}`);
  }
  probe.close();

  const db = openFileDb(COPY);
  await initializeDatabaseSchema(db);
  const backup = await buildFullBackupPayload(db, { version: '0.2.0-final-gate', exportedAt: STAMP });
  if ('ai_provider_credentials' in backup.tables) {
    throw new Error('BACKUP_CONTAINS_CREDENTIALS');
  }
  console.log(`BACKUP_TABLE_COUNT=${BACKUP_TABLES.length}`);
  for (const table of BACKUP_TABLES) {
    if (backup.counts[table] !== before[table]) {
      throw new Error(`BACKUP_COUNT_MISMATCH ${table} backup=${backup.counts[table]} db=${before[table]}`);
    }
  }

  const sqlite = new Database(COPY);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec('PRAGMA defer_foreign_keys = ON');
  sqlite.exec('BEGIN');
  for (const table of [...BACKUP_TABLES].reverse()) {
    sqlite.exec(`DELETE FROM ${table}`);
  }
  sqlite.exec('COMMIT');
  const wiped = counts(sqlite);
  sqlite.close();
  console.log(`WIPED_COUNTS=${JSON.stringify(wiped)}`);

  const restoredDb = openFileDb(COPY);
  restoredDb.path = COPY;
  await restoreBackupPayloadWithDb(restoredDb, backup);
  restoredDb.close();

  const after = new Database(COPY);
  after.pragma('foreign_keys = ON');
  const afterCounts = counts(after);
  console.log(`POST_RESTORE_COUNTS=${JSON.stringify(afterCounts)}`);
  for (const table of BACKUP_TABLES) {
    if (afterCounts[table] !== before[table]) {
      throw new Error(`RESTORE_COUNT_MISMATCH ${table} before=${before[table]} after=${afterCounts[table]}`);
    }
  }
  const afterFk = after.prepare('PRAGMA foreign_key_check').all();
  if (afterFk.length !== 0) throw new Error(`RESTORE_FK ${JSON.stringify(afterFk)}`);
  for (const row of stagePointer) {
    const card = after.prepare('SELECT id FROM customer_stage_cards WHERE id = ?').get(row.current_stage_card_id);
    const customer = after.prepare('SELECT current_stage_card_id FROM customers WHERE id = ?').get(row.id) as { current_stage_card_id: string } | undefined;
    if (!card || customer?.current_stage_card_id !== row.current_stage_card_id) {
      throw new Error(`STAGE_POINTER_LOST ${row.id}`);
    }
  }

  const unrelated = after.prepare('SELECT id, name FROM customers ORDER BY name').all() as Array<{ id: string; name: string }>;
  const disposableId = 'v02-gate-disposable-customer';
  const now = '2026-08-17T12:00:00+08:00';
  after.prepare(`INSERT INTO customers (id, name, created_at, updated_at)
    VALUES (?, 'V02门禁可删客户', ?, ?)`).run(disposableId, now, now);
  after.prepare(`INSERT INTO follow_up_records (id, customer_id, title, is_completed, created_at, updated_at)
    VALUES (?, ?, '门禁跟进', 1, ?, ?)`).run(`${disposableId}-fu`, disposableId, now, now);
  after.prepare(`INSERT INTO ai_drafts (id, source_type, customer_id, raw_input_summary, ai_result_json, status, created_at)
    VALUES (?, 'MANUAL', ?, 'gate', '{}', 'DRAFT', ?)`).run(`${disposableId}-draft`, disposableId, now);

  after.exec('BEGIN');
  after.exec('PRAGMA defer_foreign_keys = ON');
  const deleteSql = [
    'UPDATE customers SET current_stage_card_id = NULL WHERE id = ?',
    'DELETE FROM ai_memory_evidence_links WHERE memory_id IN (SELECT id FROM ai_memory_entries WHERE customer_id = ?)',
    'DELETE FROM ai_memory_entries WHERE customer_id = ?',
    'DELETE FROM ai_drafts WHERE customer_id = ?',
    'DELETE FROM evidence WHERE customer_id = ?',
    'DELETE FROM follow_up_records WHERE customer_id = ?',
    'DELETE FROM visit_records WHERE customer_id = ?',
    'DELETE FROM tasks WHERE customer_id = ?',
    'DELETE FROM customer_hypotheses WHERE customer_id = ?',
    'DELETE FROM reviewed_facts WHERE customer_id = ?',
    'DELETE FROM intelligence_imports WHERE customer_id = ?',
    'DELETE FROM customer_stage_cards WHERE customer_id = ?',
    'UPDATE lead_work_items SET customer_id = NULL WHERE customer_id = ?',
    'UPDATE collected_leads SET customer_id = NULL WHERE customer_id = ?',
    'UPDATE lead_sync_logs SET target_customer_id = NULL WHERE target_customer_id = ?',
    'DELETE FROM customers WHERE id = ?',
  ];
  for (const sql of deleteSql) after.prepare(sql).run(disposableId);
  after.exec('COMMIT');

  const gone = after.prepare('SELECT COUNT(*) AS c FROM customers WHERE id = ?').get(disposableId) as { c: number };
  const ownedFollow = after.prepare('SELECT COUNT(*) AS c FROM follow_up_records WHERE customer_id = ?').get(disposableId) as { c: number };
  const ownedDraft = after.prepare('SELECT COUNT(*) AS c FROM ai_drafts WHERE customer_id = ?').get(disposableId) as { c: number };
  if (gone.c !== 0 || ownedFollow.c !== 0 || ownedDraft.c !== 0) {
    throw new Error('DELETE_DID_NOT_CLEAN_OWNED_STATE');
  }
  const remaining = after.prepare('SELECT id, name FROM customers ORDER BY name').all() as Array<{ id: string; name: string }>;
  if (remaining.length !== unrelated.length) {
    throw new Error(`UNRELATED_CUSTOMER_COUNT_CHANGED before=${unrelated.length} after=${remaining.length}`);
  }
  const deleteFk = after.prepare('PRAGMA foreign_key_check').all();
  if (deleteFk.length !== 0) throw new Error(`DELETE_FK ${JSON.stringify(deleteFk)}`);
  after.close();

  console.log('DISPOSABLE_DB_GATE=PASS');
  console.log(`FULL_BACKUP_BUSINESS_TABLE_COUNT=${BACKUP_TABLES.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
