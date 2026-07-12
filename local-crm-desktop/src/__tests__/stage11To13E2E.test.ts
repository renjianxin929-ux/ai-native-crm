import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { SqliteCrmEvidenceResolver, SqliteMemoryRepository, buildCustomerMemoryContext } from '../lib/customerMemory';
import { SalesAgentSession } from '../lib/salesAgentTools/agentSession';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { editFact, setFactReview } from '../lib/customerCapture/review';
import { confirmationFor, seedCustomer, sqliteFixture, sqliteRepository } from './salesAgentProductionHarness';

const snapshot = { kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT', version: 'v1', snapshot_id: 'stage13', synthetic: false, persisted: true, load_source: 'sqlite_read_only', loaded_at: '2026-07-12T00:00:00.000Z', context: { active_profile_id: 'foreign_trade_geo', now: '2026-07-12T00:00:00.000Z' }, customers: [{ id: 'customer-1', name: 'Ada', customer_grade: 'A', intent_level: 'HIGH', evidence_ref: { type: 'customer', id: 'customer-1', label: 'Ada', synthetic: false, persisted: true } }], tasks: [], work_items: [], collected_leads: [], replay_evidence: [], import_rows: [], capture_events: [], prompt_plans: [], model_invocations: [], eval_summaries: [] } as const;
const context = buildContextSnapshot({ snapshotId: 'stage13-snapshot', capturedAt: '2026-07-12T00:00:00.000Z', timeWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-12T00:00:00.000Z' }, customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: '2026-07-12T00:00:00.000Z', evidenceIds: ['customer-1'] }], accounts: [], interactions: [] });
const dependencies = { snapshot, context, profile_id: 'foreign_trade_geo', memory: buildCustomerMemoryContext({ customer_id: 'customer-1', items: [] }), loadCustomerSnapshot: async () => ({ next_follow_up_at: '2026-07-13T09:00:00Z' }) };
const host = { reason: async ({ message }: { message: string }) => ({ intent: /follow|2026-07-20/i.test(message) ? 'UPDATE_CUSTOMER_REQUEST' : 'CUSTOMER_RISK_ANALYSIS', customer_id: 'customer-1', confidence: .8, provider_kind: 'DEEPSEEK_COMPATIBLE', steps: [{ tool_id: /follow|2026-07-20/i.test(message) ? 'update_next_follow_up_time' : 'get_active_memory', customer_id: 'customer-1', access: /follow|2026-07-20/i.test(message) ? 'write' : 'read', requires_confirmation: /follow|2026-07-20/i.test(message), reason: 'Bounded registered operation.' }] }), capture: async () => ({ visual_facts: [{ fact_id: 'f1', fact_type: 'visible_requirement', content: 'Set next follow up to 2026-07-20 14:30', source_reference: 'image:1', confidence: .8 }] }) };

describe('Stage11-13 production session integration', () => {
  it('captures, reviews, creates a session-owned proposal, confirms once, refreshes the projection, and does not rerun reasoning', async () => {
    const fixture = sqliteFixture(); await fixture.initialize(); seedCustomer(fixture.sqlite);
    const session = new SalesAgentSession('customer-1', host, () => '2026-07-12T00:00:00.000Z', dependencies);
    const reviewed = setFactReview(await session.capture('text', 'selection'), 'f1', 'accepted');
    const proposal = await session.createProposalFromReviewedFacts(reviewed);
    expect(proposal).toMatchObject({ tool_id: 'update_next_follow_up_time', customer_id: 'customer-1', current_values: { next_follow_up_at: '2026-07-13T09:00:00Z' }, proposed_values: { next_follow_up_at: '2026-07-20T14:30Z' } });
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1')).toEqual({ next_follow_up_at: '2026-07-13T09:00:00Z' });
    const refresh = vi.fn(async () => fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1'));
    await session.confirmWrite(proposal, confirmationFor(proposal), createApprovedCrmWriteBoundary(sqliteRepository(fixture.db))); await refresh();
    expect(refresh).toHaveBeenCalledTimes(1); expect(await refresh.mock.results[0].value).toEqual({ next_follow_up_at: '2026-07-20T14:30Z' }); expect(session.messages).toHaveLength(0);
    await expect(session.confirmWrite(proposal, confirmationFor(proposal), createApprovedCrmWriteBoundary(sqliteRepository(fixture.db)))).rejects.toThrow('replay'); fixture.close();
  });

  it('reads Memory Candidates back from real SQLite: pending/rejected remain absent, accepted/edited remain candidate-only and idempotent', async () => {
    const fixture = sqliteFixture(); await fixture.initialize(); seedCustomer(fixture.sqlite);
    const repository = new SqliteMemoryRepository(fixture.db, new SqliteCrmEvidenceResolver(fixture.db), () => '2026-07-12T00:00:00.000Z');
    const session = new SalesAgentSession('customer-1', host, () => '2026-07-12T00:00:00.000Z', { ...dependencies, memory_repository: repository });
    const pending = await session.capture('text', 'selection'); await session.persistReviewedFacts(pending); expect(await repository.listCustomerMemory('customer-1')).toHaveLength(0);
    const accepted = setFactReview(pending, 'f1', 'accepted'); await session.persistReviewedFacts(accepted); await session.persistReviewedFacts(accepted);
    const edited = editFact(accepted, 'f1', 'Set next follow up to 2026-07-20 14:30 after review'); await session.persistReviewedFacts(edited);
    await session.persistReviewedFacts(setFactReview(pending, 'f1', 'rejected'));
    const stored = await repository.listCustomerMemory('customer-1'); expect(stored).toHaveLength(2);
    expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ customer_id: 'customer-1', content: accepted.facts[0].reviewed_content, source_reference: 'image:1', validation_status: 'CANDIDATE', human_verified: false, evidence: [expect.objectContaining({ evidence_type: 'CUSTOMER', evidence_id: 'customer-1' })] }), expect.objectContaining({ content: 'Set next follow up to 2026-07-20 14:30 after review', validation_status: 'CANDIDATE' })])); expect(stored.some(entry => entry.validation_status === 'ACTIVE')).toBe(false); fixture.close();
  });

  it('keeps the UI routing-free and uses no fake write executor as persistence evidence', () => {
    const ui = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8'); expect(ui).toContain('session.createProposalFromReviewedFacts'); expect(ui).toContain('Current:'); expect(ui).not.toContain('createWriteProposal');
  });
});
