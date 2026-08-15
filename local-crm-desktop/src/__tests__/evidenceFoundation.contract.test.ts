/**
 * V0.2B / B1 — First-Class Evidence Foundation 契约测试（T1–T18）。
 *
 * 覆盖任务 §16 的全部必需证明。原则（与既有 focused 测试一致）：
 * - 全部使用 better-sqlite3 :memory:，禁止触碰生产 personal-crm.db；
 * - 静态架构证据扫描 src/lib/evidence/** 源码，保证零写权威表、零网络、零模型。
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import {
  createEvidenceRepository,
  ensureEvidenceSchema,
  EvidencePolicyError,
  computeContentHash,
  sourceIdentity,
  EVIDENCE_MAX_SUMMARY_CHARS,
  EVIDENCE_MAX_EXCERPT_CHARS,
  EVIDENCE_MAX_PAYLOAD_CHARS,
  EVIDENCE_AUTO_PROMOTES_TO_CRM_FACT,
  CROSS_CUSTOMER_EVIDENCE_LEAKAGE,
  EVIDENCE_FIRST_CLASS_ENTITY,
  CURRENT_INDEPENDENT_EVIDENCE_CAPABILITY_COUNT,
  EVIDENCE_CAPABILITY_CANDIDATE_CLASSIFICATION,
  SEMANTIC_DEDUP_IMPLEMENTED,
} from '../lib/evidence';
import {
  PRODUCTION_CAPABILITY_COUNT,
  PRODUCTION_CAPABILITY_BINDINGS,
  PRODUCTION_CAPABILITY_IDS,
} from '../lib/capabilities/execution/production';
import { createBattleCardRepositories } from '../lib/battleCard/repository';

const EVIDENCE_DIR = resolve(__dirname, '../lib/evidence');

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

const NOW = '2026-08-01T12:00:00.000Z';

async function seedCustomer(db: DatabaseLike, id: string, name = 'Acme'): Promise<void> {
  await db.execute(
    `INSERT INTO customers (id, name, customer_grade, stage, payment_status, created_at, updated_at)
     VALUES (?, ?, 'A', 'NEW_LEAD', 'NOT_STARTED', ?, ?)`,
    [id, name, NOW, NOW],
  );
}

function urlEvidence(overrides: Partial<Parameters<ReturnType<typeof createEvidenceRepository>['create']>[0]> = {}) {
  return {
    id: 'ev-1',
    customer_id: 'cust-a',
    source_type: 'URL' as const,
    source_url: 'https://example.com/mx-market',
    source_title: 'Official site',
    captured_at: NOW,
    summary: 'Official website now contains a Mexico market page.',
    excerpt: 'Mexico market page is live.',
    ...overrides,
  };
}

function stripCodeNoise(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  out = out.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

function evidenceSource(): string {
  return ['types.ts', 'policy.ts', 'identity.ts', 'schema.ts', 'repository.ts', 'contract.ts', 'index.ts']
    .map((file) => stripCodeNoise(readFileSync(resolve(EVIDENCE_DIR, file), 'utf8')))
    .join('\n');
}

async function withDb(fn: (db: DatabaseLike) => Promise<void>): Promise<void> {
  const db = createSqliteDb();
  try {
    await initializeDatabaseSchema(db);
    await fn(db);
  } finally {
    db.close();
  }
}

describe('T1 — EVIDENCE IDENTITY STABLE', () => {
  it('identity is stable and content fields are immutable after create', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a');
      const repo = createEvidenceRepository(db, () => NOW);
      const { row, deduped } = await repo.create(urlEvidence());
      expect(deduped).toBe(false);
      expect(row.id).toBe('ev-1');
      expect(row.customer_id).toBe('cust-a');
      expect(row.captured_at).toBe(NOW);
      // content_hash 由 summary/excerpt 确定性推导，非调用方伪造。
      expect(row.content_hash).toBe(await computeContentHash(row.summary, row.excerpt));
      const got = await repo.get('ev-1');
      expect(got).toEqual(row);
    });
  });
});

describe('T2 — PROVENANCE PRESERVED', () => {
  it('stores source_type / source_url / source_title / captured_at verbatim', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a');
      const repo = createEvidenceRepository(db, () => NOW);
      const { row } = await repo.create(urlEvidence());
      expect(row.source_type).toBe('URL');
      expect(row.source_url).toBe('https://example.com/mx-market');
      expect(row.source_title).toBe('Official site');
      expect(row.captured_at).toBe(NOW);
      expect(row.content_hash).toBe(await computeContentHash(row.summary, row.excerpt));
    });
  });
});

describe('T3 — EVIDENCE != CRM FACT', () => {
  it('EVIDENCE_AUTO_PROMOTES_TO_CRM_FACT is false and module has no CRM-fact write path', async () => {
    expect(EVIDENCE_AUTO_PROMOTES_TO_CRM_FACT).toBe(false);
    const source = evidenceSource();
    for (const token of ['INSERT INTO reviewed_facts', 'INSERT INTO customer_hypotheses', 'UPDATE reviewed_facts', 'UPDATE customer_hypotheses']) {
      expect(source).not.toContain(token);
    }
  });
});

describe('T4 — EVIDENCE != HYPOTHESIS', () => {
  it('evidence module never touches customer_hypotheses', async () => {
    const source = evidenceSource();
    expect(source).not.toContain('customer_hypotheses');
  });
});

describe('T5 — OWNERSHIP EXPLICIT', () => {
  it('customer_id is required and empty customer fails closed', async () => {
    await withDb(async (db) => {
      const repo = createEvidenceRepository(db, () => NOW);
      await expect(
        repo.create(urlEvidence({ customer_id: '   ' })),
      ).rejects.toBeInstanceOf(EvidencePolicyError);
    });
  });
});

describe('T6 — CROSS-CUSTOMER LEAKAGE BLOCKED', () => {
  it('customer B cannot read customer A evidence; exists is customer-scoped', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a', 'A');
      await seedCustomer(db, 'cust-b', 'B');
      const repo = createEvidenceRepository(db, () => NOW);
      const { row } = await repo.create(urlEvidence({ customer_id: 'cust-a', id: 'ev-a' }));

      expect(await repo.listByCustomer('cust-b')).toEqual([]);
      expect(await repo.getOwned('cust-b', 'ev-a')).toBeNull();
      expect(await repo.exists('cust-b', 'ev-a')).toBe(false);
      expect(await repo.exists('cust-a', 'ev-a')).toBe(true);
      expect(row.customer_id).toBe('cust-a');
    });
  });

  it('CROSS_CUSTOMER_EVIDENCE_LEAKAGE invariant is false', () => {
    expect(CROSS_CUSTOMER_EVIDENCE_LEAKAGE).toBe(false);
  });
});

describe('T7 — INVALID REQUIRED PROVENANCE FAILS CLOSED', () => {
  it('URL type without source_url, missing locator, missing/invalid captured_at, missing summary all fail', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a');
      const repo = createEvidenceRepository(db, () => NOW);

      await expect(repo.create(urlEvidence({ source_url: null, source_ref: null })))
        .rejects.toThrow(/source_url|provenance/i);

      await expect(repo.create(urlEvidence({ source_type: 'MANUAL', source_url: null, source_ref: null })))
        .rejects.toThrow(/provenance/i);

      await expect(repo.create(urlEvidence({ captured_at: 'not-a-date' })))
        .rejects.toThrow(/captured_at/);

      await expect(repo.create(urlEvidence({ captured_at: '   ' })))
        .rejects.toBeInstanceOf(EvidencePolicyError);

      await expect(repo.create(urlEvidence({ summary: '   ' })))
        .rejects.toBeInstanceOf(EvidencePolicyError);
    });
  });
});

describe('T8 — DETERMINISTIC FINGERPRINT / DEDUP SEMANTICS', () => {
  it('same page + same content dedups; same page + changed content is new; different page + similar text is new', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a');
      const repo = createEvidenceRepository(db, () => NOW);

      const first = await repo.create(urlEvidence({ id: 'ev-1' }));
      // same page + same content (different id) → dedup hit, same row
      const dup = await repo.create(urlEvidence({ id: 'ev-dup' }));
      expect(dup.deduped).toBe(true);
      expect(dup.row.id).toBe('ev-1');

      // same page + changed content → new row
      const changed = await repo.create(urlEvidence({ id: 'ev-2', excerpt: 'Updated: Mexico page now lists pricing.' }));
      expect(changed.deduped).toBe(false);
      expect(changed.row.id).toBe('ev-2');
      expect(changed.row.content_hash).not.toBe(first.row.content_hash);

      // different page + similar text → new row
      const otherPage = await repo.create(urlEvidence({ id: 'ev-3', source_url: 'https://example.com/br-market' }));
      expect(otherPage.deduped).toBe(false);
      expect(otherPage.row.id).toBe('ev-3');
    });
  });

  it('content hash is deterministic and source identity is stable', async () => {
    const a = await computeContentHash('X', 'Y');
    const b = await computeContentHash('X', 'Y');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceIdentity('URL', 'https://x.com', null)).toBe('URL:https://x.com');
    expect(sourceIdentity('MANUAL', null, 'doc-9')).toBe('MANUAL:doc-9');
    expect(SEMANTIC_DEDUP_IMPLEMENTED).toBe(false);
  });
});

describe('T9 — RAW PAYLOAD BOUNDARY ENFORCED', () => {
  it('summary/excerpt/payload limits are enforced fail-closed', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a');
      const repo = createEvidenceRepository(db, () => NOW);

      const longSummary = 'x'.repeat(EVIDENCE_MAX_SUMMARY_CHARS + 1);
      await expect(repo.create(urlEvidence({ summary: longSummary }))).rejects.toThrow(/summary/i);

      const longExcerpt = 'x'.repeat(EVIDENCE_MAX_EXCERPT_CHARS + 1);
      await expect(repo.create(urlEvidence({ excerpt: longExcerpt }))).rejects.toThrow(/excerpt/i);

      // 单项合规但总预算超限
      const bigSummary = 'x'.repeat(EVIDENCE_MAX_SUMMARY_CHARS);
      const bigExcerpt = 'x'.repeat(EVIDENCE_MAX_EXCERPT_CHARS - 900);
      expect(bigSummary.length + bigExcerpt.length).toBeGreaterThan(EVIDENCE_MAX_PAYLOAD_CHARS);
      await expect(repo.create(urlEvidence({ summary: bigSummary, excerpt: bigExcerpt }))).rejects.toThrow(/payload/i);
    });
  });
});

describe('T10/T11 — EVIDENCE NEVER MUTATES CUSTOMER PROFILE / STAGE / GRADE / PAYMENT', () => {
  it('create evidence leaves the customer authoritative row untouched', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a');
      const repo = createEvidenceRepository(db, () => NOW);
      await repo.create(urlEvidence());
      const customers = await db.select<Record<string, unknown>>(
        'SELECT customer_grade, stage, payment_status, next_follow_up_at, current_stage_card_id FROM customers WHERE id = ?',
        ['cust-a'],
      );
      expect(customers[0]).toEqual({
        customer_grade: 'A',
        stage: 'NEW_LEAD',
        payment_status: 'NOT_STARTED',
        next_follow_up_at: null,
        current_stage_card_id: null,
      });
    });
  });

  it('evidence module has zero write tokens against authoritative CRM fields', () => {
    const source = evidenceSource();
    for (const token of [
      'UPDATE customers', 'INSERT INTO customers', 'DELETE FROM customers',
      'customer_grade', 'payment_status', 'deal_amount', 'next_follow_up_at',
      'current_stage_card_id', 'battle_card_status',
    ]) {
      expect(source).not.toContain(token);
    }
  });
});

describe('T12 — NO NETWORK CALLS', () => {
  it('evidence module has no fetch/http/network/crawl/firecrawl references', () => {
    const source = evidenceSource().toLowerCase();
    for (const token of ['fetch(', 'http', 'https', 'network', 'firecrawl', 'crawler', 'browser', 'xmlhttprequest', 'websocket']) {
      expect(source).not.toContain(token);
    }
  });
});

describe('T13 — NO PROVIDER / MODEL CALLS', () => {
  it('evidence module has no provider/model/LLM references', () => {
    const source = evidenceSource().toLowerCase();
    for (const token of ['provider', 'model', 'llm', 'deepseek', 'openai', 'vision']) {
      expect(source).not.toContain(token);
    }
  });
});

describe('T14 — BATTLE CARD EVIDENCE_REFS COMPATIBILITY', () => {
  it('BattleCardEvidenceGuard resolves EVIDENCE refs customer-scoped (owned passes, cross-customer fails)', async () => {
    await withDb(async (db) => {
      await seedCustomer(db, 'cust-a', 'A');
      await seedCustomer(db, 'cust-b', 'B');
      const repo = createEvidenceRepository(db, () => NOW);
      await repo.create(urlEvidence({ customer_id: 'cust-a', id: 'ev-a' }));

      const repos = createBattleCardRepositories(db, () => NOW);
      // 同客户引用一等证据 → 通过
      await expect(
        repos.evidenceGuard.assertAll('cust-a', [{ evidence_type: 'EVIDENCE', evidence_id: 'ev-a' }]),
      ).resolves.toBeUndefined();
      // 跨客户引用 → 拒绝
      await expect(
        repos.evidenceGuard.assertAll('cust-b', [{ evidence_type: 'EVIDENCE', evidence_id: 'ev-a' }]),
      ).rejects.toThrow(/ownership failed/);
      // 不存在的证据 → 拒绝
      await expect(
        repos.evidenceGuard.assertAll('cust-a', [{ evidence_type: 'EVIDENCE', evidence_id: 'ev-missing' }]),
      ).rejects.toThrow(/ownership failed/);
    });
  });
});

describe('T15 — FROZEN 24 V0.2A CAPABILITIES UNCHANGED', () => {
  it('production registry and bindings remain exactly 24', () => {
    expect(PRODUCTION_CAPABILITY_COUNT).toBe(24);
    expect(PRODUCTION_CAPABILITY_BINDINGS).toHaveLength(24);
    expect(PRODUCTION_CAPABILITY_IDS).toHaveLength(24);
  });
});

describe('T16 — IMPORT.EXECUTE REMAINS ABSENT / DEFERRED', () => {
  it('import.execute is not a registered production capability id', () => {
    expect(PRODUCTION_CAPABILITY_IDS).not.toContain('import.execute');
    expect(PRODUCTION_CAPABILITY_IDS).not.toContain('import_execute');
  });
});

describe('T17 — NO V0.2C UI', () => {
  it('evidence domain ships no React/page/component UI wiring', () => {
    const files = ['types.ts', 'policy.ts', 'identity.ts', 'schema.ts', 'repository.ts', 'contract.ts', 'index.ts'];
    for (const file of files) {
      expect(file.endsWith('.tsx')).toBe(false);
    }
    const source = evidenceSource();
    expect(source).not.toContain('React');
    expect(source).not.toContain('jsx');
    expect(source).not.toContain('useState');
  });
});

describe('T18 — NO V0.3 AGENT LOOP', () => {
  it('evidence domain has no agent loop / salesAgent runtime wiring', () => {
    const source = evidenceSource();
    for (const token of ['salesAgent', 'operatingLayer', 'runtime', 'agentLoop', 'confirmedWrite', 'SalesAgentSession']) {
      expect(source).not.toContain(token);
    }
  });
});

describe('B1 FOUNDATION TRUTH', () => {
  it('evidence is first-class, capability count stays 0 (foundation-only, not failure)', () => {
    expect(EVIDENCE_FIRST_CLASS_ENTITY).toBe(true);
    expect(CURRENT_INDEPENDENT_EVIDENCE_CAPABILITY_COUNT).toBe(0);
    const candidates = EVIDENCE_CAPABILITY_CANDIDATE_CLASSIFICATION.map((c) => c.candidate).sort();
    expect(candidates).toEqual(['evidence.get', 'evidence.list_by_customer', 'evidence.read', 'evidence.search']);
    for (const entry of EVIDENCE_CAPABILITY_CANDIDATE_CLASSIFICATION) {
      expect(entry.classification.startsWith('DEFER_TO_B')).toBe(true);
    }
  });

  it('ensureEvidenceSchema is idempotent', async () => {
    await withDb(async (db) => {
      await ensureEvidenceSchema(db);
      await ensureEvidenceSchema(db);
    });
  });
});
