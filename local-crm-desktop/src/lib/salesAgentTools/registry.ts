import type { ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext } from '../customerMemory';
import type { LoadedReadOnlyAgentSnapshot } from '../readOnlySnapshotLoaderReadiness';
import { SEARCH_CUSTOMERS_TOOL_ID } from './searchCustomers';
import { SEARCH_CUSTOMERS_TOOL_META } from './executeSearchCustomersTool';
import { CUSTOMER_PRIORITY_RANKING_TOOL_ID } from './customerPriorityRanking';

export type SalesAgentCustomerScopedToolId =
  | 'get_customer'
  | 'get_customer_context'
  | 'get_customer_timeline'
  | 'list_customer_followups'
  | 'list_customer_visits'
  | 'list_customer_tasks'
  | 'get_active_memory'
  | 'get_existing_ai_results'
  | 'get_today_priority';

export type SalesAgentToolId = SalesAgentCustomerScopedToolId | typeof SEARCH_CUSTOMERS_TOOL_ID | typeof CUSTOMER_PRIORITY_RANKING_TOOL_ID;

export interface SalesAgentToolDefinition {
  readonly id: SalesAgentToolId;
  readonly name: string;
  readonly description: string;
  readonly capability: string;
  readonly input_schema: 'customer_id' | 'normalized_customer_filters' | 'ranking_context';
  readonly output_schema: 'evidence_linked_read_result' | 'bounded_customer_candidates' | 'customer_priority_ranking';
  readonly access: 'read';
  readonly requires_confirmation: false;
}

const make = (
  id: SalesAgentCustomerScopedToolId,
  name: string,
  capability: string,
): SalesAgentToolDefinition => ({
  id,
  name,
  description: `${name} for the current customer.`,
  capability,
  input_schema: 'customer_id',
  output_schema: 'evidence_linked_read_result',
  access: 'read',
  requires_confirmation: false,
});

export const SALES_AGENT_TOOL_REGISTRY: Readonly<Record<SalesAgentToolId, SalesAgentToolDefinition>> = Object.freeze({
  get_customer: make('get_customer', 'Get customer', 'customer_read'),
  get_customer_context: make('get_customer_context', 'Get customer context', 'customer_read'),
  get_customer_timeline: make('get_customer_timeline', 'Get customer timeline', 'timeline_read'),
  list_customer_followups: make('list_customer_followups', 'List follow-ups', 'timeline_read'),
  list_customer_visits: make('list_customer_visits', 'List visits', 'timeline_read'),
  list_customer_tasks: make('list_customer_tasks', 'List tasks', 'timeline_read'),
  get_active_memory: make('get_active_memory', 'Get active memory', 'memory_read'),
  get_existing_ai_results: make('get_existing_ai_results', 'Get existing AI results', 'customer_read'),
  get_today_priority: make('get_today_priority', 'Get today priority', 'priority_read'),
  search_customers: {
    id: SEARCH_CUSTOMERS_TOOL_ID,
    name: SEARCH_CUSTOMERS_TOOL_META.name,
    description: SEARCH_CUSTOMERS_TOOL_META.description,
    capability: SEARCH_CUSTOMERS_TOOL_META.capability,
    input_schema: 'normalized_customer_filters',
    output_schema: 'bounded_customer_candidates',
    access: 'read',
    requires_confirmation: false,
  },
  customer_priority_ranking: {
    id: CUSTOMER_PRIORITY_RANKING_TOOL_ID, name: 'Customer priority ranking', description: 'Deterministically rank customers from persisted CRM evidence.',
    capability: 'priority_read', input_schema: 'ranking_context', output_schema: 'customer_priority_ranking', access: 'read', requires_confirmation: false,
  },
});

export const SALES_AGENT_TOOL_IDS = Object.freeze(Object.keys(SALES_AGENT_TOOL_REGISTRY) as SalesAgentToolId[]);
export const SALES_AGENT_CUSTOMER_SCOPED_TOOL_IDS = Object.freeze(
  SALES_AGENT_TOOL_IDS.filter(id => id !== SEARCH_CUSTOMERS_TOOL_ID && id !== CUSTOMER_PRIORITY_RANKING_TOOL_ID) as SalesAgentCustomerScopedToolId[],
);

export interface SalesAgentReadToolContext {
  readonly customer_id: string;
  readonly snapshot: LoadedReadOnlyAgentSnapshot;
  readonly context: ContextSnapshot;
  readonly memory?: CustomerMemoryContext;
}

export interface SalesAgentToolResult {
  readonly tool_id: SalesAgentCustomerScopedToolId;
  readonly evidence_refs: readonly string[];
  readonly records: readonly unknown[];
  readonly read_only: true;
  readonly writes_crm: false;
}

export function executeSalesAgentReadTool(id: SalesAgentCustomerScopedToolId, input: SalesAgentReadToolContext): SalesAgentToolResult {
  if (!SALES_AGENT_TOOL_REGISTRY[id] || !input.customer_id.trim()) {
    throw new Error('Sales Agent tool is not registered or customer scoped.');
  }
  if (id === ('search_customers' as string)) {
    throw new Error('search_customers must run through executeSearchCustomersTool against the CRM repository.');
  }
  const customer = input.snapshot.customers.filter(item => item.id === input.customer_id);
  const tasks = input.snapshot.tasks.filter(item => item.customer_id === input.customer_id);
  const work = input.snapshot.work_items.filter(item => item.customer_id === input.customer_id);
  const records =
    id === 'get_customer' ? customer
      : id === 'get_customer_context' ? [input.context]
        : id === 'list_customer_tasks' ? tasks
          : id === 'get_customer_timeline' || id === 'list_customer_followups' || id === 'list_customer_visits' ? [...tasks, ...work]
            : id === 'get_active_memory' ? [...(input.memory?.items ?? [])]
              : id === 'get_existing_ai_results' ? []
                : [...customer, ...tasks];
  const evidence_refs = [...new Set(records.flatMap(record => evidenceFor(record)))];
  return { tool_id: id, evidence_refs, records, read_only: true, writes_crm: false };
}

function evidenceFor(record: unknown): string[] {
  if (!record || typeof record !== 'object') return [];
  const value = record as {
    evidence_ref?: { id?: string };
    evidenceIds?: readonly string[];
    evidenceIdentifiers?: readonly string[];
    evidence_reference?: string;
  };
  return [
    ...(value.evidence_ref?.id ? [value.evidence_ref.id] : []),
    ...(value.evidenceIds ?? []),
    ...(value.evidenceIdentifiers ?? []),
    ...(value.evidence_reference ? [value.evidence_reference] : []),
  ];
}
