import Database from 'better-sqlite3';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { createCrmRepository, initializeDatabaseSchema, type DatabaseLike } from '../lib/db';
import type { LoadedReadOnlyAgentSnapshot } from '../lib/readOnlySnapshotLoaderReadiness';
import { SalesAgentSession, type SalesAgentHost } from '../lib/salesAgentTools/agentSession';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

export function sqliteFixture() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db: DatabaseLike = {
    async execute(sql, bindings: unknown[] = []) { const result = sqlite.prepare(sql).run(bindings as never[]); return { rowsAffected: result.changes }; },
    async select<T>(sql, bindings: unknown[] = []) { return sqlite.prepare(sql).all(bindings as never[]) as T[]; },
  };
  return { sqlite, db, async initialize() { await initializeDatabaseSchema(db); }, close() { sqlite.close(); } };
}

export function seedCustomer(sqlite: Database.Database, id = 'customer-1') {
  sqlite.prepare("INSERT INTO customers (id,name,customer_grade,stage,intent_level,next_follow_up_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, 'Ada', 'A', 'NEW_LEAD', 'HIGH', '2026-07-13T09:00:00Z', '2026-07-12T00:00:00Z', '2026-07-12T00:00:00Z');
}

/** SQLite transport over the production mapping/validation policy; it does not contain independent CRM business SQL. */
export function sqliteRepository(db: DatabaseLike) {
  return createCrmRepository(db, () => '2026-07-12T00:01:00.000Z');
}

export function sessionForWrite(currentNextFollowUpAt = '2026-07-13T09:00:00Z', now = '2026-07-12T00:00:00.000Z', withHost = true): SalesAgentSession {
  const snapshot: LoadedReadOnlyAgentSnapshot = { kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT', version: 'v1', snapshot_id: 'write-fixture', synthetic: false, persisted: true, load_source: 'sqlite_read_only', loaded_at: now, context: { active_profile_id: 'foreign_trade_geo', now }, customers: [{ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } }], tasks: [], work_items: [], collected_leads: [], replay_evidence: [], import_rows: [], capture_events: [], prompt_plans: [], model_invocations: [], eval_summaries: [] };
  const context = buildContextSnapshot({ snapshotId: 'write-fixture', capturedAt: now, timeWindow: { from: '2026-07-01T00:00:00.000Z', to: now }, customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: ['customer-1'] }], accounts: [], interactions: [] });
  const host: SalesAgentHost = { reason: async ({ message }) => ({ intent: /task|待办|提醒/i.test(message) ? 'CREATE_TASK_REQUEST' : /follow|跟进|2026-07-20/i.test(message) ? 'UPDATE_CUSTOMER_REQUEST' : 'CREATE_FOLLOW_UP_REQUEST', customer_id: 'customer-1', confidence: .9, provider_kind: 'DEEPSEEK_COMPATIBLE', steps: [{ tool_id: /task|待办|提醒/i.test(message) ? 'create_task' : /follow|跟进|2026-07-20/i.test(message) ? 'update_next_follow_up_time' : 'create_follow_up_record', customer_id: 'customer-1', access: 'write', requires_confirmation: true, reason: 'Explicit customer-scoped request.' }] }), capture: async () => ({ visual_facts: [] }) };
  return new SalesAgentSession('customer-1', withHost ? host : null, () => now, {
    snapshot,
    context,
    profile_id: 'foreign_trade_geo',
    loadCustomerSnapshot: async () => ({ next_follow_up_at: currentNextFollowUpAt }),
    planning_mode: 'deterministic',
  });
}

export async function proposalFor(session: SalesAgentSession, message: string) {
  const outcome = await session.submit(createAgentIntentEnvelope(message, '2026-07-14T12:00:00.000Z'));
  if (outcome.kind !== 'write_proposal') throw new Error(`Expected write proposal, got ${outcome.kind}`);
  return outcome.proposal;
}

export function confirmationFor(proposal: Awaited<ReturnType<typeof proposalFor>>) { return { proposal_id: proposal.proposal_id, proposal_hash: proposal.proposal_hash, tool_id: proposal.tool_id, customer_id: proposal.customer_id, entity_id: proposal.entity_id, payload_hash: proposal.proposal_hash, nonce: proposal.nonce!, confirmed_at: '2026-07-12T00:01:00.000Z' }; }
