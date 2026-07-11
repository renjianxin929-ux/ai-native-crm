import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureCustomerMemorySchema, SqliteCrmEvidenceResolver, SqliteMemoryRepository } from '../lib/customerMemory';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { enrichContextSnapshotWithCustomerMemory } from '../lib/context/customerMemoryEnrichment';
import { hasExactStage8CustomerMemoryFoundationChangedFileSet, STAGE8_CUSTOMER_MEMORY_FOUNDATION_CHANGED_FILES } from './modelCapabilitiesChangedFileCohort';

function database() {
  const sqlite = new Database(':memory:');
  const db = {
    async execute(sql: string, bindings: unknown[] = []) { const result = sqlite.prepare(sql).run(bindings as never[]); return { rowsAffected: result.changes }; },
    async select<T>(sql: string, bindings: unknown[] = []) { return sqlite.prepare(sql).all(bindings as never[]) as T[]; },
  };
  return { sqlite, db };
}

async function setup() {
  const { sqlite, db } = database();
  await db.execute('CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT)');
  await db.execute('CREATE TABLE follow_up_records (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL)');
  await db.execute('CREATE TABLE visit_records (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL)');
  await db.execute('CREATE TABLE tasks (id TEXT PRIMARY KEY, customer_id TEXT)');
  await db.execute("INSERT INTO customers (id, name) VALUES ('customer-1', 'Ada')");
  await db.execute("INSERT INTO follow_up_records (id, customer_id) VALUES ('followup-1', 'customer-1')");
  await ensureCustomerMemorySchema(db);
  return { sqlite, repo: new SqliteMemoryRepository(db, new SqliteCrmEvidenceResolver(db), () => '2026-07-11T00:00:00.000Z') };
}

const candidate = (overrides = {}) => ({ id: 'memory-1', customer_id: 'customer-1', memory_type: 'FACT' as const, content: 'Customer requested a product comparison.', source_type: 'CRM_INTERACTION' as const, source_reference: 'follow_up_records:followup-1', confidence: 0.9, evidence: [{ id: 'link-1', evidence_type: 'FOLLOW_UP_RECORD' as const, evidence_id: 'followup-1' }], ...overrides });

describe('Stage8 persistent customer memory foundation', () => {
  it('keeps the migration in the exact Stage8 changed-file cohort', () => {
    expect(STAGE8_CUSTOMER_MEMORY_FOUNDATION_CHANGED_FILES).toContain('src-tauri/migrations/004_ai_customer_memory.sql');
    expect(hasExactStage8CustomerMemoryFoundationChangedFileSet(STAGE8_CUSTOMER_MEMORY_FOUNDATION_CHANGED_FILES)).toBe(true);
    expect(hasExactStage8CustomerMemoryFoundationChangedFileSet(STAGE8_CUSTOMER_MEMORY_FOUNDATION_CHANGED_FILES.filter(file => file !== 'src-tauri/migrations/004_ai_customer_memory.sql'))).toBe(false);
  });

  it('creates only dedicated AI memory tables and preserves the CRM schema', async () => {
    const { sqlite } = await setup();
    const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    expect(names.map(row => row.name)).toEqual(expect.arrayContaining(['ai_memory_entries', 'ai_memory_evidence_links', 'customers', 'follow_up_records']));
    expect(sqlite.prepare('PRAGMA table_info(customers)').all().map((row: { name: string }) => row.name)).toEqual(['id', 'name']);
  });

  it('creates, validates, activates, retrieves, and archives a memory entry through the repository', async () => {
    const { repo } = await setup();
    expect((await repo.createCandidate(candidate())).validation_status).toBe('CANDIDATE');
    await repo.validateMemory('memory-1', { validation_source: 'CRM_EVIDENCE' });
    expect((await repo.activateMemory('memory-1')).validation_status).toBe('ACTIVE');
    expect((await repo.getMemoryContext('customer-1')).items).toHaveLength(1);
    expect((await repo.archiveMemory('memory-1')).validation_status).toBe('ARCHIVED');
    expect((await repo.getMemoryContext('customer-1')).items).toHaveLength(0);
  });

  it('rejects missing or unknown evidence, and never promotes an unsupported AI summary', async () => {
    const { repo } = await setup();
    await expect(repo.createCandidate(candidate({ id: 'no-evidence', evidence: [] }))).rejects.toThrow('evidence');
    await expect(repo.createCandidate(candidate({ id: 'bad-evidence', evidence: [{ id: 'link-bad', evidence_type: 'FOLLOW_UP_RECORD', evidence_id: 'missing' }] }))).rejects.toThrow('unknown');
    await repo.createCandidate(candidate({ id: 'ai-summary', source_type: 'AI_REASONING_SUMMARY', memory_type: 'HUMAN_CONFIRMED_INSIGHT' }));
    await expect(repo.validateMemory('ai-summary', { validation_source: 'CRM_EVIDENCE' })).rejects.toThrow('human verification');
    expect((await repo.validateMemory('ai-summary', { validation_source: 'HUMAN_REVIEW', human_verified: true })).validation_status).toBe('VALIDATED');
  });

  it('enriches a ContextSnapshot with bounded active memory only, without mutating CRM context', async () => {
    const { repo } = await setup();
    await repo.createCandidate(candidate());
    await repo.validateMemory('memory-1', { validation_source: 'CRM_EVIDENCE' });
    await repo.activateMemory('memory-1');
    await repo.createCandidate(candidate({ id: 'candidate-only', evidence: [{ id: 'link-2', evidence_type: 'FOLLOW_UP_RECORD', evidence_id: 'followup-1' }] }));
    const snapshot = buildContextSnapshot({ snapshotId: 'snapshot-1', capturedAt: '2026-07-11T00:00:00.000Z', timeWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-11T00:00:00.000Z' }, customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: '2026-07-10T00:00:00.000Z', evidenceIds: ['customer-1'] }], accounts: [], interactions: [] });
    const enriched = await enrichContextSnapshotWithCustomerMemory({ snapshot, repository: repo, max_items: 1 });
    expect(enriched).not.toBe(snapshot);
    expect(enriched.customerMemory?.items.map(item => item.memory_id)).toEqual(['memory-1']);
    expect(snapshot.customerMemory).toBeUndefined();
    expect(enriched.customers).toEqual(snapshot.customers);
  });
});
