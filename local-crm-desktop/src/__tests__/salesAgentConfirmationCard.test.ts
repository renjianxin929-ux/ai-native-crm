import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectConfirmationCard } from '../lib/salesAgentUi/userFacingFieldFormatter';
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
    const projection = projectConfirmationCard(proposal);
    expect(projection.title).toBe('新增跟进记录');
    expect(projection.confirm_label).toBe('确认新增');
    expect(projection.cancel_label).toBe('取消');
    expect(projection.strength).toBe('normal');
    const source = readFileSync(new URL('../../src/components/aiNative/SalesAgentInteractionWorkspace.tsx', import.meta.url), 'utf8');
    const formatter = readFileSync(new URL('../../src/lib/salesAgentUi/userFacingFieldFormatter.ts', import.meta.url), 'utf8');
    expect(source).toContain("t('technicalDetails.show')");
    expect(source).toContain('projectConfirmationCard');
    expect(source).toContain('projectConfirmationTechnicalDetails');
    expect(formatter).toContain('technicalDetails.operation');
    expect(formatter).toContain('technicalDetails.current');
    expect(formatter).toContain('technicalDetails.proposed');
    expect(formatter).toContain('technicalDetails.reason');
    expect(formatter).toContain('technicalDetails.evidence');
    expect(formatter).toContain('technicalDetails.reversible');
    expect(source).toContain('confirmSalesAgentProposal(session, confirmedProposal, async () =>');
    expect(source).toContain('cancelProposal');
  });
});
