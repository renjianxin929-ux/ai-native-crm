import type { CRMCustomerFact, CRMInteractionFact, ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext, CustomerMemoryItem } from '../customerMemory';
import type { SalesAgentToolResult } from '../salesAgentTools/registry';
import type { OutputSchemaId, ProductionCapabilityIntent } from './capabilityRoutingMatrix';
import { outputSchemaSpecFor } from './modelOutputSchemas';

export const MODEL_CONTEXT_LIMITS = {
  max_recent_interactions: 20,
  max_active_memory: 10,
  max_tasks: 20,
  max_evidence_items: 40,
  max_evidence_item_chars: 400,
  max_evidence_total_chars: 6000,
  max_tool_record_chars: 300,
  max_user_instruction_chars: 2000,
  max_portfolio_summary_chars: 1200,
  max_cross_customer_candidates: 5,
  max_request_json_bytes: 48_000,
} as const;

export const SENSITIVE_FIELD_ALLOWLIST = [
  'customer_id', 'company_name', 'region', 'industry', 'stage', 'priority', 'grade',
  'intent_level', 'observed_at', 'next_follow_up_at', 'interaction_id', 'kind', 'summary',
  'occurred_at', 'memory_id', 'memory_type', 'content', 'source_reference', 'source_timestamp',
  'task_id', 'title', 'status', 'due_at', 'evidence_ids',
] as const;

export const SENSITIVE_FIELD_DENYLIST = [
  'apikey', 'authorization', 'bearer', 'password', 'secret', 'token', 'credential',
  'dbpath', 'databasepath', 'phoneraw', 'emailraw', 'wechatid', 'idcard', 'bankaccount',
  'debuglog', 'rawprompt', 'rawresponse',
] as const;

export interface ModelEvidenceRef {
  readonly evidence_id: string;
  readonly customer_id: string | null;
  readonly source_type: 'customer' | 'interaction' | 'memory' | 'task';
  readonly source_record_id: string;
  readonly fact_ids: readonly string[];
  readonly created_at: string;
  readonly integrity: string;
  readonly summary: string;
  readonly truncated: boolean;
}

export interface ModelContextEnvelope {
  readonly request_id: string;
  readonly intent: ProductionCapabilityIntent;
  readonly customer_id: string | null;
  readonly customer_allowlist: readonly string[];
  readonly portfolio_summary: string | null;
  readonly selected_crm_facts: readonly Record<string, unknown>[];
  readonly recent_interactions: readonly Record<string, unknown>[];
  readonly active_memory: readonly Record<string, unknown>[];
  readonly relevant_tasks: readonly Record<string, unknown>[];
  readonly evidence_map: readonly ModelEvidenceRef[];
  readonly user_instruction: string;
  readonly locale: string;
  readonly timezone: string;
  readonly safety_mode: 'human_review_required_no_crm_write';
  readonly requested_output_schema: OutputSchemaId;
  /** Closed-schema field specification shown to the provider so its output shape matches the parser contract. */
  readonly output_schema_spec: string;
  readonly truncated_fields: readonly string[];
}

export interface ModelContextEnvelopeInput {
  readonly request_id: string;
  readonly intent: ProductionCapabilityIntent;
  readonly output_schema: OutputSchemaId;
  readonly user_instruction: string;
  readonly customer_id: string | null;
  readonly customer_allowlist?: readonly string[];
  readonly context: ContextSnapshot;
  readonly memory?: CustomerMemoryContext;
  readonly tool_trace?: readonly SalesAgentToolResult[];
  readonly locale?: string;
  readonly timezone?: string;
  readonly portfolio_summary?: string | null;
  readonly cross_customer_candidates?: readonly { customer_id: string; name: string; grade?: string }[];
}

function truncateText(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: `${value.slice(0, Math.max(0, max - 13))}…[truncated]`, truncated: true };
}

function normalizedKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
}

function containsDeniedKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SENSITIVE_FIELD_DENYLIST.some(denied => normalized.includes(denied));
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined;
  if (typeof value === 'string') return truncateText(value, MODEL_CONTEXT_LIMITS.max_tool_record_chars).text;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeValue(item, depth + 1)).filter(item => item !== undefined);
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (containsDeniedKey(key)) continue;
      const sanitized = sanitizeValue(nested, depth + 1);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    return output;
  }
  return undefined;
}

function projectAllowedRecord(record: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in record) || containsDeniedKey(key)) continue;
    const value = sanitizeValue(record[key]);
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function customerProjection(customer: CRMCustomerFact): Record<string, unknown> {
  return projectAllowedRecord({
    customer_id: customer.customerId,
    company_name: customer.name,
    grade: customer.grade,
    intent_level: customer.intentLevel,
    observed_at: customer.observedAt,
    evidence_ids: customer.evidenceIds,
  }, ['customer_id', 'company_name', 'grade', 'intent_level', 'observed_at', 'evidence_ids']);
}

function interactionProjection(interaction: CRMInteractionFact): Record<string, unknown> {
  return projectAllowedRecord({
    customer_id: interaction.customerId,
    interaction_id: interaction.interactionId,
    kind: interaction.kind,
    summary: interaction.summary,
    occurred_at: interaction.occurredAt,
    evidence_ids: interaction.evidenceIds,
  }, ['customer_id', 'interaction_id', 'kind', 'summary', 'occurred_at', 'evidence_ids']);
}

function memoryProjection(memory: CustomerMemoryItem): Record<string, unknown> {
  return projectAllowedRecord({
    customer_id: memory.customer_id,
    memory_id: memory.memory_id,
    memory_type: memory.kind,
    content: memory.summary,
    source_reference: memory.source_reference,
    source_timestamp: memory.source_timestamp,
    evidence_ids: [memory.evidence_reference],
  }, ['customer_id', 'memory_id', 'memory_type', 'content', 'source_reference', 'source_timestamp', 'evidence_ids']);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function integrityOf(evidence: Omit<ModelEvidenceRef, 'integrity' | 'summary' | 'truncated'>): string {
  const source = `${evidence.customer_id ?? 'global'}|${evidence.source_type}|${evidence.source_record_id}|${evidence.fact_ids.join(',')}|${evidence.created_at}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function addEvidence(
  map: Map<string, ModelEvidenceRef>,
  input: Omit<ModelEvidenceRef, 'integrity' | 'summary' | 'truncated'> & { readonly summary: string },
  budget: { remaining: number },
): void {
  if (!input.evidence_id.trim() || budget.remaining <= 0 || map.size >= MODEL_CONTEXT_LIMITS.max_evidence_items) return;
  const bounded = truncateText(input.summary, Math.min(MODEL_CONTEXT_LIMITS.max_evidence_item_chars, budget.remaining));
  const base = {
    evidence_id: input.evidence_id,
    customer_id: input.customer_id,
    source_type: input.source_type,
    source_record_id: input.source_record_id,
    fact_ids: input.fact_ids,
    created_at: input.created_at,
  } as const;
  const candidate: ModelEvidenceRef = { ...base, integrity: integrityOf(base), summary: bounded.text, truncated: bounded.truncated };
  const existing = map.get(input.evidence_id);
  if (existing && existing.integrity !== candidate.integrity) throw new Error(`Evidence ownership collision: ${input.evidence_id}`);
  if (!existing) {
    map.set(input.evidence_id, candidate);
    budget.remaining -= bounded.text.length;
  }
}

export function buildModelContextEnvelope(input: ModelContextEnvelopeInput): ModelContextEnvelope {
  const truncated = new Set<string>();
  const instruction = truncateText(input.user_instruction, MODEL_CONTEXT_LIMITS.max_user_instruction_chars);
  if (instruction.truncated) truncated.add('user_instruction');

  const isCompare = input.intent === 'COMPLEX_CUSTOMER_COMPARE';
  const deduplicatedAllowlist = [...new Set(input.customer_allowlist ?? [])];
  const allowlist = isCompare
    ? deduplicatedAllowlist
    : input.customer_id ? [input.customer_id] : [];
  if (isCompare && (allowlist.length < 2 || allowlist.length > MODEL_CONTEXT_LIMITS.max_cross_customer_candidates)) {
    throw new Error('Compare model context requires an explicit bounded customer_allowlist.');
  }
  if (!isCompare && !input.customer_id) throw new Error('Scoped customer is required for model context.');

  const customers = input.context.customers.filter(customer => allowlist.includes(customer.customerId));
  if (customers.length !== allowlist.length) throw new Error('Scoped customer was not found in the supplied context.');
  const selectedFacts = customers.map(customerProjection);

  if (input.cross_customer_candidates?.length) {
    for (const candidate of input.cross_customer_candidates) {
      if (!allowlist.includes(candidate.customer_id)) throw new Error('Cross-customer candidate is outside customer_allowlist.');
    }
  }

  const scopedInteractions = input.context.recentInteractions.filter(item => item.customerId !== null && allowlist.includes(item.customerId));
  const interactions = scopedInteractions.slice(0, MODEL_CONTEXT_LIMITS.max_recent_interactions).map(interactionProjection);
  if (scopedInteractions.length > interactions.length) truncated.add('recent_interactions');

  const scopedMemory = (input.memory?.items ?? []).filter(item => allowlist.includes(item.customer_id));
  if (input.memory && !allowlist.includes(input.memory.customer_id)) throw new Error('Memory context customer scope mismatch.');
  const memoryItems = scopedMemory.slice(0, MODEL_CONTEXT_LIMITS.max_active_memory).map(memoryProjection);
  if (scopedMemory.length > memoryItems.length) truncated.add('active_memory');

  const taskAllowed = ['customer_id', 'task_id', 'id', 'title', 'status', 'due_at', 'next_follow_up_at', 'summary', 'evidence_ids'] as const;
  const taskRecords = (input.tool_trace ?? [])
    .filter(tool => tool.tool_id === 'list_customer_tasks' || tool.tool_id === 'get_today_priority')
    .flatMap(tool => tool.records)
    .filter(record => {
      if (!record || typeof record !== 'object') return false;
      const customerId = (record as Record<string, unknown>).customer_id;
      return typeof customerId === 'string' && allowlist.includes(customerId);
    })
    .slice(0, MODEL_CONTEXT_LIMITS.max_tasks)
    .map(record => projectAllowedRecord(record as Record<string, unknown>, taskAllowed));

  const evidenceMap = new Map<string, ModelEvidenceRef>();
  const budget = { remaining: MODEL_CONTEXT_LIMITS.max_evidence_total_chars };
  for (const customer of customers) {
    for (const evidenceId of customer.evidenceIds) addEvidence(evidenceMap, {
      evidence_id: evidenceId, customer_id: customer.customerId, source_type: 'customer',
      source_record_id: customer.customerId, fact_ids: ['customer_profile'], created_at: customer.observedAt,
      summary: `${customer.name} (${customer.grade})`,
    }, budget);
  }
  for (const interaction of scopedInteractions) {
    for (const evidenceId of interaction.evidenceIds) addEvidence(evidenceMap, {
      evidence_id: evidenceId, customer_id: interaction.customerId, source_type: 'interaction',
      source_record_id: interaction.interactionId, fact_ids: [interaction.kind], created_at: interaction.occurredAt,
      summary: interaction.summary,
    }, budget);
  }
  for (const memory of scopedMemory) addEvidence(evidenceMap, {
    evidence_id: memory.evidence_reference, customer_id: memory.customer_id, source_type: 'memory',
    source_record_id: memory.memory_id, fact_ids: [memory.kind], created_at: memory.source_timestamp,
    summary: memory.summary,
  }, budget);

  const portfolio = input.portfolio_summary == null
    ? null
    : truncateText(input.portfolio_summary, MODEL_CONTEXT_LIMITS.max_portfolio_summary_chars);
  if (portfolio?.truncated) truncated.add('portfolio_summary');

  const mutable = {
    request_id: input.request_id,
    intent: input.intent,
    customer_id: input.customer_id,
    customer_allowlist: allowlist,
    portfolio_summary: portfolio?.text ?? null,
    selected_crm_facts: selectedFacts,
    recent_interactions: interactions,
    active_memory: memoryItems,
    relevant_tasks: taskRecords,
    evidence_map: [...evidenceMap.values()],
    user_instruction: instruction.text,
    locale: input.locale ?? 'zh-CN',
    timezone: input.timezone ?? 'Asia/Shanghai',
    safety_mode: 'human_review_required_no_crm_write' as const,
    requested_output_schema: input.output_schema,
    output_schema_spec: outputSchemaSpecFor(input.output_schema),
    truncated_fields: [] as string[],
  };

  const reductions: Array<[string, unknown[]]> = [
    ['relevant_tasks', mutable.relevant_tasks],
    ['active_memory', mutable.active_memory],
    ['recent_interactions', mutable.recent_interactions],
    ['evidence_map', mutable.evidence_map],
  ];
  while (byteLength({ ...mutable, truncated_fields: [...truncated] }) > MODEL_CONTEXT_LIMITS.max_request_json_bytes) {
    const target = reductions.find(([, values]) => values.length > 0);
    if (!target) throw new Error('ModelContextEnvelope exceeds final request byte hard cap.');
    target[1].pop();
    truncated.add(target[0]);
  }
  mutable.truncated_fields = [...truncated];
  const envelope: ModelContextEnvelope = mutable;
  assertEnvelopeHasNoSecrets(envelope);
  if (byteLength(envelope) > MODEL_CONTEXT_LIMITS.max_request_json_bytes) {
    throw new Error('ModelContextEnvelope exceeds final request byte hard cap.');
  }
  return envelope;
}

export function assertEnvelopeHasNoSecrets(envelope: ModelContextEnvelope): void {
  const visit = (value: unknown, key = ''): void => {
    if (containsDeniedKey(key)) throw new Error(`ModelContextEnvelope contains denied field: ${key}`);
    if (typeof value === 'string' && /(?:authorization\s*[:=]?\s*bearer|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i.test(value)) {
      throw new Error('ModelContextEnvelope contains denied credential material.');
    }
    if (Array.isArray(value)) value.forEach(item => visit(item));
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([nestedKey, nested]) => visit(nested, nestedKey));
  };
  visit(envelope);
}
