import type { ProactiveSalesSuggestionDraft, SalesObservation, SalesObservationEvent } from './types';

/** Observations are deterministic, read-only inputs; they never invoke a model. */
export function observeSalesEvents(events: readonly SalesObservationEvent[]): readonly SalesObservation[] {
  const ids = new Set<string>();
  return events.map((event): SalesObservation => {
    const eventId = text(event.event_id, 'event_id');
    if (ids.has(eventId)) throw new Error(`Duplicate sales observation event: ${eventId}.`);
    ids.add(eventId);
    const occurred = Date.parse(event.occurred_at);
    if (!Number.isFinite(occurred)) throw new Error('Sales observation event must have a timestamp.');
    if (!['customer_inactive', 'interaction_observed', 'behavior_changed', 'evidence_added'].includes(event.kind)) throw new Error('Sales observation event kind is unsupported.');
    return { kind: 'PROACTIVE_SALES_OBSERVATION', version: 'v1', observation_id: `observation:${eventId}`, customer_id: text(event.customer_id, 'customer_id'), category: event.kind, occurred_at: new Date(occurred).toISOString(), evidence_reference: text(event.evidence_reference, 'evidence_reference'), summary: text(event.summary, 'summary'), requires_human_review: true, executable: false, writes_crm: false, persisted: false };
  }).toSorted((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
}

export function buildProactiveSalesSuggestionDraft(observation: SalesObservation): ProactiveSalesSuggestionDraft {
  return { kind: 'PROACTIVE_SALES_SUGGESTION_DRAFT', version: 'v1', observation, reasoning_activation: 'manual_required', human_review_required: true, executable: false, writes_crm: false, creates_task: false, sends_message: false, persisted: false };
}

function text(value: string, field: string): string { const normalized = value.trim(); if (!normalized) throw new Error(`Sales observation ${field} is required.`); return normalized; }
