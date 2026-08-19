/**
 * One resumable pending capability turn.
 * Clarification answers merge into THIS turn; they are not reinterpreted as a new request.
 *
 * clarification_answer is conversation/runtime metadata. It is never a CRM business field
 * and must never be forwarded into capability arguments / Layer-1 input.
 */

export const CONTINUATION_RUNTIME_METADATA_KEYS: readonly string[] = ['clarification_answer'];

const RUNTIME_METADATA = new Set(CONTINUATION_RUNTIME_METADATA_KEYS);

export interface PendingCapabilityTurn {
  readonly capability_id: string | null;
  readonly original_instruction: string;
  readonly parsed_arguments: Readonly<Record<string, unknown>>;
  readonly missing_fields: readonly string[];
  readonly clarification_question: string;
  readonly customer_scope: string | null;
  readonly created_at: string;
}

export function createPendingCapabilityTurn(input: {
  readonly capability_id: string | null;
  readonly original_instruction: string;
  readonly parsed_arguments?: Readonly<Record<string, unknown>>;
  readonly missing_fields: readonly string[];
  readonly clarification_question: string;
  readonly customer_scope: string | null;
  readonly created_at: string;
}): PendingCapabilityTurn {
  return {
    capability_id: input.capability_id,
    original_instruction: input.original_instruction,
    parsed_arguments: omitRuntimeMetadata(input.parsed_arguments ?? {}),
    missing_fields: [...input.missing_fields].filter(field => !RUNTIME_METADATA.has(field)),
    clarification_question: input.clarification_question,
    customer_scope: input.customer_scope,
    created_at: input.created_at,
  };
}

export function isContinuationRuntimeMetadata(key: string): boolean {
  return RUNTIME_METADATA.has(key);
}

/** Strip conversation transport keys. Does not delete unknown real business fields. */
export function omitRuntimeMetadata(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!RUNTIME_METADATA.has(key)) parsed[key] = value;
  }
  return parsed;
}

export function mergePendingCapabilityAnswer(
  pending: PendingCapabilityTurn,
  answer: string,
  parsedTimeIso?: string | null,
): PendingCapabilityTurn {
  const trimmed = answer.trim();
  const missing = [...pending.missing_fields].filter(field => !RUNTIME_METADATA.has(field));
  const parsed = omitRuntimeMetadata(pending.parsed_arguments);
  if (missing.length > 0) {
    const field = missing.shift()!;
    const timeField = field === 'next_follow_up_time' ? 'next_follow_up_at' : field === 'due_at_time' ? 'due_at' : field;
    parsed[timeField] = parsedTimeIso && /(_at|_time)$/.test(field) ? parsedTimeIso : trimmed;
  }
  return {
    ...pending,
    parsed_arguments: parsed,
    missing_fields: missing,
    clarification_question: missing.length ? pending.clarification_question : '',
  };
}

/** Merge legitimate business fields discovered by re-parsing the pending request + reply. */
export function mergePendingBusinessArguments(
  pending: PendingCapabilityTurn,
  fields: Readonly<Record<string, unknown>>,
): PendingCapabilityTurn {
  const parsed = omitRuntimeMetadata(pending.parsed_arguments);
  const filled = new Set<string>();
  for (const [key, value] of Object.entries(fields)) {
    if (RUNTIME_METADATA.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    parsed[key] = value;
    filled.add(key);
    if (key === 'next_follow_up_at') filled.add('next_follow_up_time');
    if (key === 'due_at') filled.add('due_at_time');
  }
  const missing = pending.missing_fields.filter((field) => {
    if (RUNTIME_METADATA.has(field)) return false;
    const mapped = field === 'next_follow_up_time' ? 'next_follow_up_at' : field === 'due_at_time' ? 'due_at' : field;
    return !filled.has(field) && !filled.has(mapped) && parsed[mapped] == null && parsed[field] == null;
  });
  return {
    ...pending,
    parsed_arguments: parsed,
    missing_fields: missing,
    clarification_question: missing.length ? pending.clarification_question : '',
  };
}
