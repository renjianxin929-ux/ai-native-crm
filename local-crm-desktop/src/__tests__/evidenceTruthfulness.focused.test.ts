import { describe, expect, it } from 'vitest';
import type { ModelContextEnvelope } from '../lib/productionAi/modelContextEnvelope';
import { markUngroundedAsSpeculation, validateEvidenceGrounding } from '../lib/productionAi/evidenceGrounding';

function envelope(): ModelContextEnvelope {
  return {
    request_id: 'r', intent: 'CUSTOMER_SUMMARY', customer_id: 'c1', customer_allowlist: ['c1'], portfolio_summary: null,
    selected_crm_facts: [{ customer_id: 'c1' }], recent_interactions: [], active_memory: [], relevant_tasks: [], user_instruction: '总结',
    locale: 'zh-CN', timezone: 'Asia/Shanghai', safety_mode: 'human_review_required_no_crm_write', requested_output_schema: 'customer_summary_v1', truncated_fields: [],
    evidence_map: [{ evidence_id: 'ev1', customer_id: 'c1', source_type: 'customer', source_record_id: 'c1', fact_ids: ['profile'], created_at: '2026-07-16T00:00:00Z', integrity: 'i1', summary: 'fact', truncated: false }],
  };
}

describe('evidence-truthfulness suite', () => {
  it('accepts only owned in-scope evidence and never invents or merges references', () => {
    const valid = validateEvidenceGrounding({ envelope: envelope(), cited_refs: ['ev1'], allowed_customer_ids: ['c1'] });
    expect(valid).toMatchObject({ valid: true, grounded_refs: ['ev1'], speculative_refs: [] });
    const invented = validateEvidenceGrounding({ envelope: envelope(), cited_refs: ['invented'], allowed_customer_ids: ['c1'] });
    expect(invented.valid).toBe(false);
    expect(invented.grounded_refs).toEqual([]);
    expect(validateEvidenceGrounding({ envelope: envelope(), cited_refs: [], allowed_customer_ids: ['c1'] }).valid).toBe(false);
  });

  it('rejects cross-customer evidence and ownership collision', () => {
    const base = envelope();
    const cross = { ...base, evidence_map: [{ ...base.evidence_map[0], customer_id: 'c2' }] };
    expect(validateEvidenceGrounding({ envelope: cross, cited_refs: ['ev1'], allowed_customer_ids: ['c1'] }).errors.join(' ')).toMatch(/cross-customer/);
    const original = envelope();
    const collision = { ...original, evidence_map: [...original.evidence_map, { ...original.evidence_map[0], source_record_id: 'other', integrity: 'i2' }] };
    expect(validateEvidenceGrounding({ envelope: collision, cited_refs: ['ev1'], allowed_customer_ids: ['c1'] }).errors.join(' ')).toMatch(/collision/);
  });

  it('labels unsupported inference explicitly', () => {
    expect(markUngroundedAsSpeculation('可能流失', false)).toBe('【模型推测 / 待确认】可能流失');
  });
});
