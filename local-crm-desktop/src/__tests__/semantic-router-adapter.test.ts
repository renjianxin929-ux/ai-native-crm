import { describe, expect, it, vi } from 'vitest';
import { createSemanticIntentRouter, validateSemanticIntentResponse } from '../lib/productionAi/semanticIntentRouter';
import { createAgentIntentEnvelope } from '../lib/salesAgentTools/agentIntentEnvelope';

describe('semantic-router-adapter', () => {
  it('uses the formal host capability and accepts only semantic_intent_v1 non-action slots', async () => {
    const host = vi.fn(async () => ({
      intent: 'FOLLOW_UP_DRAFT', confidence: 0.91, customer_reference: null,
      required_capability: 'TEXT_REASONING', clarification_question: null,
      extracted_nonwrite_slots: { tone: 'warm' },
    }));
    const route = await createSemanticIntentRouter(host)('替我回一句但别太销售', 'envelope-1');
    expect(host).toHaveBeenCalledWith(expect.objectContaining({ capability: 'SEMANTIC_INTENT_ROUTING', schema: 'semantic_intent_v1', envelope_id: 'envelope-1' }));
    const envelope = createAgentIntentEnvelope('替我回一句但别太销售', '2026-07-16T00:00:00Z', { semantic_resolution: route });
    expect(envelope).toMatchObject({ intent: 'FOLLOW_UP_DRAFT', parser_source: 'trusted_host_semantic_intent_v1' });
  });

  it('rejects tools, SQL, write payloads and executable action fields by closed schema', () => {
    const base = { intent: 'CUSTOMER_SUMMARY', confidence: 0.8, customer_reference: null, required_capability: 'TEXT_REASONING', clarification_question: null, extracted_nonwrite_slots: {} };
    for (const extra of ['tool_id', 'sql', 'write_payload', 'proposal', 'executable_action']) {
      expect(() => validateSemanticIntentResponse({ ...base, [extra]: 'forbidden' })).toThrow(/closed schema/);
    }
  });
});
