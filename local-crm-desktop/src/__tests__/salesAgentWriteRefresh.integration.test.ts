import { describe, expect, it, vi } from 'vitest';
import { confirmSalesAgentProposal } from '../lib/salesAgentTools/confirmSalesAgentProposal';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { buildCustomerTimeline } from '../lib/salesWorkspace/customerIntelligence';
import { proposalFor, seedCustomer, sessionForWrite, sqliteFixture, sqliteRepository } from './salesAgentProductionHarness';

describe('Sales Agent write refresh integration', () => {
  it('rereads the same refresh projections for follow-up, task, and next-follow-up once each without another ask or provider call', async () => {
    const fixture = sqliteFixture(); await fixture.initialize(); seedCustomer(fixture.sqlite); const boundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));
    const cases = [
      { message: 'Log a follow up: customer asked for pricing', refresh: () => fixture.sqlite.prepare('SELECT title,customer_id FROM follow_up_records WHERE customer_id=?').all('customer-1'), expected: [{ title: '跟进记录', customer_id: 'customer-1' }] },
      { message: 'Create task: send pricing deck', refresh: () => fixture.sqlite.prepare('SELECT title,status,customer_id FROM tasks WHERE customer_id=?').all('customer-1'), expected: [{ title: 'send pricing deck', status: 'OPEN', customer_id: 'customer-1' }] },
      { message: 'Set next follow up to 2026-07-20 14:30', refresh: () => fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1'), expected: { next_follow_up_at: expect.stringMatching(/2026-07-20T14:30/) } },
    ] as const;
    for (const item of cases) { const session = sessionForWrite(); const proposal = await proposalFor(session, item.message); const ask = vi.spyOn(session, 'ask'); const refresh = vi.fn(async () => item.refresh()); await confirmSalesAgentProposal(session, proposal, refresh, boundary); expect(refresh).toHaveBeenCalledTimes(1); expect(await refresh.mock.results[0].value).toEqual(item.expected); expect(ask).not.toHaveBeenCalled(); expect(session.messages).toHaveLength(0); }
    fixture.close();
  });

  it('persists the complete follow-up shape and projects it into the customer timeline with its source evidence', async () => {
    const fixture = sqliteFixture(); await fixture.initialize(); seedCustomer(fixture.sqlite);
    const session = sessionForWrite(); const proposal = await proposalFor(session, 'Log a follow up: customer asked for pricing');
    await confirmSalesAgentProposal(session, proposal, async () => undefined, createApprovedCrmWriteBoundary(sqliteRepository(fixture.db)));
    const row = fixture.sqlite.prepare('SELECT id,customer_id,title,feedback_notes,next_follow_up_at,is_completed,created_at,updated_at FROM follow_up_records WHERE customer_id=?').get('customer-1') as { id: string; customer_id: string; title: string; feedback_notes: string; next_follow_up_at: string | null; is_completed: number; created_at: string; updated_at: string };
    expect(row).toMatchObject({ customer_id: 'customer-1', title: '跟进记录', feedback_notes: 'customer asked for pricing', next_follow_up_at: null, is_completed: 1 });
    expect(row.id).toBeTruthy(); expect(Date.parse(row.created_at)).toBeTruthy(); expect(Date.parse(row.updated_at)).toBeTruthy();
    const timeline = buildCustomerTimeline([{ id: row.id, customer_id: row.customer_id, title: row.title, contact_channel: null, contact_result: null, feedback_notes: row.feedback_notes, intent_assessment: null, suggested_grade: null, next_action: null, next_follow_up_at: row.next_follow_up_at, is_completed: row.is_completed, created_at: row.created_at, updated_at: row.updated_at }], []);
    expect(timeline).toEqual([expect.objectContaining({ title: '跟进记录', detail: 'customer asked for pricing', evidenceId: row.id })]);
    fixture.close();
  });
});
