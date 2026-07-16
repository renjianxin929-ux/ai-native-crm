/**
 * Customer resolution helpers — prefer SalesAgentInteractionController in production.
 * Kept for focused NL unit tests against fixture corpora (not production source of truth).
 */

import { normalizeCustomerSearchFilters, resumeInstructionAfterScope } from './filterNormalization';
import {
  searchCustomersFromFixture,
  type CustomerSearchCandidate,
  type SearchableCustomer,
  type SearchCustomersResult,
} from './searchCustomers';

export type CustomerResolutionOutcome =
  | {
      readonly kind: 'scoped_continue';
      readonly customer_id: string;
      readonly customer_name: string;
      readonly message: string;
      readonly resume_message: string;
      readonly search: SearchCustomersResult | null;
    }
  | {
      readonly kind: 'candidates';
      readonly candidates: readonly CustomerSearchCandidate[];
      readonly pending_message: string;
      readonly search: SearchCustomersResult;
      readonly empty_exact: boolean;
      readonly portfolio: boolean;
    }
  | {
      readonly kind: 'needs_customer_clarification';
      readonly reason: string;
      readonly search: SearchCustomersResult | null;
    };

function corpusNameHits(message: string, corpus: readonly SearchableCustomer[]): SearchableCustomer[] {
  const lower = message.toLowerCase();
  const hits: SearchableCustomer[] = [];
  const sorted = [...corpus].sort((a, b) => b.name.length - a.name.length);
  for (const customer of sorted) {
    const name = customer.name.trim();
    if (name.length < 2) continue;
    if (message.includes(name) || lower.includes(name.toLowerCase())) {
      hits.push(customer);
      continue;
    }
    for (const alias of customer.aliases ?? []) {
      if (alias.trim().length >= 2 && message.includes(alias.trim())) {
        hits.push(customer);
        break;
      }
    }
  }
  const seen = new Set<string>();
  return hits.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Fixture-only resolver. Production must use SalesAgentInteractionController
 * → executeSearchCustomersTool → CRM repository/SQLite.
 */
export function resolveCustomerForAgentMessage(input: {
  readonly message: string;
  readonly corpus: readonly SearchableCustomer[];
  readonly bound_customer_id?: string;
  readonly bound_customer_name?: string;
  readonly now?: string;
}): CustomerResolutionOutcome {
  const message = input.message.trim();
  if (!message) {
    return { kind: 'needs_customer_clarification', reason: '请输入销售问题或客户名称。', search: null };
  }

  const norm = normalizeCustomerSearchFilters(message, input.now);

  if (norm.is_clear_scope) {
    return { kind: 'needs_customer_clarification', reason: '已识别清除上下文意图；请在界面清除后再提问。', search: null };
  }

  if (input.bound_customer_id?.trim() && !norm.is_explicit_switch && !norm.is_customer_lookup) {
    return {
      kind: 'scoped_continue',
      customer_id: input.bound_customer_id,
      customer_name: input.bound_customer_name || '当前客户',
      message,
      resume_message: message,
      search: null,
    };
  }

  if (input.bound_customer_id?.trim() && norm.is_scoped_analysis && !norm.is_explicit_switch) {
    return {
      kind: 'scoped_continue',
      customer_id: input.bound_customer_id,
      customer_name: input.bound_customer_name || '当前客户',
      message,
      resume_message: message,
      search: null,
    };
  }

  const nameHits = corpusNameHits(message, input.corpus);
  if (nameHits.length === 1 && !norm.filters.region && !norm.filters.customer_grade) {
    return {
      kind: 'scoped_continue',
      customer_id: nameHits[0]!.id,
      customer_name: nameHits[0]!.name,
      message,
      resume_message: resumeInstructionAfterScope(message),
      search: searchCustomersFromFixture(input.corpus, { name_query: nameHits[0]!.name, now: input.now }),
    };
  }
  if (nameHits.length > 1 && !norm.filters.region && !norm.filters.customer_grade && !norm.filters.industry) {
    const search = searchCustomersFromFixture(nameHits, { now: input.now });
    return {
      kind: 'candidates',
      candidates: search.candidates,
      pending_message: message,
      search,
      empty_exact: false,
      portfolio: false,
    };
  }

  if (norm.is_scoped_analysis && !norm.is_customer_lookup && !input.bound_customer_id) {
    return {
      kind: 'needs_customer_clarification',
      reason: '请先定位客户，或从客户详情进入后再总结/分析。',
      search: null,
    };
  }

  if (!norm.is_customer_lookup && !norm.is_portfolio_query && !norm.is_explicit_switch) {
    return {
      kind: 'needs_customer_clarification',
      reason: '请说明要处理的客户名称，或从客户详情进入；也可以说“帮我找一下某某客户”。',
      search: null,
    };
  }

  const search = searchCustomersFromFixture(input.corpus, norm.filters, {
    unsupported_filters: norm.unsupported,
    notes: norm.notes,
  });

  if (search.candidates.length === 1 && !norm.is_portfolio_query) {
    return {
      kind: 'scoped_continue',
      customer_id: search.candidates[0]!.id,
      customer_name: search.candidates[0]!.name,
      message,
      resume_message: resumeInstructionAfterScope(message),
      search,
    };
  }

  if (search.candidates.length > 1 || (search.candidates.length >= 1 && norm.is_portfolio_query)) {
    return {
      kind: 'candidates',
      candidates: search.candidates,
      pending_message: message,
      search,
      empty_exact: false,
      portfolio: norm.is_portfolio_query,
    };
  }

  const near = norm.filters.name_query
    ? searchCustomersFromFixture(input.corpus, {
      name_query: norm.filters.name_query.slice(0, Math.max(2, Math.min(norm.filters.name_query.length, 6))),
      now: input.now,
    })
    : search;

  return {
    kind: 'candidates',
    candidates: near.candidates,
    pending_message: message,
    search: near,
    empty_exact: true,
    portfolio: false,
  };
}
