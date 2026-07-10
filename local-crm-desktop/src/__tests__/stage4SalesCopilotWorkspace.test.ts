import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SalesCopilotPanel } from '../components/aiNative/SalesCopilotPanel';
import { STAGE2_EVALUATION_FIXTURES } from '../lib/eval/fixtures';
import { createMockReasoningProvider } from '../lib/salesAgent/provider';
import { runSalesCopilotWorkflow } from '../lib/salesCopilot/workflow';
import { buildBoundedWorkspaceSalesPriority, MAX_WORKSPACE_PRIORITY_CANDIDATES } from '../lib/salesCopilot/workspacePriority';

describe('Stage4 Copilot workspace projection', () => {
  it('presents coherent read-only customer and priority workflows without execution affordances', async () => {
    const fixture = STAGE2_EVALUATION_FIXTURES[0];
    const provider = createMockReasoningProvider();
    const customer = await runSalesCopilotWorkflow({ kind: 'customer_intelligence', request_id: 'customer', context: fixture.context, profile_id: fixture.profile.identity.id, provider });
    const priority = await runSalesCopilotWorkflow({ kind: 'sales_priority', request_id: 'priority', contexts: [fixture.context], profile_id: fixture.profile.identity.id, provider });
    const markup = renderToStaticMarkup(createElement(SalesCopilotPanel, { results: [customer, priority] }));
    expect(markup).toContain('Customer Intelligence');
    expect(markup).toContain('Sales Priority');
    expect(markup).toContain('Mock reasoning');
    expect(markup).toContain('Human review required');
    expect(markup).toContain('Not executable');
    expect(markup).toContain('No CRM write');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('Apply to CRM');
  });

  it('loads a bounded multi-customer queue and ranks it deterministically through runtime traces', async () => {
    const customerIds = Array.from({ length: MAX_WORKSPACE_PRIORITY_CANDIDATES + 2 }, (_, index) => `candidate-${index + 1}`);
    const loadCalls: string[] = [];
    const load = async (customerId: string) => {
      loadCalls.push(customerId);
      const fixture = STAGE2_EVALUATION_FIXTURES[loadCalls.length % STAGE2_EVALUATION_FIXTURES.length];
      return {
        ...fixture.context,
        snapshotId: `snapshot:${customerId}`,
        customers: [{ ...fixture.context.customers[0], customerId, name: `Customer ${customerId}`, evidenceIds: [`evidence:${customerId}`] }],
        evidenceIdentifiers: [`evidence:${customerId}`],
        accounts: [],
        recentInteractions: [],
      };
    };
    const request = { request_id: 'workspace-priority', customer_ids: customerIds, profile_id: 'feishu_saas', provider: createMockReasoningProvider(), load_read_only_context: load, clock: () => '2026-07-11T00:00:00.000Z' } as const;
    const first = await buildBoundedWorkspaceSalesPriority(request);
    loadCalls.length = 0;
    const second = await buildBoundedWorkspaceSalesPriority(request);
    expect(first.items).toHaveLength(MAX_WORKSPACE_PRIORITY_CANDIDATES);
    expect(loadCalls).toEqual(customerIds.slice(0, MAX_WORKSPACE_PRIORITY_CANDIDATES));
    expect(second.items.map(item => item.customer_id)).toEqual(first.items.map(item => item.customer_id));
    expect(first.items.every(item => item.runtime.trace.some(step => step.step === 'human_review'))).toBe(true);
    expect(first.items.every(item => item.selected_profile_id === 'feishu_saas')).toBe(true);
    expect(first.items.every(item => item.priority_reason_evidence_ids.length > 0)).toBe(true);
  });
});
