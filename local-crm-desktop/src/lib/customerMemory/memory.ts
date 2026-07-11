import type { CustomerMemoryContext, CustomerMemoryItem, CustomerMemoryReader } from './types';

const MAX_ITEMS = 50;
const MAX_CHARACTERS = 8_000;

export async function loadCustomerMemoryContext(input: {
  readonly customer_id: string;
  readonly reader: CustomerMemoryReader;
  readonly max_items?: number;
  readonly max_characters?: number;
}): Promise<CustomerMemoryContext> {
  return buildCustomerMemoryContext({
    customer_id: input.customer_id,
    items: await input.reader.list(input.customer_id),
    max_items: input.max_items,
    max_characters: input.max_characters,
  });
}

export function buildCustomerMemoryContext(input: {
  readonly customer_id: string;
  readonly items: readonly CustomerMemoryItem[];
  readonly max_items?: number;
  readonly max_characters?: number;
}): CustomerMemoryContext {
  const customerId = requireText(input.customer_id, 'customer_id');
  const maxItems = boundedInteger(input.max_items ?? 20, 'max_items', MAX_ITEMS);
  const maxCharacters = boundedInteger(input.max_characters ?? 4_000, 'max_characters', MAX_CHARACTERS);
  const identities = new Set<string>();
  const truthSources = new Set<string>();
  const normalized = input.items.map(item => normalizeItem(item, customerId, identities, truthSources))
    .toSorted((left, right) => Date.parse(right.source_timestamp) - Date.parse(left.source_timestamp));
  const items: CustomerMemoryItem[] = [];
  let characters = 0;
  for (const item of normalized) {
    if (items.length === maxItems || characters + item.summary.length > maxCharacters) break;
    items.push(item);
    characters += item.summary.length;
  }
  return { kind: 'CUSTOMER_MEMORY_CONTEXT', version: 'v1', customer_id: customerId, items, bounded: true, max_items: maxItems, max_characters: maxCharacters, persisted: false, read_only: true };
}

function normalizeItem(item: CustomerMemoryItem, customerId: string, identities: Set<string>, truthSources: Set<string>): CustomerMemoryItem {
  if (item.customer_id !== customerId) throw new Error('Customer memory item customer binding mismatch.');
  const memoryId = requireText(item.memory_id, 'memory_id');
  if (identities.has(memoryId)) throw new Error(`Duplicate customer memory id: ${memoryId}.`);
  identities.add(memoryId);
  const sourceReference = requireText(item.source_reference, 'source_reference');
  const evidenceReference = requireText(item.evidence_reference, 'evidence_reference');
  if (!['crm_record', 'human_decision', 'validated_reasoning_summary'].includes(item.source_kind)) throw new Error('Customer memory source kind is unsupported.');
  if (!['crm_record', 'human_decision', 'validated_reasoning_summary'].includes(item.validation_source)) throw new Error('Customer memory validation source is unsupported.');
  if (item.source_kind === 'validated_reasoning_summary' && item.human_verified !== true) throw new Error('Validated reasoning summaries require human verification.');
  if (!['fact', 'event', 'interaction', 'decision', 'reasoning_summary'].includes(item.kind)) throw new Error('Customer memory kind is unsupported.');
  const truthKey = `${item.kind}:${sourceReference}:${evidenceReference}`;
  if (truthSources.has(truthKey)) throw new Error('Customer memory cannot duplicate a truth source.');
  truthSources.add(truthKey);
  return { ...item, memory_id: memoryId, summary: requireText(item.summary, 'summary'), source_reference: sourceReference, evidence_reference: evidenceReference, source_timestamp: normalizeTimestamp(item.source_timestamp, 'source_timestamp'), recorded_at: normalizeTimestamp(item.recorded_at, 'recorded_at') };
}

function requireText(value: string, field: string): string { const text = value.trim(); if (!text) throw new Error(`Customer memory ${field} is required.`); return text; }
function normalizeTimestamp(value: string, field: string): string { const date = Date.parse(value); if (!Number.isFinite(date)) throw new Error(`Customer memory ${field} must be a timestamp.`); return new Date(date).toISOString(); }
function boundedInteger(value: number, field: string, maximum: number): number { if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Customer memory ${field} must be between 1 and ${maximum}.`); return value; }
