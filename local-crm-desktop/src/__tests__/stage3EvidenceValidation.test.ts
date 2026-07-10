import { describe, expect, it } from 'vitest';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';
import { validateSalesAgentReasoningResult } from '../lib/salesAgent/validation';

describe('Stage3 evidence validation', () => {
  it('rejects fake, missing, and undeclared evidence for important judgments', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const provider = createMockReasoningProvider();
    const candidate = await provider.reason({ request_id: 'e1', objective: 'Assess', context: fixture.context, vertical_profile: fixture.profile, generated_at: '2026-07-11T00:00:00.000Z', safety: { allow_network: false, allow_environment_read: false, allow_database_write: false, allow_crm_action: false } });
    const fake = { ...(candidate as object), customer_summary: { value: 'Unsupported', evidence_ids: ['fake:evidence'] } };
    expect(validateSalesAgentReasoningResult(fake, fixture.context)).toMatchObject({ valid: false });
    const missing = { ...(candidate as object), next_actions: [{ id: 'n', summary: 'Unsupported', evidence_ids: [] }] };
    expect(validateSalesAgentReasoningResult(missing, fixture.context)).toMatchObject({ valid: false });
    const wrongFact = {
      ...(candidate as object),
      evidence: (candidate as { evidence: readonly object[] }).evidence.map((item, index) => index === 0 ? { ...item, fact_type: 'account', fact_id: 'invented-account' } : item),
    };
    expect(validateSalesAgentReasoningResult(wrongFact, fixture.context).errors.some(error => error.includes('does not trace'))).toBe(true);
  });
});
