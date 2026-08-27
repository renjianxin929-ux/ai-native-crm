import type { CapabilityInvocation } from '../lib/capabilities/execution/contract';
import { buildReadOnlySnapshotLoaderPlan, loadReadOnlySnapshotFromDb } from '../lib/readOnlySnapshotLoaderReadiness';
import { buildWorkspaceContextSnapshot } from '../lib/context/workspaceContextAdapter';
import type { DatabaseLike } from '../lib/db';
import { findPlannerTool, type PlannerToolDescriptor } from '../lib/planner/plannerToolSurface';

export type RuntimeHydratorErrorCode =
  | 'CAPABILITY_NOT_FOUND'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'INVALID_INPUT'
  | 'INVALID_SCOPE'
  | 'MISSING_SCOPE';

export class RuntimeHydratorError extends Error {
  readonly code: RuntimeHydratorErrorCode;

  constructor(code: RuntimeHydratorErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeHydratorError';
    this.code = code;
  }
}

export interface RuntimeHydratorSession {
  readonly selected_customer_id: string | null;
}

/**
 * Runtime-owned values are deliberately separate from agent args. The caller
 * has already selected the capability; this module only constructs its input.
 */
export interface RuntimeHydratorInput {
  readonly profile: string;
  readonly profileDb: DatabaseLike;
  readonly capability_id: string;
  readonly capability_version?: string;
  readonly args: unknown;
  /** Native runtime File supplied only by the import preview CLI transport. */
  readonly file?: unknown;
  readonly session?: RuntimeHydratorSession | null;
  readonly now?: string;
}

type JsonRecord = Record<string, unknown>;

/**
 * This is an execution-slice boundary, not a second capability registry. The
 * production planner surface remains the identity source; C3 deliberately
 * enables only the enumerated READ paths below.
 */
export const C3_CORE_READ_CAPABILITY_IDS = Object.freeze([
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
] as const);

const C3_CORE_READ_CAPABILITY_ID_SET: ReadonlySet<string> = new Set(C3_CORE_READ_CAPABILITY_IDS);

export function isC3CoreReadCapability(capabilityId: string): boolean {
  return C3_CORE_READ_CAPABILITY_ID_SET.has(capabilityId);
}

function isPlainObject(value: unknown): value is JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value: unknown, message: string): JsonRecord {
  if (!isPlainObject(value)) throw new RuntimeHydratorError('INVALID_INPUT', message);
  return value;
}

function assertDatabaseLike(value: unknown): asserts value is DatabaseLike {
  if (typeof value !== 'object' || value === null
    || !('select' in value) || !('execute' in value)
    || typeof value.select !== 'function' || typeof value.execute !== 'function') {
    throw new RuntimeHydratorError('INVALID_INPUT', 'A profile DatabaseLike handle is required.');
  }
}

function assertAllowedFields(
  record: JsonRecord,
  fields: readonly string[],
  capabilityId: string,
  extraAllowedFields: readonly string[] = [],
): void {
  const allowed = new Set(fields);
  for (const field of extraAllowedFields) allowed.add(field);
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      throw new RuntimeHydratorError('INVALID_INPUT', `${capabilityId} received an unsupported agent argument: ${field}.`);
    }
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RuntimeHydratorError('INVALID_INPUT', `${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  return value === undefined ? undefined : requireNonEmptyString(value, field);
}

function runtimeNow(value: string | undefined): string {
  const now = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) {
    throw new RuntimeHydratorError('INVALID_INPUT', 'Runtime now must be a valid timestamp.');
  }
  return now;
}

function resolveVersion(input: RuntimeHydratorInput, descriptor: PlannerToolDescriptor): string {
  if (input.capability_version === undefined) return descriptor.version;

  const version = requireNonEmptyString(input.capability_version, 'capability_version');
  if (version !== descriptor.version) {
    throw new RuntimeHydratorError(
      'CAPABILITY_NOT_FOUND',
      `${descriptor.capability_id} version does not match the production planner surface.`,
    );
  }
  return version;
}

function resolveDescriptor(capabilityId: string): PlannerToolDescriptor {
  if (typeof capabilityId !== 'string' || capabilityId.trim().length === 0) {
    throw new RuntimeHydratorError('CAPABILITY_NOT_FOUND', 'A capability id is required.');
  }
  const descriptor = findPlannerTool(capabilityId);
  if (descriptor === null) {
    throw new RuntimeHydratorError('CAPABILITY_NOT_FOUND', `Unknown capability: ${capabilityId}.`);
  }
  return descriptor;
}

function explicitCustomerId(
  args: unknown,
  descriptor: PlannerToolDescriptor,
): string | undefined {
  if (args === undefined) return undefined;
  const record = requirePlainObject(args, `${descriptor.capability_id} requires an object of agent arguments.`);
  // customer_id is a runtime scope overlay. It is intentionally not projected
  // into the planner schema and must never become the business input payload.
  assertAllowedFields(record, descriptor.input_schema.allowed_fields, descriptor.capability_id, ['customer_id']);
  const customerId = record.customer_id;
  return customerId === undefined ? undefined : requireNonEmptyString(customerId, 'customer_id');
}

function sessionCustomerId(session: RuntimeHydratorSession | null | undefined): string | undefined {
  if (session === undefined || session === null) return undefined;
  const selectedCustomerId = session.selected_customer_id;
  if (selectedCustomerId === null) return undefined;
  if (typeof selectedCustomerId !== 'string' || selectedCustomerId.trim().length === 0) {
    throw new RuntimeHydratorError('INVALID_SCOPE', 'Session selected_customer_id is invalid.');
  }
  return selectedCustomerId;
}

function resolveCustomerScope(input: RuntimeHydratorInput, descriptor: PlannerToolDescriptor): string {
  const fromArgs = explicitCustomerId(input.args, descriptor);
  if (fromArgs !== undefined) return fromArgs;

  const fromSession = sessionCustomerId(input.session);
  if (fromSession !== undefined) return fromSession;

  throw new RuntimeHydratorError('MISSING_SCOPE', `${descriptor.capability_id} requires an explicit customer scope.`);
}

function hydrateCustomerSearch(
  input: RuntimeHydratorInput,
  descriptor: PlannerToolDescriptor,
  capabilityVersion: string,
): CapabilityInvocation {
  const args = requirePlainObject(input.args ?? {}, 'customer.search requires an object of agent arguments.');
  assertAllowedFields(args, descriptor.input_schema.allowed_fields, descriptor.capability_id);

  const list_kind = optionalString(args, 'list_kind');
  if (list_kind !== undefined && list_kind !== 'portfolio' && list_kind !== 'resolution') {
    throw new RuntimeHydratorError('INVALID_INPUT', 'list_kind must be portfolio or resolution.');
  }

  const filters: JsonRecord = { now: runtimeNow(input.now) };
  for (const field of descriptor.input_schema.allowed_fields) {
    if (field === 'list_kind') continue;
    const value = optionalString(args, field);
    if (value !== undefined) filters[field] = value;
  }

  assertDatabaseLike(input.profileDb);
  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: {
      filters,
      ...(list_kind !== undefined ? { list_kind } : {}),
      db: input.profileDb,
    },
    scope: {},
  };
}

function hydrateCustomerScopedNoArgRead(
  input: RuntimeHydratorInput,
  descriptor: PlannerToolDescriptor,
  capabilityVersion: string,
): CapabilityInvocation {
  const customerId = resolveCustomerScope(input, descriptor);
  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: undefined,
    scope: { customer_id: customerId },
  };
}

function hydrateBattleCardRead(
  input: RuntimeHydratorInput,
  descriptor: PlannerToolDescriptor,
  capabilityVersion: string,
): CapabilityInvocation {
  const customerId = resolveCustomerScope(input, descriptor);
  assertDatabaseLike(input.profileDb);
  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: { db: input.profileDb },
    scope: { customer_id: customerId },
  };
}

function hydrateGlobalNoArgRead(
  input: RuntimeHydratorInput,
  descriptor: PlannerToolDescriptor,
  capabilityVersion: string,
): CapabilityInvocation {
  if (input.args !== undefined) {
    const args = requirePlainObject(input.args, `${descriptor.capability_id} takes no agent arguments.`);
    assertAllowedFields(args, descriptor.input_schema.allowed_fields, descriptor.capability_id);
  }
  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: undefined,
    scope: {},
  };
}

function hydrateImportMappingValidation(
  input: RuntimeHydratorInput,
  descriptor: PlannerToolDescriptor,
  capabilityVersion: string,
): CapabilityInvocation {
  if (!Array.isArray(input.args)) {
    throw new RuntimeHydratorError('INVALID_INPUT', 'import.mapping.validate requires an array of field mappings.');
  }
  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: input.args,
    scope: {},
  };
}

function hydrateImportFilePreview(
  input: RuntimeHydratorInput,
  descriptor: PlannerToolDescriptor,
  capabilityVersion: string,
): CapabilityInvocation {
  if (!(input.file instanceof File)) {
    throw new RuntimeHydratorError('INVALID_INPUT', 'import.file.preview requires a native runtime File.');
  }
  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: input.file,
    scope: {},
  };
}

async function hydrateCustomerScopedRead(
  input: RuntimeHydratorInput,
  descriptor: PlannerToolDescriptor,
  capabilityVersion: string,
): Promise<CapabilityInvocation> {
  const customerId = resolveCustomerScope(input, descriptor);
  assertDatabaseLike(input.profileDb);

  const now = runtimeNow(input.now);
  const plan = buildReadOnlySnapshotLoaderPlan({
    kind: 'READ_ONLY_SNAPSHOT_LOADER_REQUEST',
    active_profile_id: requireNonEmptyString(input.profile, 'profile'),
    now,
    filters: { target_customer_id: customerId },
  });
  const { snapshot } = await loadReadOnlySnapshotFromDb(input.profileDb, plan);

  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: {
      snapshot,
      context: buildWorkspaceContextSnapshot(snapshot),
    },
    scope: { customer_id: customerId },
  };
}

/**
 * Converts an already-selected capability and pure agent args into the exact
 * invocation shape consumed by the existing engine. It never selects or runs
 * a capability, and it has no default database fallback.
 */
export async function hydrateRuntimeInvocation(input: RuntimeHydratorInput): Promise<CapabilityInvocation> {
  requireNonEmptyString(input.profile, 'profile');
  const descriptor = resolveDescriptor(input.capability_id);
  const capabilityVersion = resolveVersion(input, descriptor);

  switch (descriptor.capability_id) {
    case 'customer.search':
      return hydrateCustomerSearch(input, descriptor, capabilityVersion);
    case 'customer.get':
    case 'customer.context':
      return hydrateCustomerScopedRead(input, descriptor, capabilityVersion);
    case 'timeline.customer.read':
    case 'timeline.visit.read':
    case 'follow_up.customer.read':
    case 'task.read_by_customer':
      return hydrateCustomerScopedNoArgRead(input, descriptor, capabilityVersion);
    case 'follow_up.global.read':
      return hydrateGlobalNoArgRead(input, descriptor, capabilityVersion);
    case 'battle_card.current.read':
    case 'battle_card.history.read':
    case 'battle_card.context.read':
      return hydrateBattleCardRead(input, descriptor, capabilityVersion);
    case 'import.mapping.validate':
      return hydrateImportMappingValidation(input, descriptor, capabilityVersion);
    case 'import.file.preview':
      return hydrateImportFilePreview(input, descriptor, capabilityVersion);
    default:
      throw new RuntimeHydratorError(
        'CAPABILITY_NOT_SUPPORTED',
        `${descriptor.capability_id} is not hydrated by the C3 runtime slice.`,
      );
  }
}

export const hydrateCapabilityInvocation = hydrateRuntimeInvocation;
