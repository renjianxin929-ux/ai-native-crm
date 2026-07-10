import type { ContextBuilderInput, ContextSnapshot } from './types';

const DEFAULT_MAX_INTERACTIONS = 50;
const MAX_ALLOWED_INTERACTIONS = 200;

export function buildContextSnapshot(input: ContextBuilderInput): ContextSnapshot {
  const from = parseTimestamp(input.timeWindow.from, 'timeWindow.from');
  const to = parseTimestamp(input.timeWindow.to, 'timeWindow.to');
  if (from > to) throw new Error('Context time window must not be reversed.');

  const requestedLimit = input.maxInteractions ?? DEFAULT_MAX_INTERACTIONS;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_ALLOWED_INTERACTIONS) {
    throw new Error(`maxInteractions must be between 1 and ${MAX_ALLOWED_INTERACTIONS}.`);
  }

  const recentInteractions = input.interactions
    .filter(interaction => {
      const occurredAt = parseTimestamp(interaction.occurredAt, `interaction:${interaction.interactionId}`);
      return occurredAt >= from && occurredAt <= to;
    })
    .toSorted((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, requestedLimit);

  const evidenceIdentifiers = uniqueSorted([
    ...input.customers.flatMap(fact => fact.evidenceIds),
    ...input.accounts.flatMap(fact => fact.evidenceIds),
    ...recentInteractions.flatMap(fact => fact.evidenceIds),
  ]);

  return {
    kind: 'CRM_CONTEXT_SNAPSHOT',
    version: 'v1',
    snapshotId: requireText(input.snapshotId, 'snapshotId'),
    capturedAt: new Date(parseTimestamp(input.capturedAt, 'capturedAt')).toISOString(),
    timeWindow: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
    customers: input.customers.map(copyCustomerFact),
    accounts: input.accounts.map(copyAccountFact),
    recentInteractions: recentInteractions.map(copyInteractionFact),
    evidenceIdentifiers,
    bounded: true,
    maxInteractions: requestedLimit,
    readOnly: true,
  };
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid timestamp.`);
  return parsed;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].toSorted();
}

function copyCustomerFact<T extends ContextBuilderInput['customers'][number]>(fact: T): T {
  return { ...fact, evidenceIds: [...fact.evidenceIds] };
}

function copyAccountFact<T extends ContextBuilderInput['accounts'][number]>(fact: T): T {
  return { ...fact, evidenceIds: [...fact.evidenceIds] };
}

function copyInteractionFact<T extends ContextBuilderInput['interactions'][number]>(fact: T): T {
  return { ...fact, evidenceIds: [...fact.evidenceIds] };
}
