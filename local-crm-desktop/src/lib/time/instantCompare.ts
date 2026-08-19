/**
 * Canonical instant comparison.
 *
 * Persistence may store either Z or +08:00 (both valid instants).
 * Never sort mixed-offset timestamps with localeCompare.
 * Natural-language parse/display stays in the local timezone; comparison uses Date.parse.
 */

export function instantMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function compareInstant(left: string | null | undefined, right: string | null | undefined): number {
  const a = instantMs(left);
  const b = instantMs(right);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export function sortByInstantDesc<T>(items: readonly T[], timestamp: (item: T) => string | null | undefined): T[] {
  return [...items].sort((left, right) => compareInstant(timestamp(right), timestamp(left)));
}

export function maxInstant(values: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const ms = instantMs(value);
    if (ms != null && ms >= bestMs) {
      best = value ?? null;
      bestMs = ms;
    }
  }
  return best;
}
