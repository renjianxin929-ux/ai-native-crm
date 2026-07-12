export type CustomerScopedSalesAgentEntry = {
  readonly kind: 'CUSTOMER_SCOPED_SALES_AGENT_ENTRY';
  readonly customer_id: string;
  readonly context_snapshot_reference: string;
  readonly active_memory_ids: readonly string[];
  readonly timeline_evidence_ids: readonly string[];
  readonly profile_identity: string;
};

export function createCustomerScopedSalesAgentEntry(input: Omit<CustomerScopedSalesAgentEntry, 'kind'>): CustomerScopedSalesAgentEntry {
  return { kind: 'CUSTOMER_SCOPED_SALES_AGENT_ENTRY', ...input };
}

export function readCustomerScopedSalesAgentEntry(value: unknown): CustomerScopedSalesAgentEntry | null {
  if (!value || typeof value !== 'object' || !('customerScopedEntry' in value)) return null;
  const entry = value.customerScopedEntry;
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as Partial<CustomerScopedSalesAgentEntry>;
  if (candidate.kind !== 'CUSTOMER_SCOPED_SALES_AGENT_ENTRY' || typeof candidate.customer_id !== 'string' || typeof candidate.context_snapshot_reference !== 'string' || typeof candidate.profile_identity !== 'string' || !Array.isArray(candidate.active_memory_ids) || !Array.isArray(candidate.timeline_evidence_ids)) return null;
  return candidate as CustomerScopedSalesAgentEntry;
}
