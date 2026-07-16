import { describe, expect, it } from 'vitest';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { confirmationFor, proposalFor, seedCustomer, sessionForWrite, sqliteFixture, sqliteRepository } from './salesAgentProductionHarness';

describe('approvedCrmWriteBoundary production SQLite integration', () => {
  it('shares production repository semantics: unknown fields are ignored with zero mutation, while supported values persist', async () => {
    const fixture = sqliteFixture(); await fixture.initialize(); seedCustomer(fixture.sqlite);
    const repository = sqliteRepository(fixture.db);
    const before = fixture.sqlite.prepare('SELECT next_follow_up_at,updated_at FROM customers WHERE id=?').get('customer-1');
    await repository.updateCustomer('customer-1', { unsupported_model_field: 'blocked' });
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at,updated_at FROM customers WHERE id=?').get('customer-1')).toEqual(before);
    await repository.updateCustomer('customer-1', { next_follow_up_at: '2026-07-20T14:30Z' });
    expect(fixture.sqlite.prepare('SELECT next_follow_up_at,updated_at FROM customers WHERE id=?').get('customer-1')).toEqual({ next_follow_up_at: '2026-07-20T14:30Z', updated_at: '2026-07-12T00:01:00.000Z' });
    fixture.close();
  });
  it('uses the production CRM repository adapters for a follow-up, task, and scoped next-follow-up update', async () => {
    const fixture = sqliteFixture(); await fixture.initialize(); seedCustomer(fixture.sqlite);
    await (async () => { const approvedCrmWriteBoundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));
      for (const [message, table] of [['Log a follow up: customer asked for pricing', 'follow_up_records'], ['Create task: send pricing deck', 'tasks']] as const) {
        const session = sessionForWrite(); const proposal = await proposalFor(session, message);
        expect((fixture.sqlite.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count).toBe(0);
        const confirmation = confirmationFor(proposal); await session.confirmWrite(proposal, confirmation, approvedCrmWriteBoundary);
        await expect(session.confirmWrite(proposal, confirmation, approvedCrmWriteBoundary)).rejects.toThrow('replay');
        expect((fixture.sqlite.prepare(`SELECT count(*) count FROM ${table}`).get() as { count: number }).count).toBe(1);
      }
      const session = sessionForWrite(); const proposal = await proposalFor(session, 'Set next follow up to 2026-07-20 14:30');
      const confirmation = confirmationFor(proposal); const before = fixture.sqlite.prepare('SELECT * FROM customers WHERE id=?').get('customer-1');
      expect(proposal.current_values).toEqual({ next_follow_up_at: '2026-07-13T09:00:00Z' });
      expect(String(proposal.proposed_values.next_follow_up_at)).toMatch(/2026-07-20T14:30/);
      await session.confirmWrite(proposal, confirmation, approvedCrmWriteBoundary);
      await expect(session.confirmWrite(proposal, confirmation, approvedCrmWriteBoundary)).rejects.toThrow('replay');
      expect(String((fixture.sqlite.prepare('SELECT next_follow_up_at FROM customers WHERE id=?').get('customer-1') as { next_follow_up_at: string }).next_follow_up_at)).toMatch(/2026-07-20T14:30/);
      expect(fixture.sqlite.prepare('SELECT name,customer_grade,intent_level FROM customers WHERE id=?').get('customer-1')).toEqual({ name: (before as { name: string }).name, customer_grade: 'A', intent_level: 'HIGH' });
    })(); fixture.close();
  });
});
