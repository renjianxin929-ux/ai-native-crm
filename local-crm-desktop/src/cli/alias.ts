import { PRODUCTION_PLANNER_TOOL_SURFACE } from '../lib/planner/plannerToolSurface';

interface CapabilityAliasSource {
  readonly capability_id: string;
}

export interface CapabilityAlias {
  readonly alias: string;
  readonly capability_id: string;
  readonly tokens: readonly string[];
}

export interface CapabilityAliasMatch {
  readonly capability_id: string;
  readonly consumed: number;
}

/** A derived alias must never silently choose between two Planner Surface IDs. */
export class CapabilityAliasConflictError extends Error {
  readonly alias: string;
  readonly capability_ids: readonly [string, string];

  constructor(alias: string, firstCapabilityId: string, secondCapabilityId: string) {
    super(
      `Capability alias conflict for "${alias}": ${firstCapabilityId} and ${secondCapabilityId}.`,
    );
    this.name = 'CapabilityAliasConflictError';
    this.alias = alias;
    this.capability_ids = Object.freeze([firstCapabilityId, secondCapabilityId]);
  }
}

/**
 * Mechanical C8 spelling only: capability ID segments become CLI words, and
 * underscores within a segment become hyphens. It performs no semantic routing.
 */
export function deriveCapabilityAlias(capabilityId: string): string {
  return capabilityId
    .split('.')
    .map((segment) => segment.replaceAll('_', '-'))
    .join(' ');
}

/**
 * Derive aliases exclusively from a Planner Surface. A collision stops startup
 * instead of overwriting a target or guessing which capability was intended.
 */
export function buildCapabilityAliases(
  surface: readonly CapabilityAliasSource[] = PRODUCTION_PLANNER_TOOL_SURFACE,
): readonly CapabilityAlias[] {
  const capabilityIdByAlias = new Map<string, string>();
  const aliases: CapabilityAlias[] = [];

  for (const descriptor of surface) {
    const capabilityId = descriptor.capability_id;
    const alias = deriveCapabilityAlias(capabilityId);
    const existingCapabilityId = capabilityIdByAlias.get(alias);
    if (existingCapabilityId !== undefined && existingCapabilityId !== capabilityId) {
      throw new CapabilityAliasConflictError(alias, existingCapabilityId, capabilityId);
    }
    if (existingCapabilityId !== undefined) continue;

    capabilityIdByAlias.set(alias, capabilityId);
    aliases.push(Object.freeze({
      alias,
      capability_id: capabilityId,
      tokens: Object.freeze(alias.split(' ')),
    }));
  }

  return Object.freeze(aliases);
}

/** The complete C8 alias surface is always derived from the Planner Surface. */
export const CAPABILITY_ALIASES: readonly CapabilityAlias[] = buildCapabilityAliases();

/** Exact lookup only; it does not normalize, complete, or reinterpret words. */
export function resolveCapabilityAlias(alias: string): string | null {
  return CAPABILITY_ALIASES.find((entry) => entry.alias === alias)?.capability_id ?? null;
}

/** Resolve the longest exact alias at the start of a command line. */
export function resolveCapabilityAliasPrefix(tokens: readonly string[]): CapabilityAliasMatch | null {
  let match: CapabilityAlias | null = null;

  for (const candidate of CAPABILITY_ALIASES) {
    if (candidate.tokens.length > tokens.length) continue;
    if (!candidate.tokens.every((word, index) => tokens[index] === word)) continue;
    if (match === null || candidate.tokens.length > match.tokens.length) match = candidate;
  }

  return match === null
    ? null
    : Object.freeze({ capability_id: match.capability_id, consumed: match.tokens.length });
}

/** Restrict alias parsing to a derived domain word; other commands stay unknown. */
export function isCapabilityAliasDomain(token: string): boolean {
  return CAPABILITY_ALIASES.some((entry) => entry.tokens[0] === token);
}
