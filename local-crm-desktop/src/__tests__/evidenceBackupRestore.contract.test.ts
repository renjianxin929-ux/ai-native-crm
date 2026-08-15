/**
 * V0.2B / B1 Closure — Evidence Backup / Restore 生命周期 round-trip 契约测试。
 *
 * 证明：一等 Evidence 参与现有产品 backup/restore 机制，
 * 恢复后 identity / provenance / customer ownership 完全不变，
 * 且 Battle Card Evidence guard 仍按客户作用域解析（同客户过、跨客户拒）。
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import { createEvidenceRepository } from '../lib/evidence';
import {
  buildFullBackupPayload,
  restoreBackupPayloadWithDb,
  BACKUP_TABLES,
} from '../lib/backupRestore';
import { createBattleCardRepositories } from '../lib/battleCard/repository';

function createSqliteDb(): DatabaseLike & { close(): void } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
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

const CLOCK = () => '2026-08-01T12:00:00.000Z';

async function seedCustomer(db: DatabaseLike, id: string, name: string): Promise<void> {
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, payment_status, created_at, updated_at)
     VALUES (?, ?, 'A', 'NEW_LEAD', 'NOT_STARTED', ?, ?)`,
    [id, name, CLOCK(), CLOCK()],
  );
}

describe('V0.2B B1 — Evidence backup/restore round-trip closure', () => {
  it('evidence is in the product backup allowlist and restore order', () => {
    expect(BACKUP_TABLES).toContain('evidence');
  });

  it('backup → restore preserves Evidence identity/provenance/ownership and keeps Battle Card guard scoped', async () => {
    const db = createSqliteDb();
    try {
      await initializeDatabaseSchema(db);
      await seedCustomer(db, 'cust-a', 'Customer A');
      await seedCustomer(db, 'cust-b', 'Customer B');

      const repo = createEvidenceRepository(db, CLOCK);
      const { row: ea } = await repo.create({
        id: 'ea-1',
        customer_id: 'cust-a',
        source_type: 'URL',
        source_url: 'https://example.com/mx-market',
        source_title: 'Official site',
        source_ref: null,
        captured_at: '2026-08-01T10:00:00.000Z',
        summary: 'Official website now contains a Mexico market page.',
        excerpt: 'Mexico market page is live.',
      });

      // 真实产品备份路径
      const backup = await buildFullBackupPayload(db, {
        version: '0.4.0',
        exportedAt: '2026-08-01T12:00:00.000Z',
      });
      expect(backup.tables.evidence).toHaveLength(1);

      // 模拟"依据丢失"：清空 evidence（客户仍在），再走真实恢复路径
      await db.execute('DELETE FROM evidence');
      expect(await repo.getOwned('cust-a', 'ea-1')).toBeNull();

      const result = await restoreBackupPayloadWithDb(db, backup);
      expect(result.ok).toBe(true);
      expect(result.restoredCounts.evidence).toBe(1);

      // EA 恢复后存在
      const restored = await repo.getOwned('cust-a', 'ea-1');
      expect(restored).not.toBeNull();

      // 全部不可变 identity/provenance 字段逐字节保留
      expect(restored).toEqual(ea);
      expect(restored!.id).toBe(ea.id);
      expect(restored!.customer_id).toBe(ea.customer_id);
      expect(restored!.source_type).toBe(ea.source_type);
      expect(restored!.source_url).toBe(ea.source_url);
      expect(restored!.source_title).toBe(ea.source_title);
      expect(restored!.source_ref).toBe(ea.source_ref);
      expect(restored!.captured_at).toBe(ea.captured_at);
      expect(restored!.summary).toBe(ea.summary);
      expect(restored!.excerpt).toBe(ea.excerpt);
      expect(restored!.content_hash).toBe(ea.content_hash);
      expect(restored!.status).toBe(ea.status);

      // 归属仅 Customer A；Customer B 无法通过 owned 访问读取/解析
      expect(restored!.customer_id).toBe('cust-a');
      expect(await repo.getOwned('cust-b', 'ea-1')).toBeNull();
      expect(await repo.exists('cust-b', 'ea-1')).toBe(false);
      expect(await repo.exists('cust-a', 'ea-1')).toBe(true);

      // Battle Card Evidence guard：同客户通过、跨客户拒绝
      const repos = createBattleCardRepositories(db, CLOCK);
      await expect(
        repos.evidenceGuard.assertAll('cust-a', [{ evidence_type: 'EVIDENCE', evidence_id: 'ea-1' }]),
      ).resolves.toBeUndefined();
      await expect(
        repos.evidenceGuard.assertAll('cust-b', [{ evidence_type: 'EVIDENCE', evidence_id: 'ea-1' }]),
      ).rejects.toThrow(/ownership failed/);
    } finally {
      db.close();
    }
  });
});
