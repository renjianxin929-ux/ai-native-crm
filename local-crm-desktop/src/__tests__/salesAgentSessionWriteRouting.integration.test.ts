import { describe, expect, it } from 'vitest';
import { proposalFor, sessionForWrite } from './salesAgentProductionHarness';

describe('SalesAgentSession production write routing', () => {
  it('classifies natural language in the session and produces bounded proposals, never React', async () => {
    const session = sessionForWrite();
    await expect(proposalFor(session, 'Log a follow up: customer asked for pricing')).resolves.toMatchObject({ tool_id: 'create_follow_up_record', customer_id: 'customer-1', status: 'awaiting_confirmation', executable: false });
    await expect(proposalFor(sessionForWrite(), 'Create task: send pricing deck')).resolves.toMatchObject({ tool_id: 'create_task', proposed_values: { title: 'send pricing deck', status: 'OPEN' } });
    await expect(proposalFor(sessionForWrite(), 'Set next follow up to 2026-07-20 14:30')).resolves.toMatchObject({ tool_id: 'update_next_follow_up_time' });
    await expect(sessionForWrite().submit('Set next follow up sometime soon')).resolves.toMatchObject({ kind: 'clarification_required' });
  });
});
