import { describe, expect, it } from 'vitest';
import { consumeExactConfirmation, validateAgentWriteProposal, type AgentWriteProposal } from '../lib/salesAgentTools/confirmedWrite';
const proposal: AgentWriteProposal = { proposal_id: 'proposal-1', proposal_hash: 'hash-1', tool_id: 'update_customer_basic_fields', customer_id: 'customer-1', entity_type: 'customer', entity_id: 'customer-1', operation: 'update', current_values: { industry: 'Old' }, proposed_values: { industry: 'New' }, reason: 'User requested it.', evidence_refs: ['customer-1'], reversible: true, nonce: 'once-1', created_at: '2026-07-12T00:00:00Z', status: 'awaiting_confirmation', executable: false };
describe('Stage12 exact confirmation', () => {
  it('requires an exact one-time confirmation before a caller can reach a write boundary', () => {
    expect(consumeExactConfirmation(proposal, { proposal_id: 'proposal-1', proposal_hash: 'hash-1', tool_id: 'update_customer_basic_fields', customer_id: 'customer-1', entity_id: 'customer-1', payload_hash: 'hash-1', nonce: 'once-1', confirmed_at: '2026-07-12T00:00:01Z' })).toMatchObject({ confirmation_id: 'once-1' });
    expect(() => consumeExactConfirmation(proposal, { proposal_id: 'proposal-1', proposal_hash: 'hash-1', tool_id: 'update_customer_basic_fields', customer_id: 'customer-1', entity_id: 'customer-1', payload_hash: 'hash-1', nonce: 'once-1', confirmed_at: '2026-07-12T00:00:01Z' })).toThrow('replay');
    expect(() => consumeExactConfirmation(proposal, { proposal_id: 'proposal-1', proposal_hash: 'bad', tool_id: 'update_customer_basic_fields', customer_id: 'customer-1', entity_id: 'customer-1', payload_hash: 'bad', nonce: 'once-1', confirmed_at: '2026-07-12T00:00:01Z' })).toThrow('replay');
  });
  it('rejects model-supplied unsafe fields before confirmation', () => expect(() => validateAgentWriteProposal({ ...proposal, proposed_values: { role: 'admin' } })).toThrow('forbidden'));
});
