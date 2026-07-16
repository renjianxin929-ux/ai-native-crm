/**
 * Restricted read-only customer search for Sales Agent.
 * Ranking/cap helpers are pure; production execution goes through the registered
 * search_customers tool → CRM repository (parameterized SQLite), never React-built corpora.
 */

import type { NormalizedCustomerSearchFilters } from './filterNormalization';
import { SALES_AGENT_APP_CLOCK } from './appClock';

/** Max candidates for single-customer disambiguation. */
export const SEARCH_CUSTOMERS_RESOLUTION_MAX = 5;
/** Default page size for portfolio / list queries. */
export const SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE = 20;
/** Hard safety cap for any single search fetch page. */
export const SEARCH_CUSTOMERS_HARD_CAP = 50;

/** @deprecated Use SEARCH_CUSTOMERS_RESOLUTION_MAX — kept for older resolution callers. */
export const SEARCH_CUSTOMERS_MAX_RESULTS = SEARCH_CUSTOMERS_RESOLUTION_MAX;

export const SEARCH_CUSTOMERS_TOOL_ID = 'search_customers' as const;

export type CustomerSearchListKind = 'resolution' | 'portfolio';

export interface SearchableCustomer {
  readonly id: string;
  readonly name: string;
  readonly region?: string | null;
  readonly industry?: string | null;
  readonly stage?: string | null;
  readonly customer_grade?: string | null;
  readonly intent_level?: string | null;
  readonly last_contacted_at?: string | null;
  readonly next_follow_up_at?: string | null;
  readonly updated_at?: string | null;
  readonly aliases?: readonly string[];
}

/** @deprecated Prefer NormalizedCustomerSearchFilters — kept for ranking helpers */
export interface SearchCustomersFilters {
  readonly query?: string;
  readonly region?: string;
  readonly industry?: string;
  readonly stage?: string;
  /** @deprecated Use customer_grade — previously incorrectly mixed with priority */
  readonly priority?: string;
  readonly customer_grade?: string;
  readonly intent_level?: string;
  readonly inactive_days?: number;
  readonly now?: string;
}

export interface CustomerSearchCandidate {
  readonly id: string;
  readonly name: string;
  readonly region: string | null;
  readonly industry: string | null;
  readonly stage: string | null;
  readonly customer_grade: string | null;
  readonly intent_level: string | null;
  readonly last_contacted_at: string | null;
  readonly next_follow_up_at: string | null;
  readonly match_score: number;
  readonly evidence_ref: string;
}

export interface SearchCustomersResult {
  readonly tool_id: typeof SEARCH_CUSTOMERS_TOOL_ID;
  readonly candidates: readonly CustomerSearchCandidate[];
  /** True total matching rows (before page truncation). */
  readonly total_matches: number;
  /** @deprecated Prefer total_matches */
  readonly total_matches_before_cap: number;
  readonly read_only: true;
  readonly writes_crm: false;
  readonly capped_at: number;
  readonly page_offset: number;
  readonly page_size: number;
  readonly has_more: boolean;
  readonly list_kind: CustomerSearchListKind;
  readonly calls_provider: false;
  readonly unsupported_filters: readonly string[];
  readonly notes: readonly string[];
  readonly filters_applied: NormalizedCustomerSearchFilters;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function includesLoose(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.includes(needle);
}

function daysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((nowMs - then) / (24 * 60 * 60 * 1000));
}

export function matchCustomerNameScore(customer: SearchableCustomer, query: string): number {
  if (!query) return 1;
  const name = normalize(customer.name);
  const aliases = (customer.aliases ?? []).map(normalize);
  const q = normalize(query);
  if (name === q) return 100;
  if (aliases.includes(q)) return 95;
  if (name.includes(q) || q.includes(name)) return 80;
  if (aliases.some(alias => alias.includes(q) || q.includes(alias))) return 70;
  const tokens = q.split(/[\s,，、/]+/).filter(Boolean);
  let hits = 0;
  for (const token of tokens) {
    if (name.includes(token) || aliases.some(alias => alias.includes(token))) hits += 1;
  }
  if (hits > 0) return 40 + hits * 10;
  return 0;
}

function toCandidate(customer: SearchableCustomer, score: number): CustomerSearchCandidate {
  return {
    id: customer.id,
    name: customer.name,
    region: customer.region ?? null,
    industry: customer.industry ?? null,
    stage: customer.stage ?? null,
    customer_grade: customer.customer_grade ?? null,
    intent_level: customer.intent_level ?? null,
    last_contacted_at: customer.last_contacted_at ?? null,
    next_follow_up_at: customer.next_follow_up_at ?? null,
    match_score: score,
    evidence_ref: `customer:${customer.id}`,
  };
}

export function customerPassesNormalizedFilters(
  customer: SearchableCustomer,
  filters: NormalizedCustomerSearchFilters,
): boolean {
  const nowMs = Date.parse(filters.now ?? SALES_AGENT_APP_CLOCK.now());
  if (filters.region && !includesLoose(normalize(customer.region), normalize(filters.region))) return false;
  if (filters.industry && !includesLoose(normalize(customer.industry), normalize(filters.industry))) return false;
  if (filters.stage && normalize(customer.stage) !== normalize(filters.stage)) return false;
  if (filters.customer_grade && normalize(customer.customer_grade) !== normalize(filters.customer_grade)) return false;
  if (filters.intent_level && normalize(customer.intent_level) !== normalize(filters.intent_level)) return false;
  if (typeof filters.inactive_days === 'number' && filters.inactive_days >= 0) {
    const idle = daysSince(customer.last_contacted_at, nowMs);
    if (idle !== null && idle < filters.inactive_days) return false;
  }
  if (filters.name_query) {
    if (matchCustomerNameScore(customer, filters.name_query) <= 0) return false;
  }
  return true;
}

/**
 * Pure ranking over an already-loaded row set (tests / post-SQL scoring).
 * Production code should obtain rows via the CRM repository, not a React corpus.
 */
export function rankCustomerSearchCandidates(
  rows: readonly SearchableCustomer[],
  filters: NormalizedCustomerSearchFilters,
  options: {
    readonly unsupported_filters?: readonly string[];
    readonly notes?: readonly string[];
    readonly max?: number;
    readonly offset?: number;
    readonly list_kind?: CustomerSearchListKind;
    readonly total_matches?: number;
  } = {},
): SearchCustomersResult {
  const list_kind = options.list_kind ?? 'resolution';
  const max = Math.min(
    Math.max(options.max ?? (list_kind === 'portfolio' ? SEARCH_CUSTOMERS_PORTFOLIO_PAGE_SIZE : SEARCH_CUSTOMERS_RESOLUTION_MAX), 1),
    SEARCH_CUSTOMERS_HARD_CAP,
  );
  const offset = Math.max(options.offset ?? 0, 0);
  const ranked: CustomerSearchCandidate[] = [];
  for (const customer of rows) {
    if (!customer.id?.trim() || !customer.name?.trim()) continue;
    if (!customerPassesNormalizedFilters(customer, filters)) continue;
    const score = filters.name_query
      ? matchCustomerNameScore(customer, filters.name_query)
      : 1;
    ranked.push(toCandidate(customer, score));
  }
  ranked.sort((a, b) => b.match_score - a.match_score || a.name.localeCompare(b.name, 'zh'));
  const total = options.total_matches ?? ranked.length;
  const page = ranked.slice(offset, offset + max);
  return {
    tool_id: SEARCH_CUSTOMERS_TOOL_ID,
    candidates: page,
    total_matches: total,
    total_matches_before_cap: total,
    read_only: true,
    writes_crm: false,
    capped_at: max,
    page_offset: offset,
    page_size: max,
    has_more: offset + page.length < total,
    list_kind,
    calls_provider: false,
    unsupported_filters: options.unsupported_filters ?? [],
    notes: options.notes ?? [],
    filters_applied: filters,
  };
}

/**
 * Test / fixture helper: filter an explicit array.
 * Must not be the production CRM data source — production uses repository SQL.
 */
export function searchCustomersFromFixture(
  corpus: readonly SearchableCustomer[],
  filters: NormalizedCustomerSearchFilters,
  options?: {
    readonly unsupported_filters?: readonly string[];
    readonly notes?: readonly string[];
    readonly max?: number;
    readonly offset?: number;
    readonly list_kind?: CustomerSearchListKind;
  },
): SearchCustomersResult {
  return rankCustomerSearchCandidates(corpus, filters, options);
}

/** @deprecated Use searchCustomersFromFixture or repository.searchCustomers */
export function searchCustomers(
  corpus: readonly SearchableCustomer[],
  filters: SearchCustomersFilters = {},
): SearchCustomersResult {
  const normalized: NormalizedCustomerSearchFilters = {
    ...(filters.query ? { name_query: filters.query } : {}),
    ...(filters.region ? { region: filters.region } : {}),
    ...(filters.industry ? { industry: filters.industry } : {}),
    ...(filters.stage ? { stage: filters.stage } : {}),
    ...(filters.customer_grade || filters.priority
      ? { customer_grade: filters.customer_grade ?? filters.priority }
      : {}),
    ...(filters.intent_level ? { intent_level: filters.intent_level } : {}),
    ...(typeof filters.inactive_days === 'number' ? { inactive_days: filters.inactive_days } : {}),
    ...(filters.now ? { now: filters.now } : {}),
  };
  return searchCustomersFromFixture(corpus, normalized);
}
