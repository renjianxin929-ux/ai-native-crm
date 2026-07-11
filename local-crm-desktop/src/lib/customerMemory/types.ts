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
