/**
 * Runtime Context Materializer.
 *
 * Planner chooses capability_id + business arguments.
 * Runtime supplies scope, DB, snapshots, trusted objects.
 * No model may invent db / customer_id / snapshot / File handles / system timestamps.
 */

import type { DatabaseLike } from '../db';
import type { ContextSnapshot } from '../context/types';
import type { CustomerMemoryContext } from '../customerMemory';
import {
  READ_ONLY_SNAPSHOT_LOADER_VERSION,
  type LoadedReadOnlyAgentSnapshot,
} from '../readOnlySnapshotLoaderReadiness';
import { findPlannerTool } from './plannerToolSurface';
import { PLANNER_INPUT_SCHEMAS } from './plannerInputSchema';

const RUNTIME_OWNED_KEYS = new Set([
  'db',
  'snapshot',
  'context',
  'memory',
  'clock',
  'File',
  'file',
  'customer_id',
  'customerId',
]);

export interface RuntimeMaterializerContext {
  readonly db: DatabaseLike;
  readonly clock: () => string;
  readonly scoped_customer_id: string | null;
  readonly snapshot?: LoadedReadOnlyAgentSnapshot | null;
  readonly context?: ContextSnapshot | null;
  readonly memory?: CustomerMemoryContext;
  readonly import_file?: File | null;
  readonly import_mappings?: unknown;
}

export function stripRuntimeOwnedArguments(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (RUNTIME_OWNED_KEYS.has(key)) continue;
    next[key] = value;
  }
  return next;
}

async function loadCustomerRow(
  db: DatabaseLike,
  customerId: string,
): Promise<{ id: string; name: string; customer_grade?: string; intent_level?: string } | null> {
  const rows = await db.select<{ id: string; name: string; customer_grade?: string; intent_level?: string }>(
    'SELECT id, name, customer_grade, intent_level FROM customers WHERE id = ? LIMIT 1',
    [customerId],
  );
  return rows[0] ?? null;
}

function emptySnapshot(nowIso: string, customer?: { id: string; name: string; customer_grade?: string; intent_level?: string }): LoadedReadOnlyAgentSnapshot {
  return {
    kind: 'LOADED_READ_ONLY_AGENT_SNAPSHOT',
    version: READ_ONLY_SNAPSHOT_LOADER_VERSION,
    snapshot_id: `runtime:${customer?.id ?? 'none'}`,
    synthetic: false,
    persisted: true,
    load_source: 'sqlite_read_only',
    loaded_at: nowIso,
    context: { active_profile_id: 'production', now: nowIso },
    work_items: [],
    collected_leads: [],
    replay_evidence: [],
    import_rows: [],
    capture_events: [],
    customers: customer
      ? [{
          id: customer.id,
          name: customer.name,
          customer_grade: customer.customer_grade ?? 'C',
          intent_level: customer.intent_level ?? 'UNKNOWN',
          evidence_ref: { type: 'customer', id: customer.id, label: customer.name, synthetic: false, persisted: true },
        }]
      : [],
    tasks: [],
    prompt_plans: [],
    model_invocations: [],
    eval_summaries: [],
  };
}

function emptyContext(nowIso: string, customer?: { id: string; name: string; customer_grade?: string; intent_level?: string }): ContextSnapshot {
  return {
    kind: 'CRM_CONTEXT_SNAPSHOT',
    version: 'v1',
    snapshotId: `runtime-context:${customer?.id ?? 'none'}`,
    capturedAt: nowIso,
    timeWindow: { from: nowIso, to: nowIso },
    customers: customer
      ? [{
          customerId: customer.id,
          name: customer.name,
          grade: customer.customer_grade ?? 'C',
          intentLevel: customer.intent_level ?? 'UNKNOWN',
          observedAt: nowIso,
          evidenceIds: [`customer:${customer.id}`],
        }]
      : [],
    accounts: [],
    recentInteractions: [],
    evidenceIdentifiers: customer ? [`customer:${customer.id}`] : [],
    bounded: true,
    maxInteractions: 20,
    readOnly: true,
  };
}

/**
 * Materialize production runtime input for one of the 25 capabilities.
 * Business arguments stay; runtime objects are injected from trusted context.
 */
export async function materializeRuntimeInput(
  capabilityId: string,
  businessArguments: Readonly<Record<string, unknown>>,
  runtime: RuntimeMaterializerContext,
): Promise<unknown> {
  const tool = findPlannerTool(capabilityId);
  if (!tool) throw new Error(`Unknown production capability: ${capabilityId}`);
  const args = stripRuntimeOwnedArguments(businessArguments);
  const nowIso = runtime.clock();

  switch (capabilityId) {
    case 'customer.search': {
      const rawFilters = (args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)
        ? args.filters
        : args) as Record<string, unknown>;
      const { list_kind: _listKind, db: _db, ...filterFields } = rawFilters;
      return {
        filters: { ...filterFields, now: nowIso },
        list_kind: args.list_kind === 'resolution' ? 'resolution' : 'portfolio',
        db: runtime.db,
      };
    }
    case 'customer.get':
    case 'customer.context': {
      const customerId = runtime.scoped_customer_id;
      if (!customerId) throw new Error('该能力需要已定位的客户。');
      let snapshot = runtime.snapshot ?? null;
      let context = runtime.context ?? null;
      if (!snapshot || !context) {
        const row = await loadCustomerRow(runtime.db, customerId);
        if (!row) throw new Error('客户不存在。');
        snapshot = snapshot ?? emptySnapshot(nowIso, row);
        context = context ?? emptyContext(nowIso, row);
      }
      return {
        snapshot,
        context,
        ...(runtime.memory ? { memory: runtime.memory } : {}),
      };
    }
    case 'timeline.customer.read':
    case 'timeline.visit.read':
    case 'follow_up.customer.read':
    case 'follow_up.global.read':
    case 'task.read_by_customer':
      return {};
    case 'battle_card.current.read':
    case 'battle_card.history.read':
    case 'battle_card.context.read':
    case 'battle_card.draft.create':
      return { db: runtime.db, clock: runtime.clock };
    case 'import.file.preview':
      if (!runtime.import_file) throw new Error('请先选择要导入的文件。');
      return runtime.import_file;
    case 'import.mapping.validate':
      if (!runtime.import_mappings) throw new Error('请提供导入字段映射。');
      return runtime.import_mappings;
    case 'customer.next_follow_up_time.update':
    case 'customer.profile.update':
    case 'customer.opportunity_amount.update':
    case 'customer.delete':
    case 'visit.create':
    case 'battle_card.confirm':
    case 'battle_card.hypothesis.status.update':
    case 'battle_card.intelligence_import.confirm':
      return { ...args, db: runtime.db };
    case 'follow_up.create':
    case 'task.create':
    case 'customer.create':
      return args;
    default: {
      const schema = PLANNER_INPUT_SCHEMAS[capabilityId];
      if (schema && schema.allowed_fields.length === 0) return {};
      return args;
    }
  }
}

export const ALL_25_RUNTIME_INPUT_CAPABILITY_IDS: readonly string[] = [
  'customer.search',
  'customer.get',
  'customer.context',
  'timeline.customer.read',
  'timeline.visit.read',
  'follow_up.customer.read',
  'follow_up.global.read',
  'task.read_by_customer',
  'battle_card.current.read',
  'battle_card.history.read',
  'battle_card.context.read',
  'import.file.preview',
  'import.mapping.validate',
  'customer.next_follow_up_time.update',
  'follow_up.create',
  'task.create',
  'battle_card.draft.create',
  'battle_card.confirm',
  'battle_card.hypothesis.status.update',
  'battle_card.intelligence_import.confirm',
  'customer.create',
  'customer.profile.update',
  'customer.delete',
  'visit.create',
  'customer.opportunity_amount.update',
];
