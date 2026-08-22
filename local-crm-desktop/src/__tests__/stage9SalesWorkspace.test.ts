import { describe, expect, it } from 'vitest';
import { CUSTOMER_CAPTURE_CONTRACT } from '../lib/salesWorkspace/customerCaptureContract';
import { buildCustomerScopedSalesAgentEntry, buildCustomerTimeline, describeCustomerContext } from '../lib/salesWorkspace/customerIntelligence';
import { buildSalesBrief } from '../lib/salesWorkspace/salesBrief';

describe('Stage 9 AI Native Sales Workspace projections', () => {
  it('unifies existing follow-up and visit records without mutating them', () => {
    const timeline = buildCustomerTimeline([
      { id: 'follow-up-1', customer_id: 'customer-1', title: 'Phone follow-up', contact_channel: 'phone', contact_result: null, feedback_notes: 'Requested a proposal', intent_assessment: null, suggested_grade: null, next_action: null, next_follow_up_at: null, is_completed: 1, created_at: '2026-07-10T09:00:00.000Z', updated_at: '2026-07-10T09:00:00.000Z' },
    ], [
      { id: 'visit-1', customer_id: 'customer-1', title: 'Discovery meeting', visited_at: '2026-07-11T09:00:00.000Z', visit_notes: 'Discussed priorities', customer_concerns: null, intent_after_visit: null, visit_outcome: null, next_action: null, expected_contract_at: null, created_at: '2026-07-11T09:00:00.000Z', updated_at: '2026-07-11T09:00:00.000Z' },
    ]);

    expect(timeline.map(item => item.kind)).toEqual(['meeting', 'call']);
    expect(timeline.every(item => item.evidenceId.length > 0)).toBe(true);
  });

  it('declares capture support without implementing processing', () => {
    expect(Object.keys(CUSTOMER_CAPTURE_CONTRACT)).toEqual(['text', 'image', 'document']);
    expect(Object.values(CUSTOMER_CAPTURE_CONTRACT).every(item => item.processing === 'future_pipeline_only')).toBe(true);
  });

  it('labels the customer understanding as a projection of existing CRM context', () => {
    const customer = { customer_grade: 'A', stage: 'CONTACTED', intent_level: 'HIGH' } as Parameters<typeof describeCustomerContext>[0];
    const context = describeCustomerContext(customer, [{ id: 'follow-up-1', kind: 'call', occurredAt: '2026-07-11T09:00:00.000Z', title: 'Phone follow-up', detail: 'Requested a proposal', evidenceId: 'follow-up-1' }]);

    expect(context).toContain('A类客户');
    expect(context).toContain('Phone follow-up');
  });

  it('builds a daily brief only from existing priority, risk, action, evidence, and applied insight data', () => {
    const customer = { id: 'customer-1', customer_grade: 'A', intent_level: 'HIGH', industry: 'Logistics', next_action: 'CONTACT_AGAIN', last_contacted_at: null, next_follow_up_at: '2026-07-12T09:00:00.000Z' } as Parameters<typeof buildSalesBrief>[0][number];
    const brief = buildSalesBrief([customer], [customer], [{ customer_id: 'customer-1', status: 'APPLIED' } as Parameters<typeof buildSalesBrief>[2][number]]);

    expect(brief[0]).toMatchObject({ risk: '长期未触达，需要人工确认风险', opportunity: 'Logistics · 高意向', nextAction: '再触达', existingInsightCount: 1 });
    expect(brief[0].evidenceReferences).toContain('customer:customer-1');
  });

  it('prepares a customer-scoped Sales Agent handoff without running reasoning', () => {
    const customer = { id: 'customer-1' } as Parameters<typeof buildCustomerScopedSalesAgentEntry>[0];
    const entry = buildCustomerScopedSalesAgentEntry(customer, [{ id: 'memory-1' } as Parameters<typeof buildCustomerScopedSalesAgentEntry>[1][number]], [{ evidenceId: 'follow-up-1' } as Parameters<typeof buildCustomerScopedSalesAgentEntry>[2][number]]);

    expect(entry).toEqual(expect.objectContaining({ kind: 'CUSTOMER_SCOPED_SALES_AGENT_ENTRY', customer_id: 'customer-1', context_snapshot_reference: 'customer:customer-1:on-demand', active_memory_ids: ['memory-1'], timeline_evidence_ids: ['follow-up-1'] }));
  });
});
