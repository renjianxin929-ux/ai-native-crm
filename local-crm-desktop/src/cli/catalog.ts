import {
  PRODUCTION_PLANNER_TOOL_SURFACE,
  type PlannerToolDescriptor,
} from '../lib/planner/plannerToolSurface';
import { describeCapabilityTransport, type CapabilityTransportStatus } from './capabilityTransport';

/**
 * Public, planner-derived projection for the C1 CLI catalog.  This is a
 * projection rather than a second capability registry: every call reads the
 * current production planner surface.
 */
export type CapabilityCatalogEntry = Pick<
  PlannerToolDescriptor,
  | 'capability_id'
  | 'version'
  | 'domain'
  | 'effect'
  | 'requires_confirmation'
  | 'semantic_hint'
  | 'input_schema'
> & Pick<CapabilityTransportStatus, 'transport' | 'reason' | 'invocation'>;

/**
 * Build the catalog directly from the production planner tool surface.
 *
 * The CLI deliberately has no local capability-ID authority, database lookup,
 * or execution path.  Unknown capabilities therefore cannot appear here.
 */
export function buildCapabilityCatalog(): readonly CapabilityCatalogEntry[] {
  return Object.freeze(
    PRODUCTION_PLANNER_TOOL_SURFACE.map((tool) => {
      const transport = describeCapabilityTransport(tool);
      return Object.freeze({
        capability_id: tool.capability_id,
        version: tool.version,
        domain: tool.domain,
        effect: tool.effect,
        requires_confirmation: tool.requires_confirmation,
        semantic_hint: tool.semantic_hint,
        input_schema: tool.input_schema,
        transport: transport.transport,
        reason: transport.reason,
        invocation: transport.invocation,
      });
    }),
  );
}
