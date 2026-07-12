import { describe, expect, it } from 'vitest';
import { deterministicSemanticFallback, validateSemanticPlan } from '../lib/salesAgentTools/semanticPlanning';

const valid = { intent: 'CUSTOMER_SUMMARY', customer_id: 'customer-1', confidence: 0.9, provider_kind: 'DEEPSEEK_COMPATIBLE', steps: [{ tool_id: 'get_customer', customer_id: 'customer-1', access: 'read', requires_confirmation: false, reason: 'Customer record is needed.' }] };
describe('Stage11 semantic planning', () => {
  it('accepts only closed intents, registered tools, bounded plans and current customer scope', () => {
    expect(validateSemanticPlan(valid, 'customer-1')).toMatchObject({ execution_mode: 'live_model', executable: false, writes_crm: false });
    expect(() => validateSemanticPlan({ ...valid, intent: 'RUN_SHELL' }, 'customer-1')).toThrow('Unknown');
    expect(() => validateSemanticPlan({ ...valid, steps: [...valid.steps, ...valid.steps, ...valid.steps, ...valid.steps, ...valid.steps, ...valid.steps] }, 'customer-1')).toThrow('one to five');
    expect(() => validateSemanticPlan({ ...valid, customer_id: 'customer-2' }, 'customer-1')).toThrow('scope');
  });
  it('labels deterministic fallback truthfully and permits no action', () => expect(deterministicSemanticFallback('customer-1')).toMatchObject({ intent: 'SAFE_FALLBACK', provider_kind: 'DETERMINISTIC_FALLBACK', execution_mode: 'deterministic_fallback', executable: false, writes_crm: false }));
});
