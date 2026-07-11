import { describe, expect, it } from 'vitest';

import { buildCustomerMemoryContext, loadCustomerMemoryContext } from '../lib/customerMemory';

const item = (overrides = {}) => ({
  memory_id: 'memory-1', customer_id: 'customer-1', kind: 'interaction' as const, summary: 'Customer requested a product comparison.', source_kind: 'crm_record' as const, validation_source: 'crm_record' as const, source_reference: 'interaction:1', evidence_reference: 'evidence:1', source_timestamp: '2026-07-01T00:00:00.000Z', recorded_at: '2026-07-01T00:00:00.000Z', ...overrides,
});

describe('Stage6 customer memory layer', () => {
  it('preserves source, timestamp, and evidence provenance for each historical item', () => {
    const context = buildCustomerMemoryContext({ customer_id: 'customer-1', items: [item()] });
    expect(context).toMatchObject({ kind: 'CUSTOMER_MEMORY_CONTEXT', customer_id: 'customer-1', bounded: true, read_only: true, persisted: false });
    expect(context.items[0]).toMatchObject({ source_reference: 'interaction:1', evidence_reference: 'evidence:1', source_timestamp: '2026-07-01T00:00:00.000Z' });
  });

  it('loads old facts through a reader, bounds context size, and never mutates a source', async () => {
    const source = [item({ memory_id: 'old', source_timestamp: '2020-01-01T00:00:00.000Z' }), item({ memory_id: 'new', source_reference: 'interaction:2', evidence_reference: 'evidence:2', source_timestamp: '2026-01-01T00:00:00.000Z' })];
    const before = JSON.stringify(source);
    const context = await loadCustomerMemoryContext({ customer_id: 'customer-1', reader: { async list() { return source; } }, max_items: 1, max_characters: 100 });
    expect(JSON.stringify(source)).toBe(before);
    expect(context.items).toHaveLength(1);
    expect(context.items[0].memory_id).toBe('new');
  });

  it('rejects unsupported claims, missing provenance, wrong customer, and duplicated truth sources', () => {
    expect(() => buildCustomerMemoryContext({ customer_id: 'customer-1', items: [item({ source_kind: 'unverified_ai_claim' })] })).toThrow('source kind');
    expect(() => buildCustomerMemoryContext({ customer_id: 'customer-1', items: [item({ kind: 'reasoning_summary', source_kind: 'validated_reasoning_summary', validation_source: 'validated_reasoning_summary' })] })).toThrow('human verification');
    expect(buildCustomerMemoryContext({ customer_id: 'customer-1', items: [item({ kind: 'reasoning_summary', source_kind: 'validated_reasoning_summary', validation_source: 'validated_reasoning_summary', human_verified: true })] }).items[0].human_verified).toBe(true);
    expect(() => buildCustomerMemoryContext({ customer_id: 'customer-1', items: [item({ evidence_reference: '' })] })).toThrow('evidence_reference');
    expect(() => buildCustomerMemoryContext({ customer_id: 'customer-1', items: [item({ customer_id: 'customer-2' })] })).toThrow('customer binding');
    expect(() => buildCustomerMemoryContext({ customer_id: 'customer-1', items: [item(), item({ memory_id: 'memory-2' })] })).toThrow('duplicate a truth source');
  });
});
