import type { AIReasoningOutput, OutputValidationResult } from './types';
import type { ContextSnapshot } from '../context/types';

export function validateAIReasoningOutput(value: unknown): OutputValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['output must be an object'] };
  if (value.kind !== 'AI_REASONING_OUTPUT') errors.push('kind must be AI_REASONING_OUTPUT');
  if (value.version !== 'v1') errors.push('version must be v1');
  if (!Array.isArray(value.suggestions)) {
    errors.push('suggestions must be an array');
    return { valid: false, errors };
  }
  value.suggestions.forEach((suggestion, index) => validateSuggestion(suggestion, index, errors));
  return { valid: errors.length === 0, errors };
}

export function validateEvidenceReferences(
  output: AIReasoningOutput,
  context: ContextSnapshot,
): OutputValidationResult {
  const knownIds = new Set(context.evidenceIdentifiers);
  const errors: string[] = [];
  output.suggestions.forEach((suggestion, suggestionIndex) => {
    if (suggestion.evidence.length === 0) errors.push(`suggestions[${suggestionIndex}] requires evidence`);
    suggestion.evidence.forEach((reference, evidenceIndex) => {
      if (!knownIds.has(reference.evidenceId)) {
        errors.push(`suggestions[${suggestionIndex}].evidence[${evidenceIndex}] has unknown evidence id`);
      }
    });
  });
  return { valid: errors.length === 0, errors };
}

function validateSuggestion(value: unknown, index: number, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`suggestions[${index}] must be an object`);
    return;
  }
  for (const field of ['suggestionId', 'title', 'summary'] as const) {
    if (typeof value[field] !== 'string' || value[field].trim().length === 0) {
      errors.push(`suggestions[${index}].${field} is required`);
    }
  }
  if (value.requiresHumanReview !== true) errors.push(`suggestions[${index}] requires human review`);
  if (value.executable !== false) errors.push(`suggestions[${index}] must be non-executable`);
  if (!Array.isArray(value.evidence)) {
    errors.push(`suggestions[${index}].evidence must be an array`);
    return;
  }
  value.evidence.forEach((reference, evidenceIndex) => {
    if (!isRecord(reference) || typeof reference.evidenceId !== 'string' || typeof reference.claim !== 'string') {
      errors.push(`suggestions[${index}].evidence[${evidenceIndex}] is invalid`);
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
