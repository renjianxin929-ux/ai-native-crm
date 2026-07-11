import type { MemoryRepository } from '../customerMemory';
import type { ContextSnapshot } from './types';

/** Adds only repository-filtered ACTIVE memory to an immutable CRM snapshot projection. */
export async function enrichContextSnapshotWithCustomerMemory(input: {
  readonly snapshot: ContextSnapshot;
  readonly repository: MemoryRepository;
  readonly customer_id?: string;
  readonly max_items?: number;
  readonly max_characters?: number;
}): Promise<ContextSnapshot> {
  if (input.snapshot.readOnly !== true) throw new Error('Customer memory enrichment requires a read-only ContextSnapshot.');
  const customerId = input.customer_id ?? input.snapshot.customers[0]?.customerId;
  if (!customerId) throw new Error('Customer memory enrichment requires a customer-bound ContextSnapshot.');
  const customerMemory = await input.repository.getMemoryContext(customerId, { max_items: input.max_items, max_characters: input.max_characters });
  return { ...input.snapshot, customers: input.snapshot.customers.map(customer => ({ ...customer, evidenceIds: [...customer.evidenceIds] })), accounts: input.snapshot.accounts.map(account => ({ ...account, evidenceIds: [...account.evidenceIds] })), recentInteractions: input.snapshot.recentInteractions.map(interaction => ({ ...interaction, evidenceIds: [...interaction.evidenceIds] })), evidenceIdentifiers: [...input.snapshot.evidenceIdentifiers], customerMemory };
}
