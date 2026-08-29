import {
  isC3CoreReadCapability,
  isC4WriteProposalCapability,
} from './runtimeHydrator';
import {
  findPlannerTool,
  type PlannerToolDescriptor,
} from '../lib/planner/plannerToolSurface';

export type CapabilityTransport = 'SUPPORTED' | 'EXPLICITLY_UNSUPPORTED';

export type CapabilityTransportStatus =
  | Readonly<{
    capability_id: string;
    version: string;
    transport: 'SUPPORTED';
    reason: null;
    invocation: string;
  }>
  | Readonly<{
    capability_id: string;
    version: string;
    transport: 'EXPLICITLY_UNSUPPORTED';
    reason: string;
    invocation: null;
  }>;

function isCurrentlyTransportedCapability(capabilityId: string): boolean {
  // C7 owns no capability-ID allowlist. The prior C3/C4 slices remain the
  // sole declarations of the CLI paths that can reach the existing runtime.
  return isC3CoreReadCapability(capabilityId) || isC4WriteProposalCapability(capabilityId);
}

function supportedInvocation(descriptor: PlannerToolDescriptor): string {
  if (descriptor.capability_id === 'import.file.preview') {
    return 'cap import.file.preview --file <path>';
  }
  return `cap ${descriptor.capability_id} --args <json>`;
}

function explicitlyUnsupportedReason(descriptor: PlannerToolDescriptor): string {
  if (descriptor.effect === 'READ' || descriptor.effect === 'ANALYZE') {
    return 'C7: read hydrator not implemented';
  }
  if (descriptor.effect === 'DRAFT') {
    return 'C7: draft persistence path not wired; no CLI transport is implemented';
  }
  if (descriptor.requires_confirmation) {
    return 'C7: write path not wired; requires confirmation persistence beyond current C4 allowlist';
  }
  return 'C7: persistence path not wired; no CLI transport is implemented';
}

/**
 * Derive C7 transport status from a planner-surface descriptor. This never
 * changes the descriptor, Registry, authority policy, or confirmation flow.
 */
export function describeCapabilityTransport(descriptor: PlannerToolDescriptor): CapabilityTransportStatus {
  if (isCurrentlyTransportedCapability(descriptor.capability_id)) {
    return Object.freeze({
      capability_id: descriptor.capability_id,
      version: descriptor.version,
      transport: 'SUPPORTED',
      reason: null,
      invocation: supportedInvocation(descriptor),
    });
  }

  return Object.freeze({
    capability_id: descriptor.capability_id,
    version: descriptor.version,
    transport: 'EXPLICITLY_UNSUPPORTED',
    reason: explicitlyUnsupportedReason(descriptor),
    invocation: null,
  });
}

/** Unknown IDs intentionally resolve to null so callers preserve NOT_FOUND. */
export function findCapabilityTransport(capabilityId: string): CapabilityTransportStatus | null {
  const descriptor = findPlannerTool(capabilityId);
  return descriptor === null ? null : describeCapabilityTransport(descriptor);
}
