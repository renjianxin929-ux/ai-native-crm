import { describe, expect, it } from 'vitest';
import { createApprovedCrmWriteBoundary } from '../lib/salesAgentTools/approvedCrmWriteBoundary';
import { confirmationFor, proposalFor, seedCustomer, sessionForWrite, sqliteFixture, sqliteRepository } from './salesAgentProductionHarness';

describe('confirmation replay and mismatch production integration', () => {
  it('rejects cancel, replay, modified payload, wrong customer/tool/entity, unknown proposal, and unsupported fields without a write', async () => {
    const fixture = sqliteFixture(); await fixture.initialize(); seedCustomer(fixture.sqlite);
    await (async () => { const approvedCrmWriteBoundary = createApprovedCrmWriteBoundary(sqliteRepository(fixture.db));
      const session = sessionForWrite(); const proposal = await proposalFor(session, 'Log a follow up: customer asked for pricing'); const confirmation = confirmationFor(proposal);
      expect((fixture.sqlite.prepare('SELECT count(*) count FROM follow_up_records').get() as { count: number }).count).toBe(0); // cancel means no call
      await expect(session.confirmWrite({ ...proposal, proposed_values: { title: 'tampered' } }, confirmation, approvedCrmWriteBoundary)).rejects.toThrow('modified');
      await expect(session.confirmWrite(proposal, { ...confirmation, customer_id: 'other' }, approvedCrmWriteBoundary)).rejects.toThrow('match');
      await expect(session.confirmWrite(proposal, { ...confirmation, tool_id: 'create_task' }, approvedCrmWriteBoundary)).rejects.toThrow('match');
      const updateSession = sessionForWrite(); const update = await proposalFor(updateSession, 'Set next follow up to 2026-07-20 14:30');
      await expect(updateSession.confirmWrite(update, { ...confirmationFor(update), entity_id: 'wrong-customer' }, approvedCrmWriteBoundary)).rejects.toThrow('match');
      await session.confirmWrite(proposal, confirmation, approvedCrmWriteBoundary);
      await expect(session.confirmWrite(proposal, confirmation, approvedCrmWriteBoundary)).rejects.toThrow('replay');
      await expect(sessionForWrite().confirmWrite(proposal, confirmation, approvedCrmWriteBoundary)).rejects.toThrow('Unknown');
      expect((fixture.sqlite.prepare('SELECT count(*) count FROM follow_up_records').get() as { count: number }).count).toBe(1);
    })(); fixture.close();
  });
});
