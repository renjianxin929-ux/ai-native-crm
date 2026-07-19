import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { proposalFor, sessionForWrite } from './salesAgentProductionHarness';

describe('Sales Agent confirmation card', () => {
  it('renders the production card with exact customer, entity, values, evidence, and controls', async () => {
    const session = sessionForWrite();
    const proposal = await proposalFor(session, 'Log a follow up: customer asked for pricing');
    expect(proposal).toMatchObject({
      customer_id: 'customer-1',
      entity_type: 'follow_up',
      operation: 'create',
      reason: '用户本次明确指令',
    });
    const source = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
    for (const text of ['客户：', '操作：', '当前：', '建议：', '原因：', '依据：', '可回滚：', '确认新增', '取消']) {
      expect(source).toContain(text);
    }
    expect(source).toContain('confirmSalesAgentProposal(session, confirmedProposal, async () =>');
    expect(source).toContain('cancelProposal');
  });
});
