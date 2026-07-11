export type CustomerMemoryKind = 'fact' | 'event' | 'interaction' | 'decision' | 'reasoning_summary';
export type CustomerMemorySourceKind = 'crm_record' | 'human_decision' | 'validated_reasoning_summary';

export interface CustomerMemoryItem {
  readonly memory_id: string;
  readonly customer_id: string;
  readonly kind: CustomerMemoryKind;
  readonly summary: string;
  readonly source_kind: CustomerMemorySourceKind;
  readonly validation_source: CustomerMemorySourceKind;
  readonly human_verified?: true;
  readonly source_reference: string;
  readonly evidence_reference: string;
  readonly source_timestamp: string;
  readonly recorded_at: string;
}

export interface CustomerMemoryContext {
  readonly kind: 'CUSTOMER_MEMORY_CONTEXT';
  readonly version: 'v1';
  readonly customer_id: string;
  readonly items: readonly CustomerMemoryItem[];
  readonly bounded: true;
  readonly max_items: number;
  readonly max_characters: number;
  readonly persisted: false;
  readonly read_only: true;
}

export interface CustomerMemoryReader {
  list(customerId: string): Promise<readonly CustomerMemoryItem[]>;
}

export type CustomerMemoryType = 'FACT' | 'EVENT' | 'PREFERENCE' | 'INTERACTION_PATTERN' | 'HUMAN_CONFIRMED_INSIGHT';
export type CustomerMemoryValidationStatus = 'CANDIDATE' | 'VALIDATED' | 'ACTIVE' | 'ARCHIVED';
export type CustomerMemorySourceType = 'CRM_FACT' | 'CRM_INTERACTION' | 'AI_REASONING_SUMMARY' | 'HUMAN_INPUT';
export type CustomerMemoryEvidenceType = 'CUSTOMER' | 'FOLLOW_UP_RECORD' | 'VISIT_RECORD' | 'TASK';

export interface CustomerMemoryEvidenceLink {
  readonly id: string;
  readonly memory_id: string;
  readonly evidence_type: CustomerMemoryEvidenceType;
  readonly evidence_id: string;
}

export interface CustomerMemoryEntry {
  readonly id: string;
  readonly customer_id: string;
  readonly memory_type: CustomerMemoryType;
  readonly content: string;
  readonly source_type: CustomerMemorySourceType;
  readonly source_reference: string;
  readonly confidence: number;
  readonly validation_status: CustomerMemoryValidationStatus;
  readonly validation_source?: 'CRM_EVIDENCE' | 'HUMAN_REVIEW';
  readonly human_verified: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly evidence: readonly CustomerMemoryEvidenceLink[];
}

export interface CustomerMemoryCandidateInput {
  readonly id: string;
  readonly customer_id: string;
  readonly memory_type: CustomerMemoryType;
  readonly content: string;
  readonly source_type: CustomerMemorySourceType;
  readonly source_reference: string;
  readonly confidence: number;
  readonly evidence: readonly Omit<CustomerMemoryEvidenceLink, 'memory_id'>[];
}

export interface MemoryRepository {
  createCandidate(input: CustomerMemoryCandidateInput): Promise<CustomerMemoryEntry>;
  validateMemory(id: string, input: { validation_source: 'CRM_EVIDENCE' | 'HUMAN_REVIEW'; human_verified?: boolean }): Promise<CustomerMemoryEntry>;
  activateMemory(id: string): Promise<CustomerMemoryEntry>;
  archiveMemory(id: string): Promise<CustomerMemoryEntry>;
  listCustomerMemory(customerId: string): Promise<readonly CustomerMemoryEntry[]>;
  getMemoryContext(customerId: string, options?: { max_items?: number; max_characters?: number }): Promise<CustomerMemoryContext>;
}

export interface RetrievalProvider {
  retrieve(input: { customer_id: string; query: string; limit: number }): Promise<readonly CustomerMemoryEntry[]>;
}
