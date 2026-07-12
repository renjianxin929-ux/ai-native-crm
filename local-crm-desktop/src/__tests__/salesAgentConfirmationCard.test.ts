import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proposalFor, sessionForWrite } from './salesAgentProductionHarness';

describe('Sales Agent confirmation card', () => {
  it('renders the production card with exact customer, entity, values, evidence, and controls', async () => {
    const session = sessionForWrite(); const proposal = await proposalFor(session, 'Log a follow up: customer asked for pricing');
    expect(proposal).toMatchObject({ customer_id: 'customer-1', entity_type: 'follow_up', operation: 'create', reason: 'Explicit user request' });
    const source = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
    for (const text of ['Customer/entity:', 'Operation:', 'Current:', 'Proposed:', 'Reason:', 'Evidence:', 'Reversible:', '>Confirm<', '>Cancel<']) expect(source).toContain(text);
    expect(source).toContain('confirmSalesAgentProposal(session, proposal, onRefresh)');
    expect(source).toContain('onClick={() => setProposal(null)}');
  });
});
