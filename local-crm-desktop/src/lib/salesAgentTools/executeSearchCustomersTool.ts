/**
 * Registered read-only search_customers tool — production path:
 * SalesAgentSession / interaction controller → this tool → CRM repository → SQLite.
 */

import { createCrmRepository, getDb, type CustomerSearchRepositoryFilters, type DatabaseLike } from '../db';
import type { Customer } from '../types';
import { normalizeCustomerSearchFilters, type NormalizedCustomerSearchFilters } from './filterNormalization';
import {
  SEARCH_CUSTOMERS_HARD_CAP,
  SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE,
  SEARCH_CUSTOMERS_RESOLUTION_MAX,
  SEARCH_CUSTOMERS_TOOL_ID,
  rankCustomerSearchCandidates,
  type CustomerSearchListKind,
  type SearchCustomersResult,
  type SearchableCustomer,
} from './searchCustomers';

export type { SearchCustomersResult };

function toSearchable(customer: Customer): SearchableCustomer {
  return {
    id: customer.id,
    name: customer.name,
    region: customer.region,
    industry: customer.industry,
    stage: customer.stage,
    customer_grade: customer.customer_grade,
    intent_level: customer.intent_level,
    last_contacted_at: customer.last_contacted_at,
    next_follow_up_at: customer.next_follow_up_at,
    updated_at: customer.updated_at,
  };
}

export interface SearchCustomersToolInput {
  readonly filters: NormalizedCustomerSearchFilters;
  readonly unsupported_filters?: readonly string[];
  readonly notes?: readonly string[];
  readonly list_kind?: CustomerSearchListKind;
  readonly offset?: number;
  readonly page_size?: number;
  /** Injected repository for tests; production uses getDb() + createCrmRepository */
  readonly db?: DatabaseLike;
}

/**
 * Canonical registered tool executor for search_customers.
 * Read-only; resolution ≤5; portfolio pages ≤20; hard cap 50; no provider; no CRM write.
 */
export async function executeSearchCustomersTool(input: SearchCustomersToolInput): Promise<SearchCustomersResult> {
  const db = input.db ?? await getDb();
  const repository = createCrmRepository(db);
  const list_kind: CustomerSearchListKind = input.list_kind
    ?? (input.filters.name_query ? 'resolution' : 'portfolio');
  const page_size = Math.min(
    Math.max(
      input.page_size
        ?? (list_kind === 'portfolio' ? SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE : SEARCH_CUSTOMERS_RESOLUTION_MAX),
      1,
    ),
    SEARCH_CUSTOMERS_HARD_CAP,
  );
  const offset = Math.max(input.offset ?? 0, 0);

  const repoFilters: CustomerSearchRepositoryFilters = {
    ...input.filters,
    limit: list_kind === 'portfolio' ? page_size : SEARCH_CUSTOMERS_HARD_CAP,
    offset: list_kind === 'portfolio' ? offset : 0,
  };

  const [rows, total_matches] = await Promise.all([
    repository.searchCustomers(repoFilters),
    repository.countCustomers({ ...input.filters }),
  ]);

  // Name LIKE is approximate; re-apply full normalized filters + ranking in-process for resolution.
  if (list_kind === 'resolution') {
    return rankCustomerSearchCandidates(rows.map(toSearchable), input.filters, {
      unsupported_filters: input.unsupported_filters ?? [],
      notes: input.notes ?? [],
      max: page_size,
      offset: 0,
      list_kind,
      total_matches,
    });
  }

  // Portfolio: SQL already applied page + count; score is uniform for structural filters.
  return rankCustomerSearchCandidates(rows.map(toSearchable), input.filters, {
    unsupported_filters: input.unsupported_filters ?? [],
    notes: input.notes ?? [],
    max: page_size,
    offset: 0,
    list_kind,
    total_matches,
  });
}

/** Parse NL and execute the registered search_customers tool against the repository. */
export async function searchCustomersByNaturalLanguage(
  message: string,
  options?: {
    readonly db?: DatabaseLike;
    readonly now?: string;
    readonly list_kind?: CustomerSearchListKind;
    readonly offset?: number;
    readonly page_size?: number;
  },
): Promise<{ readonly normalization: ReturnType<typeof normalizeCustomerSearchFilters>; readonly search: SearchCustomersResult }> {
  const normalization = normalizeCustomerSearchFilters(message, options?.now);
  const list_kind = options?.list_kind
    ?? (normalization.is_portfolio_query ? 'portfolio' : 'resolution');
  const search = await executeSearchCustomersTool({
    filters: normalization.filters,
    unsupported_filters: normalization.unsupported,
    notes: normalization.notes,
    list_kind,
    offset: options?.offset,
    page_size: options?.page_size,
    db: options?.db,
  });
  return { normalization, search };
}

export const SEARCH_CUSTOMERS_TOOL_META = Object.freeze({
  id: SEARCH_CUSTOMERS_TOOL_ID,
  name: 'Search customers',
  description: 'Bounded read-only customer search against CRM SQLite via parameterized repository filters.',
  capability: 'customer_search_read',
  access: 'read' as const,
  requires_confirmation: false as const,
  max_results_resolution: SEARCH_CUSTOMERS_RESOLUTION_MAX,
  max_results_portfolio_page: SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE,
  writes_crm: false as const,
  calls_provider: false as const,
});
