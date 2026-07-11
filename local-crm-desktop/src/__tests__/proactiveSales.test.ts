import { describe, expect, it } from 'vitest';

import { buildProactiveSalesSuggestionDraft, observeSalesEvents } from '../lib/proactiveSales';

const event = (overrides = {}) => ({ event_id: 'event-1', customer_id: 'customer-1', kind: 'customer_inactive' as const, occurred_at: '2026-07-11T00:00:00.000Z', evidence_reference: 'interaction:1', summary: 'No documented interaction in the configured time window.', ...overrides });

describe('Stage7 proactive sales agent foundation', () => {
  it('converts supported, evidence-backed events into read-only observations', () => {
    const observations = observeSalesEvents([event(), event({ event_id: 'event-2', kind: 'behavior_changed', evidence_reference: 'customer:1' })]);
    expect(observations.map(item => item.category)).toEqual(['customer_inactive', 'behavior_changed']);
    expect(observations[0]).toMatchObject({ requires_human_review: true, executable: false, writes_crm: false, persisted: false });
  });

  it('creates a suggestion draft without invoking reasoning or creating an action', () => {
    const draft = buildProactiveSalesSuggestionDraft(observeSalesEvents([event()])[0]);
    expect(draft).toMatchObject({ reasoning_activation: 'manual_required', human_review_required: true, executable: false, writes_crm: false, creates_task: false, sends_message: false, persisted: false });
  });

  it('rejects invalid event provenance and duplicate events', () => {
    expect(() => observeSalesEvents([event({ evidence_reference: '' })])).toThrow('evidence_reference');
    expect(() => observeSalesEvents([event(), event()])).toThrow('Duplicate');
  });
});
