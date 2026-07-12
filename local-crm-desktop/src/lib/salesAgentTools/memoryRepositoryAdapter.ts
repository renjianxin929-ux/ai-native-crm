import { getDb } from '../db';
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository } from '../customerMemory';

export function createSalesAgentMemoryRepository(): SqliteMemoryRepository {
  const db = { execute: async (sql: string, bindings?: unknown[]) => (await getDb()).execute(sql, bindings), select: async <T,>(sql: string, bindings?: unknown[]) => (await getDb()).select<T>(sql, bindings) };
  return new SqliteMemoryRepository(db, new SqliteCrmEvidenceResolver(db));
}
