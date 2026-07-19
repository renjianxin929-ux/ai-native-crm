import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import { MODEL_CONTEXT_LIMITS, buildModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';

const now = '2026-07-16T00:00:00.000Z';
function context() {
  return buildContextSnapshot({
    snapshotId: 's', capturedAt: now, timeWindow: { from: now, to: now }, accounts: [],
    customers: [
      { customerId: 'c1', name: 'One', grade: 'A', intentLevel: 'HIGH', observedAt: now, evidenceIds: ['c1-e'] },
      { customerId: 'c2', name: 'Two', grade: 'B', intentLevel: 'MEDIUM', observedAt: now, evidenceIds: ['c2-e'] },
    ],
    interactions: [
      { interactionId: 'i-null', customerId: null, kind: 'note', summary: 'global', occurredAt: now, evidenceIds: ['null-e'] },
      { interactionId: 'i1', customerId: 'c1', kind: 'note', summary: 'one', occurredAt: now, evidenceIds: ['i1-e'] },
      { interactionId: 'i2', customerId: 'c2', kind: 'note', summary: 'two', occurredAt: now, evidenceIds: ['i2-e'] },
    ],
  });
}

describe('model-context-privacy suite', () => {
  it('requires an explicit existing customer and has no customers[0] fallback', () => {
    expect(() => buildModelContextEnvelope({ request_id: 'r', intent: 'CUSTOMER_SUMMARY', output_schema: 'customer_summary_v1', user_instruction: 'x', customer_id: null, context: context() })).toThrow(/Scoped customer/);
    expect(() => buildModelContextEnvelope({ request_id: 'r', intent: 'CUSTOMER_SUMMARY', output_schema: 'customer_summary_v1', user_instruction: 'x', customer_id: 'missing', context: context() })).toThrow(/not found/);
  });

  it('excludes null and cross-customer interaction, memory and task records', () => {
    const result = buildModelContextEnvelope({
      request_id: 'r', intent: 'CUSTOMER_SUMMARY', output_schema: 'customer_summary_v1', user_instruction: 'x', customer_id: 'c1', context: context(),
      memory: { kind: 'CUSTOMER_MEMORY_CONTEXT', version: 'v1', customer_id: 'c1', bounded: true, max_items: 2, max_characters: 1000, persisted: false, read_only: true,
        items: [
          { memory_id: 'm1', customer_id: 'c1', kind: 'fact', summary: 'one', source_kind: 'crm_record', validation_source: 'crm_record', source_reference: 'm1', evidence_reference: 'm1-e', source_timestamp: now, recorded_at: now },
          { memory_id: 'm2', customer_id: 'c2', kind: 'fact', summary: 'two', source_kind: 'crm_record', validation_source: 'crm_record', source_reference: 'm2', evidence_reference: 'm2-e', source_timestamp: now, recorded_at: now },
        ] },
      tool_trace: [{ tool_id: 'list_customer_tasks', evidence_refs: [], read_only: true, writes_crm: false, records: [
        { customer_id: 'c1', task_id: 't1', title: 'one', api_key: 'nested-secret' }, { customer_id: 'c2', task_id: 't2', title: 'two' },
      ] }],
    });
    expect(result.recent_interactions).toHaveLength(1);
    expect(result.active_memory).toHaveLength(1);
    expect(result.relevant_tasks).toEqual([{ customer_id: 'c1', task_id: 't1', title: 'one' }]);
    expect(JSON.stringify(result)).not.toContain('nested-secret');
    expect(JSON.stringify(result)).not.toContain('i2-e');
  });

  it('enforces bounded compare allowlists and final UTF-8 byte cap', () => {
    expect(() => buildModelContextEnvelope({ request_id: 'r', intent: 'COMPLEX_CUSTOMER_COMPARE', output_schema: 'complex_customer_compare_v1', user_instruction: '对比', customer_id: null, customer_allowlist: ['c1'], context: context() })).toThrow(/explicit bounded/);
    const result = buildModelContextEnvelope({ request_id: 'r', intent: 'CUSTOMER_SUMMARY', output_schema: 'customer_summary_v1', user_instruction: '中'.repeat(40_000), customer_id: 'c1', context: context(), portfolio_summary: '数'.repeat(20_000) });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(MODEL_CONTEXT_LIMITS.max_request_json_bytes);
  });
});
