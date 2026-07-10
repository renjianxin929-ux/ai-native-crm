export interface ContextTimeWindow {
  from: string;
  to: string;
}

export interface CRMCustomerFact {
  customerId: string;
  name: string;
  grade: string;
  intentLevel: string;
  observedAt: string;
  evidenceIds: readonly string[];
}

export interface CRMAccountFact {
  accountId: string;
  customerId: string | null;
  name: string;
  status: string;
  observedAt: string;
  evidenceIds: readonly string[];
}

export type CRMInteractionKind = 'task' | 'work_item' | 'capture_event' | 'sync_evidence';

export interface CRMInteractionFact {
  interactionId: string;
  customerId: string | null;
  kind: CRMInteractionKind;
  summary: string;
  occurredAt: string;
  evidenceIds: readonly string[];
}

export interface ContextSnapshot {
  kind: 'CRM_CONTEXT_SNAPSHOT';
  version: 'v1';
  snapshotId: string;
  capturedAt: string;
  timeWindow: ContextTimeWindow;
  customers: readonly CRMCustomerFact[];
  accounts: readonly CRMAccountFact[];
  recentInteractions: readonly CRMInteractionFact[];
  evidenceIdentifiers: readonly string[];
  bounded: true;
  maxInteractions: number;
  readOnly: true;
}

export interface ContextBuilderInput {
  snapshotId: string;
  capturedAt: string;
  timeWindow: ContextTimeWindow;
  customers: readonly CRMCustomerFact[];
  accounts: readonly CRMAccountFact[];
  interactions: readonly CRMInteractionFact[];
  maxInteractions?: number;
}
