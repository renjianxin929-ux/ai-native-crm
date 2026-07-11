export type SalesObservationEventKind = 'customer_inactive' | 'interaction_observed' | 'behavior_changed' | 'evidence_added';

export interface SalesObservationEvent {
  readonly event_id: string;
  readonly customer_id: string;
  readonly kind: SalesObservationEventKind;
  readonly occurred_at: string;
  readonly evidence_reference: string;
  readonly summary: string;
}

export interface SalesObservation {
  readonly kind: 'PROACTIVE_SALES_OBSERVATION';
  readonly version: 'v1';
  readonly observation_id: string;
  readonly customer_id: string;
  readonly category: SalesObservationEventKind;
  readonly occurred_at: string;
  readonly evidence_reference: string;
  readonly summary: string;
  readonly requires_human_review: true;
  readonly executable: false;
  readonly writes_crm: false;
  readonly persisted: false;
}

export interface ProactiveSalesSuggestionDraft {
  readonly kind: 'PROACTIVE_SALES_SUGGESTION_DRAFT';
  readonly version: 'v1';
  readonly observation: SalesObservation;
  readonly reasoning_activation: 'manual_required';
  readonly human_review_required: true;
  readonly executable: false;
  readonly writes_crm: false;
  readonly creates_task: false;
  readonly sends_message: false;
  readonly persisted: false;
}
