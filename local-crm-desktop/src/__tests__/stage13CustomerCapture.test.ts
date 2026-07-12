import { describe, expect, it } from 'vitest';
import { createUnreviewedCapture, validateCaptureFacts } from '../lib/customerCapture/review';
const facts = [{ fact_id: 'fact-1', fact_type: 'visible_requirement', content: 'Needs sample before Friday', source_reference: 'image:1', confidence: 0.8 }];
describe('Stage13 customer capture', () => {
  it('keeps image facts bounded, customer-scoped, unreviewed and non-writing', () => expect(createUnreviewedCapture('customer-1', 'image', 'QWEN_VISION_COMPATIBLE', facts)).toMatchObject({ reviewed: false, writes_crm: false, facts }));
  it('rejects recommendations and unknown output fields', () => expect(() => validateCaptureFacts([{ ...facts[0], recommendation: 'Call now' }], 'customer-1')).toThrow('Unsafe'));
});
