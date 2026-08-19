import { describe, expect, it } from 'vitest';
import { buildContextSnapshot } from '../lib/context/contextBuilder';
import {
  MODEL_CONTEXT_LIMITS,
  assertEnvelopeHasNoSecrets,
  buildModelContextEnvelope,
} from '../lib/productionAi/modelContextEnvelope';

describe('model-context-envelope suite', () => {
  const context = buildContextSnapshot({
    snapshotId: 'snap-1',
    capturedAt: '2026-07-16T00:00:00.000Z',
    timeWindow: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-16T00:00:00.000Z' },
    customers: [{ customerId: 'customer-1', name: 'Ada', grade: 'A', intentLevel: 'HIGH', observedAt: '2026-07-16T00:00:00.000Z', evidenceIds: ['customer-1'] }],
    accounts: [],
    interactions: Array.from({ length: 30 }, (_, index) => ({
      interactionId: `i-${index}`,
      customerId: 'customer-1',
      kind: 'task' as const,
      summary: `interaction ${index} ${'x'.repeat(500)}`,
      occurredAt: '2026-07-16T00:00:00.000Z',
      evidenceIds: [`ev-${index}`],
    })),
  });

  it('minimizes interactions, memory, and evidence with truncation markers', () => {
    const envelope = buildModelContextEnvelope({
      request_id: 'req-1',
      intent: 'CUSTOMER_SUMMARY',
      output_schema: 'customer_summary_v1',
      user_instruction: '总结客户',
      customer_id: 'customer-1',
      context,
      memory: {
        kind: 'CUSTOMER_MEMORY_CONTEXT',
        version: 'v1',
        customer_id: 'customer-1',
        items: Array.from({ length: 15 }, (_, index) => ({
          memory_id: `m-${index}`,
          customer_id: 'customer-1',
          kind: 'fact' as const,
          summary: `memory ${index}`,
          source_kind: 'crm_record' as const,
          validation_source: 'crm_record' as const,
          source_reference: `ref-${index}`,
          evidence_reference: `ev-${index}`,
          source_timestamp: '2026-07-16T00:00:00.000Z',
          recorded_at: '2026-07-16T00:00:00.000Z',
        })),
        bounded: true,
        max_items: 15,
        max_characters: 10000,
        persisted: false,
        read_only: true,
      },
    });
    expect(envelope.recent_interactions.length).toBeLessThanOrEqual(MODEL_CONTEXT_LIMITS.max_recent_interactions);
    expect(envelope.active_memory.length).toBeLessThanOrEqual(MODEL_CONTEXT_LIMITS.max_active_memory);
    expect(envelope.truncated_fields).toEqual(expect.arrayContaining(['recent_interactions', 'active_memory']));
    expect(envelope.safety_mode).toBe('human_review_required_no_crm_write');
    assertEnvelopeHasNoSecrets(envelope);
  });

  it('rejects denied sensitive material', () => {
    expect(() => assertEnvelopeHasNoSecrets({
      request_id: 'r',
      intent: 'CUSTOMER_SUMMARY',
      customer_id: 'c',
      customer_allowlist: ['c'],
      portfolio_summary: null,
      selected_crm_facts: [{ api_key: 'secret' }],
      recent_interactions: [],
      active_memory: [],
      relevant_tasks: [],
      evidence_map: [],
      user_instruction: 'x',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      safety_mode: 'human_review_required_no_crm_write',
      requested_output_schema: 'customer_summary_v1',
      output_schema_spec: '',
      reasoning_task_instruction: '',
      truncated_fields: [],
    })).toThrow(/denied field/);
  });
});
