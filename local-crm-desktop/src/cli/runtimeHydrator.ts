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
  readonly session?: RuntimeHydratorSession | null;
  readonly now?: string;
}

type JsonRecord = Record<string, unknown>;

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

function assertAllowedFields(record: JsonRecord, fields: readonly string[], capabilityId: string): void {
  const allowed = new Set(fields);
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
  const version = input.capability_version ?? descriptor.version;
  return requireNonEmptyString(version, 'capability_version');
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
  assertAllowedFields(record, descriptor.input_schema.allowed_fields, descriptor.capability_id);

  if (!descriptor.input_schema.allowed_fields.includes('customer_id')) return undefined;
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
  const args = requirePlainObject(input.args, 'customer.search requires an object of agent arguments.');
  assertAllowedFields(args, ['name_query', 'region', 'industry', 'customer_grade', 'list_kind'], descriptor.capability_id);

  const name_query = requireNonEmptyString(args.name_query, 'name_query');
  const region = optionalString(args, 'region');
  const industry = optionalString(args, 'industry');
  const customer_grade = optionalString(args, 'customer_grade');
  const list_kind = optionalString(args, 'list_kind');
  if (list_kind !== undefined && list_kind !== 'portfolio' && list_kind !== 'resolution') {
    throw new RuntimeHydratorError('INVALID_INPUT', 'list_kind must be portfolio or resolution.');
  }

  assertDatabaseLike(input.profileDb);
  return {
    capability_id: descriptor.capability_id,
    capability_version: capabilityVersion,
    input: {
      filters: {
        name_query,
        ...(region !== undefined ? { region } : {}),
        ...(industry !== undefined ? { industry } : {}),
        ...(customer_grade !== undefined ? { customer_grade } : {}),
        now: runtimeNow(input.now),
      },
      ...(list_kind !== undefined ? { list_kind } : {}),
      db: input.profileDb,
    },
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
    default:
      throw new RuntimeHydratorError(
        'CAPABILITY_NOT_SUPPORTED',
        `${descriptor.capability_id} is not hydrated by the C2 runtime slice.`,
      );
  }
}

export const hydrateCapabilityInvocation = hydrateRuntimeInvocation;
